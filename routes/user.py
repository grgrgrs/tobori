from fastapi import FastAPI, Depends, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Union, Literal
import sqlite3, os, datetime
from routes import articles 
from routes import auth
from fastapi.staticfiles import StaticFiles
from fastapi import Request, HTTPException
from pathlib import Path
from .db import get_conn
from .auth import router as auth_router, require_session
from .articles import router, compat_router
from fastapi.responses import HTMLResponse
from routes.briefs import router as briefs_router
from .deps import current_account_id

# ----------------------
# FastAPI app and CORS
# ----------------------
app = FastAPI()

# ----------------------
# Data models
# ----------------------

# pydantic model
class Interaction(BaseModel):
    article_id: int
    interaction_type: Literal["open", "rate"]
    value: Optional[Literal["liked", "forget", "paywall", "unlike"]] = None
    session_id: Optional[str] = None
    # user_id in body is ignored (kept for backward compat)
    user_id: Optional[str] = None


class RegisterUser(BaseModel):
    user_id: str


class RegisterSession(BaseModel):
    session_id: str
    user_id: str

class MergeUser(BaseModel):
    old_user_id: str
    new_user_id: str


def _log_interaction_core(interaction: Interaction, request: Request):
    uid = current_account_id(request)            # canonical person
    aid = int(interaction.article_id)
    itype = interaction.interaction_type
    val = (interaction.value or "").strip() or None
    sid = (interaction.session_id or "").strip() or None  # telemetry only

    con = get_conn()
    try:
        con.execute("PRAGMA foreign_keys=ON")
        cur = con.cursor()

        # Ensure parents exist (auth may not create users row)
        cur.execute("INSERT OR IGNORE INTO users(user_id) VALUES (?)", (uid,))
        cur.execute("SELECT 1 FROM articles WHERE id=? LIMIT 1", (aid,))
        if not cur.fetchone():
            return {"status": "ignored", "reason": "unknown article"}

        if itype == "open":
            cur.execute(
                """
                INSERT INTO user_interactions
                    (user_id, article_id, interaction_type, value, session_id, timestamp)
                VALUES (?, ?, 'open', NULL, ?, datetime('now'))
                """,
                (uid, aid, sid),
            )

        elif itype == "rate":
            if val == "unlike":
                cur.execute(
                    """
                    DELETE FROM user_interactions
                     WHERE user_id = ?
                       AND article_id = ?
                       AND interaction_type = 'rate'
                       AND value = 'liked'
                    """,
                    (uid, aid),
                )
            elif val in ("liked", "forget", "paywall"):
                cur.execute(
                    """
                    INSERT INTO user_interactions
                        (user_id, article_id, interaction_type, value, session_id, timestamp)
                    VALUES (?, ?, 'rate', ?, ?, datetime('now'))
                    """,
                    (uid, aid, val, sid),
                )
            else:
                return {"status": "ignored", "reason": "unknown value"}
        else:
            return {"status": "ignored", "reason": "unknown type"}

        con.commit()
        return {"status": "ok"}

    except sqlite3.IntegrityError as e:
        con.rollback()
        return {"status": "error", "error": str(e)}
    finally:
        con.close()

# utility to detect schema at runtime
def _table_has_column(con, table: str, col: str) -> bool:
    rows = con.execute(f"PRAGMA table_info({table})").fetchall()
    # rows: [ (cid, name, type, notnull, dflt_value, pk), ... ]
    return any((len(r) > 1 and (r[1] == col)) for r in rows)

def _optional_session(request: Request):
    try:
        return require_session(request)  # you already have this
    except HTTPException:
        return None

# --- helper to resolve article reference to INTEGER id ---
def resolve_article_id(cursor, maybe_id_or_url: Optional[Union[int, str]], explicit_url: Optional[str]) -> Optional[int]:
    # 1) numeric id?
    if isinstance(maybe_id_or_url, int) or (isinstance(maybe_id_or_url, str) and maybe_id_or_url.isdigit()):
        aid = int(maybe_id_or_url)
        if cursor.execute("SELECT 1 FROM articles WHERE id=?", (aid,)).fetchone():
            return aid
    # 2) treat as URL if string given
    url = explicit_url or (None if maybe_id_or_url is None else str(maybe_id_or_url))
    if url:
        row = cursor.execute("SELECT id FROM articles WHERE url=?", (url,)).fetchone()
        if row:
            return row[0]
        # 3) last-chance: legacy keys you kept during migration
        row = cursor.execute(
            "SELECT id FROM articles WHERE legacy_id=? OR chroma_id=?",
            (url, url)
        ).fetchone()
        if row:
            return row[0]
    return None


# --- CORS setup ---
origins = [
    "http://localhost:4321",  # Vite dev server
    "http://127.0.0.1:4321",
    "http://localhost:5173",  # if using Vite default
    "http://127.0.0.1:5173",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)





# ----------------------
# Endpoints
# ----------------------

@app.post("/merge_user")
def merge_user(data: MergeUser):
    """Merge anonymous user history into a new user_id."""
    conn = get_conn()
    cursor = conn.cursor()

    # Ensure new user exists
    cursor.execute(
        "INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)",
        (data.new_user_id, datetime.datetime.utcnow().isoformat())
    )

    # Merge interactions
    cursor.execute(
        "UPDATE user_interactions SET user_id = ? WHERE user_id = ?",
        (data.new_user_id, data.old_user_id)
    )

    # Merge sessions
    cursor.execute(
        "UPDATE sessions SET user_id = ? WHERE user_id = ?",
        (data.new_user_id, data.old_user_id)
    )

    conn.commit()
    conn.close()
    return {"status": "merged"}




@app.post("/register_user")
def register_user(data: RegisterUser):
    """Register a new user (anonymous or identified)"""
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)",
        (data.user_id, datetime.datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/register_session")
def register_session(data: RegisterSession):
    """Register a new session for a given user"""
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR IGNORE INTO sessions
        (session_id, user_id, started_at, last_seen)
        VALUES (?, ?, ?, ?)
        """,
        (
            data.session_id,
            data.user_id,
            datetime.datetime.utcnow().isoformat(),
            datetime.datetime.utcnow().isoformat(),
        )
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


# Canonical route(s) — keep both for now to avoid 405
@app.post("/api/user_interactions")
@app.post("/user_interactions")
def post_user_interactions(interaction: Interaction, request: Request):
    return _log_interaction_core(interaction, request)

app.include_router(auth_router, prefix="/api")     # signup/invite, logout, /corpora (already works)
app.include_router(router)      # /api/*
app.include_router(compat_router)   # /themes, /article_clusters at root
app.include_router(briefs_router, prefix="/api")

@app.get("/signup/invite", response_class=HTMLResponse)
def signup_invite_page(code: str = "", email: str = ""):
    # A minimal HTML page that posts to /api/signup/invite and then redirects home.
    # Works for any user; supports prefilled ?code= and ?email= query params.
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Join with Invite</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; }}
    form {{ max-width: 420px; display: grid; gap: .75rem; }}
    input, button {{ font-size: 1rem; padding: .6rem .7rem; }}
    .msg {{ margin-top: .5rem; color: #b00; white-space: pre-wrap; }}
  </style>
</head>
<body>
  <h1>Join with Invite</h1>
  <form id="f">
    <label>Email<br><input id="email" name="email" type="email" required value="{email}"></label>
    <label>Invite Code<br><input id="code" name="code" required value="{code}"></label>
    <button type="submit">Join</button>
    <div id="msg" class="msg"></div>
  </form>
  <script>
    const f = document.getElementById('f');
    f.addEventListener('submit', async (e) => {{
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const code  = document.getElementById('code').value.trim();
      const res = await fetch('/api/signup/invite', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        credentials: 'include',                // <-- store HttpOnly cookie
        body: JSON.stringify({{ email, code }})
      }});
      if (res.ok) {{
        location.href = '/';                   // you're signed in, go to app
      }} else {{
        const text = await res.text();
        document.getElementById('msg').textContent =
          text || ('Error ' + res.status);
      }}
    }});
  </script>
</body>
</html>"""


STATIC_DIR = (Path(__file__).resolve().parents[1] / "dist").resolve()
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")