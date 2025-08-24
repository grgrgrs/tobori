from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Union
import sqlite3, os, datetime
from routes import articles 
from fastapi.staticfiles import StaticFiles
from fastapi import Request
from pathlib import Path

# ----------------------
# FastAPI app and CORS
# ----------------------
app = FastAPI()

IS_FLY = bool(os.getenv("FLY_APP_NAME") or os.getenv("FLY_ALLOC_ID"))
DEFAULT_LOCAL_DB = str(
    Path(__file__).resolve().parents[1] / ".." / "article-database" / "sqlite" / "articles.db"
)
DB_PATH = os.getenv("SQLITE_PATH", "/data/articles.db" if IS_FLY else str(Path(DEFAULT_LOCAL_DB).resolve()))
 

def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    # Enforce referential integrity and reduce lock issues
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn

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

app.include_router(articles.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#DB_PATH = "/data/articles.db"  # Use the persistent volume

# ----------------------
# Data models
# ----------------------

class Interaction(BaseModel):
    user_id: str
    session_id: Optional[str] = None
    article_id: int                     # <- must be integer now
    interaction_type: str               # 'open' or 'rate'
    value: Optional[str] = None         # for 'rate': 'liked' | 'forget'


class RegisterUser(BaseModel):
    user_id: str


class RegisterSession(BaseModel):
    session_id: str
    user_id: str

class MergeUser(BaseModel):
    old_user_id: str
    new_user_id: str


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


@app.post("/log_interaction")
def log_interaction(interaction: Interaction):
    conn = get_conn()
    cur = conn.cursor()

    # verify the article exists
    row = cur.execute("SELECT 1 FROM articles WHERE id=?", (interaction.article_id,)).fetchone()
    if not row:
        conn.close()
        return {"status": "error", "error": "unknown article_id"}, 400

    # (optional) validate allowed combos
    if interaction.interaction_type == "open":
        ok = (interaction.value is None)
    elif interaction.interaction_type == "rate":
        ok = (interaction.value in ("liked", "forget"))
    else:
        ok = False
    if not ok:
        conn.close()
        return {"status": "error", "error": "invalid interaction payload"}, 400

    # upsert user/session if you keep that
    cur.execute("INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, datetime('now'))", (interaction.user_id,))
    if interaction.session_id:
        cur.execute("""INSERT OR IGNORE INTO sessions(session_id,user_id,started_at,last_seen)
                       VALUES (?,?,datetime('now'),datetime('now'))""",
                    (interaction.session_id, interaction.user_id))
        cur.execute("UPDATE sessions SET last_seen=datetime('now') WHERE session_id=?", (interaction.session_id,))

    # insert interaction (FK enforced)
    cur.execute("""INSERT INTO user_interactions
                   (user_id, session_id, article_id, interaction_type, value, timestamp)
                   VALUES (?,?,?,?,?,datetime('now'))""",
                (interaction.user_id, interaction.session_id, interaction.article_id,
                 interaction.interaction_type, interaction.value))

    conn.commit()
    conn.close()
    return {"status": "ok"}



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


@app.post("/user_interactions")
def log_user_interaction(interaction: Interaction):
    return log_interaction(interaction)


#app.mount("/", StaticFiles(directory="dist", html=True), name="static")

STATIC_DIR = (Path(__file__).resolve().parents[1] / "dist").resolve()
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")