# brief_scheduler.py
# Server-side scheduler + queue runner for Brief auto-refresh.

import os, uuid, traceback
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Reuse your DB helpers + run_brief
from routes.briefs import get_conn, run_brief, RunRequest   # adjust import path if needed

UTC = timezone.utc
router = APIRouter(prefix="/brief_jobs", tags=["briefs-autorefresh"])
_scheduler: Optional[BackgroundScheduler] = None

# --------- Helpers ---------
class IngestComplete(BaseModel):
    corpus_id: str
    ingest_start: str
    ingest_end: str
    n_new: int

def _run_brief_as_owner(brief_id: str):
    # look up the brief owner to satisfy the ownership check in run_brief()
    with get_conn(ro=True) as c:
        row = c.execute("SELECT user_id FROM briefs WHERE id=?", (brief_id,)).fetchone()
        if not row:
            raise Exception("brief not found")
        acct = {"account_id": row[0]}
    # empty request => today's window; adjust if you want to pass a specific date
    run_brief(brief_id, RunRequest(), acct)

def _now() -> datetime:
    return datetime.now(UTC)

def _new_id() -> str:
    return f"job_{uuid.uuid4().hex[:12]}"

def _row_to_dict(cur, row):
    return {d[0]: row[i] for i, d in enumerate(cur.description)}

def _all_briefs() -> List[dict]:
    with get_conn(ro=True) as c:
        cur = c.execute("""SELECT id, title FROM briefs""")
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _already_enqueued_recently(brief_id: str, minutes: int = 50) -> bool:
    """Avoid duplicate enqueues if the server restarts around the top of the hour."""
    since = (_now() - timedelta(minutes=minutes)).isoformat()
    with get_conn(ro=True) as c:
        cur = c.execute("""
            SELECT 1 FROM brief_jobs
            WHERE brief_id = ?
              AND status IN ('queued','running','success')
              AND scheduled_for >= ?
            LIMIT 1
        """, (brief_id, since))
        return cur.fetchone() is not None


def _already_enqueued_today(brief_id: str) -> bool:
    start = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    with get_conn(ro=True) as c:
        cur = c.execute("""
            SELECT 1 FROM brief_jobs
            WHERE brief_id = ?
              AND status IN ('queued','running','success')
              AND scheduled_for >= ?
            LIMIT 1
        """, (brief_id, start.isoformat()))
        return cur.fetchone() is not None

def _enqueue(brief_id: str, scheduled_for: datetime) -> str:
    job_id = _new_id()
    with get_conn() as c:
        c.execute("""
            INSERT INTO brief_jobs (id, brief_id, scheduled_for, status)
            VALUES (?, ?, ?, 'queued')
        """, (job_id, brief_id, scheduled_for.isoformat()))
    return job_id

def enqueue_all_scheduled_briefs() -> dict:
    """Enqueue one job per brief, once per hour."""
    briefs = _all_briefs()

    enq = 0
    now = _now()
    print("[brief_scheduler] hourly enqueue ALL briefs:", len(briefs))

    for b in briefs:

        try:
            if not _already_enqueued_recently(b["id"], minutes=50):
                _enqueue(b["id"], scheduled_for=now)
                enq += 1
        except Exception:
            continue

    return {"enqueued": enq, "total_schedulable": len(briefs)}

def _claim_jobs(limit: int = 3) -> List[dict]:
    """Atomically claim 'queued' jobs whose scheduled_for <= now()."""
    now = _now().isoformat()
    claimed: List[dict] = []
    with get_conn() as c:
        # fetch a few due jobs
        cur = c.execute("""
            SELECT id, brief_id, scheduled_for, status, attempts
            FROM brief_jobs
            WHERE status='queued' AND scheduled_for <= ?
            ORDER BY scheduled_for ASC
            LIMIT ?
        """, (now, limit))
        rows = cur.fetchall()
        for r in rows:
            jid, bid, sched_for, status, attempts = r
            # try to flip to running (CAS)
            cur2 = c.execute("""
                UPDATE brief_jobs
                SET status='running', started_at=?, attempts=?
                WHERE id=? AND status='queued'
            """, (_now().isoformat(), attempts + 1, jid))
            if cur2.rowcount == 1:
                claimed.append({"id": jid, "brief_id": bid})
    return claimed

def process_brief_queue(max_concurrent: int = 3) -> dict:
    """Run due queued jobs by calling run_brief(brief_id)."""
    claimed = _claim_jobs(limit=max_concurrent)
    ok, fail = 0, 0

    for job in claimed:
        jid, bid = job["id"], job["brief_id"]
        try:
            # Call your existing runner; it persists output and updates run history.
            _run_brief_as_owner(bid)
            with get_conn() as c:
                c.execute("""
                    UPDATE brief_jobs
                    SET status='success', finished_at=?
                    WHERE id=?
                """, (_now().isoformat(), jid))
            ok += 1
        except Exception as e:
            err = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            with get_conn() as c:
                c.execute("""
                    UPDATE brief_jobs
                    SET status='failure', finished_at=?, error=?
                    WHERE id=?
                """, (_now().isoformat(), err, jid))
            fail += 1

    return {"ran": len(claimed), "success": ok, "failure": fail}

# --------- APScheduler bootstrap ---------

def start_scheduler():
    global _scheduler
    if _scheduler:  # already started
        return _scheduler
    _scheduler = BackgroundScheduler(timezone=str(UTC))
    # Enqueue wave hourly (cheap + resilient); weekly coverage is guarded inside.
    _scheduler.add_job(enqueue_all_scheduled_briefs, "cron", minute=5)
    # Process queue every minute
    _scheduler.add_job(process_brief_queue, "interval", minutes=1)
    _scheduler.start()
    return _scheduler

print("[brief_scheduler] scheduler started")

# --------- API ---------

class EnqueueResp(BaseModel):
    job_id: str

@router.post("/{brief_id}/enqueue")
def api_enqueue_brief(brief_id: str):
    job_id = _enqueue(brief_id, scheduled_for=_now())
    return EnqueueResp(job_id=job_id)

@router.post("/enqueue_all")
def api_enqueue_all():
    return enqueue_all_scheduled_briefs()

@router.post("/process_queue")
def api_process_queue():
    return process_brief_queue()

# --- ingest ----------------------------------------
@router.post("/complete")
def api_ingest_complete(body: IngestComplete):
    # find briefs for this corpus
    with get_conn(ro=True) as c:
        rows = c.execute("""
           SELECT id, coverage FROM briefs WHERE corpus_id = ?
        """, (body.corpus_id,)).fetchall()

    enq = 0
    for bid, coverage in rows:
        cov = (coverage or "daily").lower()
        if cov == "manual":
            continue
        if not _already_enqueued_today(bid):
            _enqueue(bid, scheduled_for=_now())
            enq += 1

    return {"enqueued": enq, "briefs_checked": len(rows), "corpus_id": body.corpus_id}