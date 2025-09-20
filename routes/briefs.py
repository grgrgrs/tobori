from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
import hashlib, json, re, uuid, sqlite3
from typing import Literal
from copy import deepcopy
import os
from .db import get_conn
from .auth import require_session

router = APIRouter(prefix="/briefs", tags=["briefs"], dependencies=[Depends(require_session)])

ET = ZoneInfo("America/New_York")

DEFAULT_OPTIONS = {
  "timeframe": "window",        # window | lookback | all
  "lookback_days": None,
  "date_basis": "processed",    # processed | published
  "themes_include": [],
  "keywords": [],
  "sources_exclude": [],
  "tone": "conversational",     # conversational | executive | researcher
  "format": {
    "style": "paragraphs",
    "length": "medium",         # short|medium|long
    "paragraphs": 5,
    "links_per_item_min": 1,
    "links_per_item_max": 2,
    "length_words": None,
    "since_yesterday": "line"   # line|paragraph|none
  },
  "top_n": 5,
  "candidate_pool": 250,         # hidden in MVP
  "input_per_source_cap": 5,    # hidden in MVP
  "output_per_source_cap": 2,
  "novelty_boost": "none"       # none|mild|strong|extreme
}

LENGTH_TO_TOPN = {"short": 3, "medium": 5, "long": 7}
NOVELTY_MULT = {"none": 1.00, "mild": 1.15, "strong": 1.40, "extreme": 1.80}
KW_BOOST_PER_HIT = float(os.getenv("KW_BOOST_PER_HIT", "0.5"))  # default +10% per hit
KW_BOOST_CAP     = int(os.getenv("KW_BOOST_CAP", "3"))           # cap at 3 hits
MIN_ARTICLE_SCORE = .04

def resolve_time_range(window: str, options: dict, today_et: date):
    if options.get("timeframe") == "lookback" and options.get("lookback_days"):
        end = datetime(today_et.year, today_et.month, today_et.day, 23, 59, 59, tzinfo=ET)
        days = int(options["lookback_days"])
        # If user picked “Last 24 hours” and the basis is Published, silently extend to 48h
        basis = (options.get("date_basis") or options.get("recency_by") or "processed").lower()
        if days == 1 and basis.startswith("pub"):
            days = 2
        start = end - timedelta(days=days)
        return start.isoformat(), (end + timedelta(seconds=1)).isoformat()
    if options.get("timeframe") == "all":
        # cover everything the corpus has; you can swap in earliest timestamp if stored
        return "1970-01-01T00:00:00-05:00", datetime.now(ET).isoformat()
    return et_window_for(today_et, window)

def markdown_to_html(text: str) -> str:
    # If it already looks like HTML, keep it.
    if "<" in text and ">" in text:
        return text

    # Try python-markdown if available.
    try:
        import markdown as md
        return md.markdown(text, extensions=["extra", "sane_lists"])
    except Exception:
        # Fallback: convert [title](url) and split paragraphs on blank lines.
        import re
        html = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', text)
        parts = [p.strip() for p in re.split(r"\n\s*\n", html) if p.strip()]
        return "".join(f"<p>{p}</p>" for p in parts)
        
def prev_window_start(window: str, window_start_iso: str) -> str:
    ws = datetime.fromisoformat(window_start_iso)
    if window == "daily":
        prev = ws - timedelta(days=1)
    elif window == "weekly":
        prev = ws - timedelta(days=7)
    else:  # monthly
        year, month = ws.year, ws.month
        if month == 1:
            year, month = year - 1, 12
        else:
            month -= 1
        prev = datetime(year, month, 1, 0, 0, 0, tzinfo=ws.tzinfo)
    return prev.isoformat()

def get_run_by_window(conn, brief_id: str, window_start_iso: str):
    row = conn.execute("""
        SELECT id, run_at, window_start, window_end, article_ids_json
        FROM brief_runs
        WHERE brief_id=? AND window_start=?
        LIMIT 1
    """, (brief_id, window_start_iso)).fetchone()
    if not row: return None
    return {
        "id": row[0],
        "run_at": row[1],
        "window_start": row[2],
        "window_end": row[3],
        "article_ids": json.loads(row[4]) if row[4] else []
    }

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\- ]+", "", s.strip()).lower()
    s = re.sub(r"\s+", "-", s)
    return s[:80] or "brief"

class BriefIn(BaseModel):
    title: str
    corpus_id: str
    window: Literal["daily","weekly","monthly"]
    prompt_template: str
    visibility: Literal["private","public"] = "private"
    options_json: Optional[Dict[str, Any]] = None  
    show_on_home: Optional[bool] = False
    home_order: Optional[int] = 0

class BriefOut(BaseModel):
    id: str
    title: str
    corpus_id: str
    window: str
    visibility: str
    is_default_home: int
    slug: str
    last_run_at: Optional[str] = None
    show_on_home: bool = False
    home_order: int = 0
    options_json: Optional[Dict[str, Any]] = None
    content_html: Optional[str] = None

class RunOut(BaseModel):
    id: str
    brief_id: str
    run_at: str
    window_start: str
    window_end: str
    status: str
    content_html: Optional[str] = None
    content_json: Optional[Dict[str, Any]] = None

# Add with your other models
class BriefDetail(BaseModel):
    id: str
    title: str
    corpus_id: str
    window: Literal["daily","weekly","monthly"]
    visibility: Literal["private","public"]
    prompt_template: str
    options_json: Optional[Dict[str, Any]] = None
    is_default_home: bool
    slug: str
    created_at: str
    updated_at: str
    last_run_at: Optional[str] = None
    show_on_home: bool = False
    home_order: int = 0

class LatestRunOut(BaseModel):
    id: str
    run_at: str
    window_start: str
    window_end: str
    status: Literal["ok","fallback","error"]
    content_html: Optional[str] = None
    content_json: Optional[Dict[str, Any]] = None

def et_window_for(date_obj: date, window: str):
    if window == "daily":
        start = datetime(date_obj.year, date_obj.month, date_obj.day, 0, 0, 0, tzinfo=ET)
        end   = start + timedelta(days=1)
    elif window == "weekly":  # Mon-Sun
        monday = date_obj - timedelta(days=(date_obj.weekday()))
        start = datetime(monday.year, monday.month, monday.day, 0, 0, 0, tzinfo=ET)
        end   = start + timedelta(days=7)
    else:  # monthly
        first = date_obj.replace(day=1)
        if first.month == 12:
            next_first = date(first.year+1, 1, 1)
        else:
            next_first = date(first.year, first.month+1, 1)
        start = datetime(first.year, first.month, first.day, 0, 0, 0, tzinfo=ET)
        end   = datetime(next_first.year, next_first.month, next_first.day, 0, 0, 0, tzinfo=ET)
    return start.isoformat(), end.isoformat()

def source_root(url: str) -> str:
    """
    Normalize source for caps. Treat subdomains as same root.
    Also collapse common multi-tenant hosts.
    """
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    host = host.lower()
    labels = host.split(".")
    root = ".".join(labels[-2:]) if len(labels) >= 2 else host
    # Optional: collapse well-known multi-tenant hosts (keep it simple for MVP)
    if root.endswith("substack.com"): root = "substack.com"
    if root.endswith("medium.com"):   root = "medium.com"
    return root or "unknown"

def get_last_run(conn: sqlite3.Connection, brief_id: str) -> Optional[dict]:
    cur = conn.execute(
        "SELECT id, run_at, window_start, window_end, content_json, article_ids_json "
        "FROM brief_runs WHERE brief_id=? ORDER BY run_at DESC LIMIT 1",
        (brief_id,)
    )
    row = cur.fetchone()
    if not row: return None
    return {
        "id": row[0],
        "run_at": row[1],
        "window_start": row[2],
        "window_end": row[3],
        "content_json": json.loads(row[4]) if row[4] else None,
        "article_ids": json.loads(row[5]) if row[5] else []
    }


def call_llm_and_render(compiled_user_prompt: str, facts: dict, opts: dict):
    system = "You are a precise editor who writes crisp, useful briefs."
    model_name = os.getenv("BRIEF_MODEL","gpt-4o-mini")
    temperature = float(os.getenv("BRIEF_TEMPERATURE","0.3"))
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key: raise RuntimeError("OPENAI_API_KEY not set")

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model_name, temperature=temperature,
        messages=[{"role":"system","content":system},{"role":"user","content":compiled_user_prompt}]
    )
    text = resp.choices[0].message.content
    html = markdown_to_html(text)
    return html, {"paragraphs": [p for p in text.split("\n\n") if p.strip()]}, model_name, getattr(resp, "usage", None)



def generate_brief_content(brief_id: str, title: str, corpus_id: str, window: str,
                           prompt: str, options: Dict[str, Any],
                           window_start: str, window_end: str):
    # Merge defaults
    opts = deepcopy(DEFAULT_OPTIONS)
    opts.update(options or {})
    fmt = {**DEFAULT_OPTIONS["format"], **(opts.get("format") or {})}
    opts["format"] = fmt

    # --- v1 UX clamps (leave plumbing intact) ---
    # Force consistent caps while the UI control is hidden.
    opts["input_per_source_cap"]  = 5
    opts["output_per_source_cap"] = 2
    # Ensure novelty is off in this phase, regardless of legacy saved options.
    opts["novelty_boost"] = "none"

    # Derive top_n from length
    top_n = LENGTH_TO_TOPN.get(fmt.get("length","medium"), 5)
    opts["top_n"] = top_n
    fmt["paragraphs"] = top_n

    # Resolve timeframe (overrides)
    today_et = datetime.fromisoformat(window_start).date()
    window_start, window_end = resolve_time_range(window, opts, today_et)

    # --- 1) Fetch candidates (SQL hard filters for time + themes) ---
    # Date-basis for the hard time filter
    basis = (opts.get("date_basis") or opts.get("recency_by") or "processed").lower()
    date_col = "COALESCE(a.published_date, a.processed_date)" if basis.startswith("pub") else "a.processed_date"

    sql = """
      SELECT a.id, a.title, a.url, a.published_date, a.summary,  MAX(s.combined_score) AS best_score
      FROM article_corpus_scores s
      JOIN articles a ON a.id = s.article_id
      WHERE s.corpus_id = ?
        AND {DATE_COL} >= ? AND {DATE_COL} < ?
        AND s.combined_score > ?
      GROUP BY a.id
      ORDER BY best_score DESC, {DATE_COL} DESC
    """
    sql = sql.replace("{DATE_COL}", date_col)
    params = [corpus_id, window_start, window_end, MIN_ARTICLE_SCORE]

    # (Optional) themes include — when you can JOIN tags, wire them here.
    # For MVP we skip themes SQL and filter client-side if needed.

    with get_conn(ro=True) as conn:
        rows = conn.execute(sql, params).fetchall()

    # --- 2) Normalize + soft filters (keywords boost, exclusions) ---
    keywords = [k.lower() for k in (opts.get("keywords") or []) if k.strip()]
    raw_excl = opts.get("sources_exclude") or []
    # Accept both list and comma/space-separated string
    if isinstance(raw_excl, str):
        parts = re.split(r"[,\s]+", raw_excl)
    else:
        parts = raw_excl
    excl_terms = [p.strip().lower() for p in parts if isinstance(p, str) and p.strip()]
    cand = []
    for (aid, atitle, url, pub, summary, score) in rows:
        root = source_root(url)
        if any(term in root for term in excl_terms):
            continue
        kw_hits = 0
        text = f"{atitle} {summary or ''}".lower()
        for kw in keywords:
            if not kw: 
                continue
            # simple word-boundary match
            if re.search(rf"\b{re.escape(kw)}\b", text):
                kw_hits += 1
        kw_boost = 1.0 + min(kw_hits, KW_BOOST_CAP) * KW_BOOST_PER_HIT
        cand.append({
            "article_id": aid, "title": atitle, "url": url, "published_at": pub,
            "source_root": root, "score": float(score) * kw_boost
        })
    cand.sort(key=lambda it: it["score"], reverse=True)
    # --- 3) Input caps + candidate_pool ---
    in_cap = int(opts.get("input_per_source_cap", 3))
    pool   = int(opts.get("candidate_pool", 250))
    per_source_in = {}
    candidates = []
    for it in cand:
        r = it["source_root"]
        per_source_in[r] = per_source_in.get(r, 0) + 1
        if per_source_in[r] > in_cap:
            continue
        candidates.append(it)
        if len(candidates) >= pool:
            break

    # --- 4) Novelty boost & final selection with output cap ---
    # Get previous window's article_ids for novelty
    with get_conn(ro=True) as conn:
        prev_start = prev_window_start(window, window_start) if opts.get("timeframe") in (None, "window", "lookback") else None
        prev_ids = set()
        if prev_start:
            prev = get_run_by_window(conn, brief_id, prev_start)
            if prev: prev_ids = set(prev["article_ids"])

    novelty_mult = NOVELTY_MULT.get(opts.get("novelty_boost","mild"), 1.15)
    scored = []
    for it in candidates:
        is_new = it["article_id"] not in prev_ids
        adj = it["score"] * (novelty_mult if is_new else 1.0)
        scored.append((adj, it))
    scored.sort(key=lambda x: x[0], reverse=True)

    out_cap = int(opts.get("output_per_source_cap", 1))
    selected, per_source_out = [], {}
    for adj, it in scored:
        r = it["source_root"]
        if per_source_out.get(r, 0) >= out_cap:
            continue
        per_source_out[r] = per_source_out.get(r, 0) + 1
        selected.append(it)
        if len(selected) >= top_n:
            break


    # --- 5) Diff vs previous window (deterministic) ---
    curr_ids = [it["article_id"] for it in selected]
    added = [it for it in selected if it["article_id"] not in prev_ids]
    removed_ct = len(prev_ids - set(curr_ids))

    since_mode = fmt.get("since_yesterday","line")
    if opts.get("timeframe") == "all":     # suppress for all-time
        since_mode = "none"

    facts = {
      "title": title,
      "window_start": window_start, "window_end": window_end,
      "items": selected,
      "since_yesterday": {
        "mode": since_mode,
        "added_count": len(added),
        "removed_count": removed_ct,
        "notable_new_sources": sorted({it["source_root"] for it in added})[:3]
      }
    }

    # --- 6) Compose dynamic constraints (tone/format) ---
    constraints, tone_text = build_constraints(opts), tone_block(opts.get("tone","conversational"))
    selection_summary = build_selection_summary(opts, keywords, excl_terms)

    compiled_user_prompt = compose_prompt(prompt, constraints, tone_text, selection_summary, facts)

    html, llm_json, model, usage = call_llm_and_render(compiled_user_prompt, facts, opts)

    # selected was built earlier (the N picked items)
    selected_ids = [it["article_id"] for it in selected]

    content = {
        "paragraphs": llm_json.get("paragraphs", []),
        "since_yesterday": facts["since_yesterday"],
        "selected_article_ids": selected_ids
    }

    if not selected:
        empty_content = {
            "paragraphs": [],
            "since_yesterday": facts["since_yesterday"],
            "selected_article_ids": []
        }
        # keep the return shape: (html, content_json, compiled_user_prompt)
        return "", empty_content, compiled_user_prompt

    return html, content, compiled_user_prompt



def tone_block(tone: str) -> str:
    m = {
      "conversational": "Use plain, friendly language. No jargon. Keep it approachable but concise.",
      "executive": "Be terse and action-oriented. Lead with outcomes and implications. Avoid filler.",
      "researcher": "Be precise and technical. Prefer primary sources. Note methods or limitations when relevant."
    }
    return m.get(tone, m["conversational"])

def build_constraints(opts: dict) -> str:
    fmt = opts.get("format", {})
    n   = int(fmt.get("paragraphs", 5))
    style = fmt.get("style","paragraphs")
    min_l = int(fmt.get("links_per_item_min", 1))
    max_l = int(fmt.get("links_per_item_max", 2))
    length = fmt.get("length","medium")
    words  = fmt.get("length_words")
    since  = fmt.get("since_yesterday","line")

    lines = []
    lines.append("Output strictly as HTML fragments (no Markdown, no code fences).")
    if style == "paragraphs":
         lines.append(f"Write {n} short items as paragraphs.")
         lines.append("Wrap each item in <p>…</p>. Do NOT include <html>, <head>, or <body>.")
    else:  # bullets
         lines.append(f"Write {n} short items as bullet points.")
         lines.append("Output a single <ul> with one <li> per item (no <p> inside the list).")
    verb = "must include at least" if min_l >= 1 else "may include"
    lines.append(
        f"Each item {verb} {min_l} and at most {max_l} inline links using HTML "
        f"<a href=\"URL\">Title</a>. Always hyperlink the article title using the corresponding item.url from FACTS (no generic 'here')."
    )
    if words:
        lines.append(f"Target about {int(words)} words total.")
    else:
        lines.append({"short":"Aim for ~250 words.","medium":"Aim for ~400 words.","long":"Aim for ~600 words."}[length])


    return "\n".join(lines)

def build_selection_summary(opts: dict, keywords: list, excl_terms: set) -> str:
    return (
      f"Selection rules in effect:\n"
      f"- Consider up to {int(opts.get('candidate_pool',50))} high-scoring candidates in the time range.\n"
      f"- Pick {int(opts.get('top_n',5))} with max {int(opts.get('output_per_source_cap',1))} per source.\n"
      + (f"- Prioritize keywords: {', '.join(keywords)}.\n" if keywords else "")
      + (f"- Exclude sources: {', '.join(sorted(set(excl_terms)))}.\n" if excl_terms else "")
    )

def compose_prompt(user_prompt: str, constraints: str, tone_text: str, selection_summary: str, facts: dict) -> str:
    return f"""{user_prompt.strip()}

CONSTRAINTS
{constraints}

TONE
{tone_text}

SELECTION
{selection_summary}

FACTS (JSON)
{json.dumps(facts, ensure_ascii=False)}
"""

@router.get("/{brief_id}/latest", response_model=LatestRunOut)
def get_latest_run(brief_id: str, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        row = conn.execute("""
            SELECT r.id, r.run_at, r.window_start, r.window_end, r.status,
                   r.content_html, r.content_json, b.user_id
            FROM brief_runs r
            JOIN briefs b ON b.id = r.brief_id
            WHERE r.brief_id=? 
            ORDER BY r.run_at DESC
            LIMIT 1
        """, (brief_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no runs yet")
        if row[7] != acct["account_id"]:
            raise HTTPException(403, "not owner")
    return {
        "id": row[0], "run_at": row[1],
        "window_start": row[2], "window_end": row[3],
        "status": row[4],
        "content_html": row[5],
        "content_json": json.loads(row[6] or "{}"),
    }





@router.get("", response_model=List[BriefOut])
def list_briefs(
    mine: bool = True,
    home: bool = Query(False),                         # NEW: only Home-flagged when True
    corpus_id: Optional[str] = Query(None),            # NEW: filter by active corpus
    acct=Depends(require_session)
):
    order_by = "b.updated_at DESC"
    if home:
        # Home view: order by home_order then newest run
        order_by = "b.home_order ASC, last_run_at DESC"

    with get_conn(ro=True) as conn:
        cur = conn.execute(f"""
            SELECT
              b.id, b.title, b.corpus_id, b.window, b.visibility, b.is_default_home, b.slug,
              (SELECT run_at FROM brief_runs r WHERE r.brief_id=b.id ORDER BY run_at DESC LIMIT 1) AS last_run_at,
              b.show_on_home, b.home_order, b.options_json,
              (SELECT content_html FROM brief_runs r2 WHERE r2.brief_id=b.id ORDER BY run_at DESC LIMIT 1) AS latest_html
            FROM briefs b
            WHERE ( (? = 0) OR (b.user_id = ?) )
              AND ( (? = 0) OR (b.show_on_home = 1) )
              AND ( (? IS NULL) OR (b.corpus_id = ?) )
            ORDER BY {order_by}
        """, (
            0 if not mine else 1, acct["account_id"],
            0 if not home else 1,
            corpus_id, corpus_id
        ))
    return [
        BriefOut(
            id=row[0], title=row[1], corpus_id=row[2], window=row[3],
            visibility=row[4], is_default_home=row[5], slug=row[6], last_run_at=row[7],
            show_on_home=bool(row[8]),          # <- use DB value
            home_order=int(row[9] or 0),         # <- use DB value
            options_json=(json.loads(row[10]) if row[10] else None),
            content_html=row[11]
        )
        for row in cur.fetchall()
    ]

@router.post("", response_model=BriefOut)
def create_brief(payload: BriefIn, acct=Depends(require_session)):
    b_id = new_id("brf")
    slug = slugify(payload.title + "-" + b_id[-5:])
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO briefs (
              id, user_id, title, corpus_id, window, prompt_template, options_json,
              visibility, is_default_home, slug, created_at, updated_at,
              show_on_home, home_order
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            b_id, acct["account_id"], payload.title, payload.corpus_id, payload.window,
            payload.prompt_template, json.dumps(payload.options_json or {}),
            payload.visibility, 0, slug, now, now,
            1 if payload.show_on_home else 0,
            int(payload.home_order or 0)
        ))
    return BriefOut(
        id=b_id, title=payload.title, corpus_id=payload.corpus_id,
        window=payload.window, visibility=payload.visibility,
        is_default_home=0, slug=slug, last_run_at=None,
        show_on_home=bool(payload.show_on_home),
        home_order=int(payload.home_order or 0)
    )

class BriefPatch(BaseModel):
    title: Optional[str] = None
    corpus_id: Optional[str] = None
    window: Optional[Literal["daily","weekly","monthly"]] = None
    prompt_template: Optional[str] = None
    visibility: Optional[Literal["private","public"]] = None
    is_default_home: Optional[bool] = None
    options_json: Optional[Dict[str, Any]] = None
    show_on_home: Optional[bool] = None
    home_order: Optional[int] = None
    


@router.patch("/{brief_id}", response_model=BriefOut)
def update_brief(brief_id: str, payload: BriefPatch, acct=Depends(require_session)):
    with get_conn() as conn:
        # Ownership check
        owner = conn.execute("SELECT user_id, corpus_id FROM briefs WHERE id=?", (brief_id,)).fetchone()
        if not owner: raise HTTPException(404, "brief not found")
        if owner[0] != acct["account_id"]:
            raise HTTPException(403, "not owner")

        fields, values = [], []
        for col in ("title","corpus_id","window","prompt_template","visibility"):
            val = getattr(payload, col)
            if val is not None:
                fields.append(f"{col}=?")
                values.append(val)
        if payload.options_json is not None:
            fields.append("options_json=?")
            values.append(json.dumps(payload.options_json))
        if payload.show_on_home is not None:
            fields.append("show_on_home=?")
            values.append(1 if payload.show_on_home else 0)
        if payload.home_order is not None:
            fields.append("home_order=?")
            values.append(int(payload.home_order))
        values.append(datetime.utcnow().isoformat())
        fields.append("updated_at=?")
        if payload.is_default_home is not None:
            # ensure only one default per (user, corpus)
            corpus = payload.corpus_id or owner[1]
            conn.execute("UPDATE briefs SET is_default_home=0 WHERE user_id=? AND corpus_id=?", (acct["account_id"], corpus))
            conn.execute("UPDATE briefs SET is_default_home=1 WHERE id=?", (brief_id,))
        if fields:
            conn.execute(f"UPDATE briefs SET {', '.join(fields)} WHERE id=?", (*values, brief_id))

        row = conn.execute("""
            SELECT id, title, corpus_id, window, visibility, is_default_home, slug,
                   (SELECT run_at FROM brief_runs WHERE brief_id=? ORDER BY run_at DESC LIMIT 1),
                   show_on_home, home_order
            FROM briefs WHERE id=?
        """, (brief_id, brief_id)).fetchone()

    return BriefOut(id=row[0], title=row[1], corpus_id=row[2], window=row[3],
                    visibility=row[4], is_default_home=row[5], slug=row[6], last_run_at=row[7],
                    show_on_home=bool(row[8]), home_order=int(row[9] or 0))

class RunRequest(BaseModel):
    date_str: Optional[str] = None  # "YYYY-MM-DD" (ET). If None -> today ET.


@router.post("/{brief_id}/run", response_model=RunOut)
def run_brief(brief_id: str, req: RunRequest, acct=Depends(require_session)):
    # ownership
    with get_conn(ro=True) as conn:
        b = conn.execute("""
            SELECT id, user_id, title, corpus_id, window, prompt_template, options_json
            FROM briefs WHERE id=?
        """, (brief_id,)).fetchone()
        if not b: raise HTTPException(404, "brief not found")
        if b[1] != acct["account_id"]:
            raise HTTPException(403, "not owner")

    today_et = datetime.now(ET).date() if not req.date_str else date.fromisoformat(req.date_str)
    wstart, wend = et_window_for(today_et, b[4])

    opts = json.loads(b[6] or "{}")
    html, content_json, compiled_prompt = generate_brief_content(
        brief_id=brief_id, title=b[2], corpus_id=b[3], window=b[4],
        prompt=b[5], options=opts, window_start=wstart, window_end=wend
    )

    # Persist (UPSERT the same window)
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM brief_runs WHERE brief_id=? AND window_start=? LIMIT 1",
            (brief_id, wstart)
        ).fetchone()
        run_id = existing[0] if existing else new_id("run")
        now = datetime.utcnow().isoformat()
        inputs_hash = hashlib.sha256(
            (json.dumps({"options":opts,"facts":content_json}, sort_keys=True) + (b[5] or "")).encode("utf-8")
        ).hexdigest()

        conn.execute("""
        INSERT INTO brief_runs (
          id, brief_id, run_at, window_start, window_end, status, model, token_usage_json,
          inputs_hash, article_ids_json, content_html, content_json, diagnostics_json, error_text
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(brief_id, window_start) DO UPDATE SET
          run_at=excluded.run_at, window_end=excluded.window_end, status=excluded.status,
          model=excluded.model, token_usage_json=excluded.token_usage_json, inputs_hash=excluded.inputs_hash,
          article_ids_json=excluded.article_ids_json, content_html=excluded.content_html,
          content_json=excluded.content_json, diagnostics_json=excluded.diagnostics_json, error_text=excluded.error_text
        """, (
          run_id, brief_id, now, wstart, wend, "ok", "gpt-4o-mini", None,
          inputs_hash,
          json.dumps(content_json.get("selected_article_ids", [])),
          html, json.dumps(content_json),
          json.dumps({"options": opts}, default=str),
          None
        ))

    return RunOut(
        id=run_id, brief_id=brief_id, run_at=now,
        window_start=wstart, window_end=wend,
        status="ok", content_html=html, content_json=content_json
    )

    @router.get("/{brief_id}/runs")
    def list_runs(brief_id: str, limit: int = 20, acct=Depends(require_session)):
        con = get_conn()
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """
                SELECT id, brief_id, started_at, completed_at, status, model,
                       content_html, content_json, error
                FROM brief_runs
                WHERE brief_id = ?
                ORDER BY started_at DESC
                LIMIT ?
                """,
                (brief_id, limit),
            ).fetchall()
            out = []
            for r in rows:
                out.append({
                    "id": r["id"],
                    "brief_id": r["brief_id"],
                    "started_at": r["started_at"],
                    "completed_at": r["completed_at"],
                    "status": r["status"],
                    "model": r["model"],
                    "content_html": r["content_html"],
                    "content_json": r["content_json"],
                    "error": r["error"],
                })
            return out
        finally:
            con.close()

    @router.get("/{brief_id}/runs/latest")
    def get_latest_run(brief_id: str, acct=Depends(require_session)):
        con = get_conn()
        try:
            con.row_factory = sqlite3.Row
            row = con.execute(
                """
                SELECT *
                FROM brief_runs
                WHERE brief_id = ?
                ORDER BY run_at DESC
                LIMIT 1
                """,
                (brief_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No runs")
            # return FULL run, including content_html and content_json
            return dict(row)
        finally:
            con.close()

class PreviewReq(BaseModel):
    options_overrides: Optional[Dict[str, Any]] = None
    prompt_template: Optional[str] = None


# --- Preview for a brand-new brief (no id yet) ---
class PreviewNewReq(BaseModel):
    corpus_id: str
    window: Literal["daily","weekly","monthly"]
    prompt_template: str
    options_json: Optional[Dict[str, Any]] = None

@router.post("/preview/new")
def preview_new(body: PreviewNewReq, acct=Depends(require_session)):
    # Build time window (ET) from requested window + options
    today_et = datetime.now(ET).date()
    # If your generate_brief_content resolves timeframe from options, you can pass placeholders here;
    # we’ll still give it a window_start/end based on the calendar window.
    wstart, wend = et_window_for(today_et, body.window)

    html, content_json, compiled = generate_brief_content(
        brief_id=f"preview-{acct['account_id']}-{body.corpus_id}",  # synthetic id; no previous runs -> no diff
        title="(preview)",
        corpus_id=body.corpus_id,
        window=body.window,
        prompt=body.prompt_template,
        options=(body.options_json or {}),
        window_start=wstart,
        window_end=wend,
    )
    return {
        "content_html": html,
        "content_json": content_json,
        "compiled_prompt": compiled,
    }

# Put this route AFTER /preview/new and BEFORE any subpaths like /{brief_id}/run
@router.get("/{brief_id}", response_model=BriefDetail)
def get_brief(brief_id: str, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        row = conn.execute("""
            SELECT
              b.id, b.user_id, b.title, b.corpus_id, b.window, b.prompt_template,
              b.options_json, b.visibility, b.is_default_home, b.slug,
              b.created_at, b.updated_at, b.show_on_home, b.home_order,
              (SELECT run_at FROM brief_runs r WHERE r.brief_id=b.id ORDER BY run_at DESC LIMIT 1) AS last_run_at
            FROM briefs b
            WHERE b.id=?
        """, (brief_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="brief not found")
        if row[1] != acct["account_id"]:
            raise HTTPException(status_code=403, detail="not owner")

    return {
        "id": row[0],
        "title": row[2],
        "corpus_id": row[3],
        "window": row[4],
        "prompt_template": row[5] or "",
        "options_json": json.loads(row[6] or "{}"),
        "visibility": row[7],
        "is_default_home": bool(row[8]),
        "slug": row[9],
        "created_at": row[10],
        "updated_at": row[11],
        "show_on_home": bool(row[12]),
        "home_order": int(row[13] or 0),
        "last_run_at": row[14],

    }

@router.post("/{brief_id}/preview")
def preview_brief(brief_id: str, body: PreviewReq, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        b = conn.execute("""
          SELECT id, user_id, title, corpus_id, window, prompt_template, options_json
          FROM briefs WHERE id=?
        """, (brief_id,)).fetchone()
        if not b: raise HTTPException(404, "brief not found")
        if b[1] != acct["account_id"]: raise HTTPException(403, "not owner")

    prompt = (body.prompt_template if body and body.prompt_template is not None else b[5]) or ""
    base_opts = json.loads(b[6] or "{}")
    opts = {**base_opts, **(body.options_overrides or {})}

    today_et = datetime.now(ET).date()
    wstart, wend = et_window_for(today_et, b[4])

    html, content_json, _ = generate_brief_content(
        brief_id=b[0], title=b[2], corpus_id=b[3], window=b[4],
        prompt=prompt, options=opts, window_start=wstart, window_end=wend
    )
    return {"content_html": html, "content_json": content_json}

# -------- Generator (MVP) --------



def fallback_render_html(facts: Dict[str, Any], style: str = "paragraphs") -> str:
    items = facts.get("items", [])
    sy = facts.get("since_yesterday", {"added_count":0,"removed_count":0,"notable_new_sources":[]})
    if style == "bullets":
        lis = "".join(
            f'<li><a href="{it["url"]}">{escape(it["title"])}</a> — {escape(it["source_root"])}</li>'
            for it in items
        )
        body = f"<ul>{lis}</ul>"
    else:
        paras = [
            f'<p><a href="{it["url"]}">{escape(it["title"])}</a> — {escape(it["source_root"])}</p>'
            for it in items
        ]
        body = "\n".join(paras)
    since = (
        f'<p><em>Since yesterday:</em> +{sy["added_count"]} new, {sy["removed_count"]} dropped; '
        f'new sources: {", ".join(sy.get("notable_new_sources") or []) or "—"}.</p>'
    )
    return body + "\n" #+ since