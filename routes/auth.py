# routes/auth.py
from __future__ import annotations
import json, os, secrets, uuid
from datetime import datetime, timedelta
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response, Request, status, Query
from pydantic import BaseModel, EmailStr

from .db import get_conn  

from .deps import get_current_user, require_session

router = APIRouter(tags=["auth"])

COOKIE_NAME = "sid"
COOKIE_MAX_DAYS = 30
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}

class MeOut(BaseModel):
    user_id: str
    display_name: str | None = None
    preferred_corpus_id: str | None = None
    banner_url: str | None = None

# ---------- models ----------
class InviteSignupIn(BaseModel):
    email: EmailStr
    code: str  # e.g., GR-LENS-2025

class SimpleLoginIn(BaseModel):
    email: EmailStr
    code: str  # e.g., GR-LENS-2025 or AIB-2025

# ---------- helpers ----------
def _now_sql() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

def _mint_token() -> str:
    return secrets.token_urlsafe(32)  # ~256 bits URL-safe

def _upsert_account(email: str) -> str:
    con = get_conn()
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT account_id FROM accounts WHERE lower(email)=lower(?)",
            (email,),
        ).fetchone()
        if row:
            return row["account_id"]
        account_id = str(uuid.uuid4())
        con.execute(
            "INSERT INTO accounts (account_id, email, is_admin, created_at) VALUES (?,?,0,?)",
            (account_id, email, _now_sql()),
        )
        con.commit()
        return account_id
    finally:
        con.close()

def _ensure_membership_by_code(account_id: str, code: str) -> str:
    """
    Validate invite (not expired, under max_uses); ensure (account_id, corpus_id) mapping.
    Increment invite_codes.used only on first add. Returns corpus_id (TEXT).
    """
    con = get_conn()
    try:
        con.row_factory = sqlite3.Row
        inv = con.execute(
            """
            SELECT code, corpus_id, max_uses, used
            FROM invite_codes
            WHERE code = ?
              AND (expires_at IS NULL OR expires_at > datetime('now'))
              AND used < max_uses
            """,
            (code,),
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=400, detail="invalid_or_expired_code")

        corpus_id = inv["corpus_id"]

        already = con.execute(
            "SELECT 1 FROM user_corpora WHERE account_id=? AND corpus_id=?",
            (account_id, corpus_id),
        ).fetchone()

        if not already:
            con.execute(
                "INSERT INTO user_corpora (account_id, corpus_id, role) VALUES (?,?, 'member')",
                (account_id, corpus_id),
            )
            con.execute("UPDATE invite_codes SET used = used + 1 WHERE code = ?", (code,))
        con.commit()
        return corpus_id
    finally:
        con.close()

def _rotate_session(account_id: str) -> str:
    token = _mint_token()
    expires = (datetime.utcnow() + timedelta(days=COOKIE_MAX_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    con = get_conn()
    try:
        con.execute(
            "UPDATE accounts SET session_token=?, session_expires_at=? WHERE account_id=?",
            (token, expires, account_id),
        )
        con.commit()
        return token
    finally:
        con.close()

def _corpora_payload(account_id: str):
    """
    Returns [{ corpus_id, label, status, created_at, settings: {...} }, ...]
    settings is merged from corpus_settings.value_json (per corpus).
    """
    con = get_conn()
    try:
        con.row_factory = sqlite3.Row
        corps = con.execute(
            """
            SELECT c.corpus_id, c.label, c.status, c.created_at
            FROM corpora c
            JOIN user_corpora uc ON uc.corpus_id = c.corpus_id
            WHERE uc.account_id = ?
            ORDER BY c.label
            """,
            (account_id,),
        ).fetchall()

        if not corps:
            return []

        ids = [r["corpus_id"] for r in corps]
        placeholders = ",".join("?" * len(ids))
        rows = con.execute(
            f"SELECT corpus_id, key, value_json FROM corpus_settings WHERE corpus_id IN ({placeholders})",
            tuple(ids),
        ).fetchall()

        settings_map: dict[str, dict] = {}
        for r in rows:
            d = settings_map.setdefault(r["corpus_id"], {})
            try:
                d[r["key"]] = json.loads(r["value_json"])
            except Exception:
                d[r["key"]] = r["value_json"]

        out = []
        for r in corps:
            out.append(
                {
                    "corpus_id": r["corpus_id"],
                    "label": r["label"],
                    "status": r["status"],
                    "created_at": r["created_at"],
                    "settings": settings_map.get(r["corpus_id"], {}),
                }
            )
        return out
    finally:
        con.close()



def _set_cookie(response: Response, token: str):
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=COOKIE_MAX_DAYS * 24 * 3600,
        path="/",
    )

# ---------- endpoints ----------
@router.post("/signup/invite")
def signup_invite(payload: InviteSignupIn, response: Response):
    account_id = _upsert_account(payload.email)
    _ensure_membership_by_code(account_id, payload.code)
    token = _rotate_session(account_id)
    _set_cookie(response, token)

    with get_conn() as con:
        cur = con.cursor()
        cur.execute("INSERT OR IGNORE INTO users(user_id) VALUES (?)", (account_id,))
        con.commit()
    return {"corpora": _corpora_payload(account_id)}

@router.post("/login/simple")
def login_simple(payload: SimpleLoginIn, response: Response):
    account_id = _upsert_account(payload.email)
    _ensure_membership_by_code(account_id, payload.code)
    token = _rotate_session(account_id)
    _set_cookie(response, token)
    with get_conn() as con:
        cur = con.cursor()
        cur.execute("INSERT OR IGNORE INTO users(user_id) VALUES (?)", (account_id,))
        con.commit()
    return {"corpora": _corpora_payload(account_id)}

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, acct = Depends(require_session)):
    account_id = acct["account_id"]
    con = get_conn()
    try:
        con.execute(
            "UPDATE accounts SET session_token=NULL, session_expires_at=NULL WHERE account_id=?",
            (account_id,),
        )
        con.commit()
    finally:
        con.close()
    response.delete_cookie(COOKIE_NAME, path="/")
    return

@router.get("/corpora")
def get_corpora(acct = Depends(require_session)):
    return {"corpora": _corpora_payload(acct["account_id"])}


@router.get("/me", response_model=MeOut)
def get_me(
    corpus_id: str | None = Query(None),
    user = Depends(get_current_user),
):
    # corpus default (if provided)
    default_banner = None
    if corpus_id:
        con = get_conn(ro=True)
        try:
            row = con.execute(
                "SELECT banner_url FROM corpora WHERE corpus_id = ?", (corpus_id,)
            ).fetchone()
            if row:
                default_banner = row["banner_url"]
        finally:
            con.close()

    display = getattr(user, "display_name", None) or getattr(user, "name", None) or getattr(user, "email", None)
    return MeOut(
        user_id=str(user.id),
        display_name=display,
        preferred_corpus_id=getattr(user, "preferred_corpus_id", None),
        banner_url=getattr(user, "profile_banner_url", None) or default_banner,
    )