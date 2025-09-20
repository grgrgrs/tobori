# routes/deps.py
from fastapi import Depends, HTTPException, Request, status
from types import SimpleNamespace
from .db import get_conn
import sqlite3

COOKIE_NAME = "sid"


def require_session(request: Request):
    sid = request.cookies.get(COOKIE_NAME)
    if not sid:
        raise HTTPException(status_code=401, detail="no_session")
    con = get_conn(ro=True)
    try:
        row = con.execute(
            """
            SELECT account_id, email
            FROM accounts
            WHERE session_token = ?
              AND (session_expires_at IS NULL OR session_expires_at > datetime('now'))
            """,
            (sid,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="session_expired_or_invalid")
        return {"account_id": row["account_id"], "email": row["email"]}
    finally:
        con.close()


def get_current_user(request: Request):
    """Return a lightweight object with attributes expected by callers."""
    acct = require_session(request)
    return SimpleNamespace(
        id=acct["account_id"],
        email=acct.get("email"),
        display_name=None,
        preferred_corpus_id=None,
        profile_banner_url=None,
    )


def current_account_id(request: Request) -> str:
    """Return the authenticated account_id, or raise 401."""
    acc = require_session(request)  # raises 401 if no/invalid cookie
    aid = acc.get("account_id")
    if not aid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no_account_id")
    return aid
