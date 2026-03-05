# db.py  
import os
import sqlite3
from pathlib import Path

def get_conn(ro: bool = False) -> sqlite3.Connection:
    """
    Unified SQLite connection for API use.
    - ro=True opens the DB in read-only mode (URI), else read/write.
    - Adds UTF-8 decode with replacement so bad bytes never 500 your API.
    - Adds a small busy timeout + perf PRAGMAs (per-connection).
    """

    # DB_PATH = "/data/articles.db"
    IS_FLY = bool(os.getenv("FLY_APP_NAME") or os.getenv("FLY_ALLOC_ID"))
    # local default: ../article-database/sqlite/articles.db (relative to repo root)
    DEFAULT_LOCAL_DB = str(
        Path(__file__).resolve().parents[2] / "article-database" / "sqlite" / "articles.db"
    )
    DB_PATH = os.getenv("SQLITE_PATH", "/data/articles.db" if IS_FLY else DEFAULT_LOCAL_DB)

    print(f"[DB] Using {DB_PATH}")
    if ro:
        if not os.path.exists(DB_PATH):
            raise FileNotFoundError(DB_PATH)
        uri = f"file:{DB_PATH}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
    else:
        conn = sqlite3.connect(DB_PATH, timeout=5)

    # Safety + ergonomics
    conn.text_factory = lambda b: b.decode("utf-8", "replace")
    conn.row_factory = sqlite3.Row

    # Per-connection PRAGMAs (non-persistent)
    conn.execute("PRAGMA busy_timeout = 5000")   # ms
    conn.execute("PRAGMA cache_size = -8192")   # ~8 MiB page cache (was 128 MiB — caused OOM on 1 GB VM)
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA foreign_keys = ON")

    return conn
