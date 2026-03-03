# routes/admin.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from .db import get_conn
from .deps import require_admin
from .auth import _upsert_account

router = APIRouter(tags=["admin"])


@router.get("/admin/users")
def list_users(acct=Depends(require_admin)):
    con = get_conn(ro=True)
    try:
        rows = con.execute(
            """
            SELECT a.account_id, a.email, a.created_at,
                   group_concat(uc.corpus_id, ',') AS corpora
            FROM accounts a
            LEFT JOIN user_corpora uc ON uc.account_id = a.account_id
            GROUP BY a.account_id
            ORDER BY a.created_at DESC
            """
        ).fetchall()
        return {
            "users": [
                {
                    "account_id": r["account_id"],
                    "email": r["email"],
                    "created_at": r["created_at"],
                    "corpora": r["corpora"].split(",") if r["corpora"] else [],
                }
                for r in rows
            ]
        }
    finally:
        con.close()


class AddUserIn(BaseModel):
    email: EmailStr


@router.post("/admin/users", status_code=201)
def add_user(payload: AddUserIn, acct=Depends(require_admin)):
    account_id = _upsert_account(payload.email)
    con = get_conn()
    try:
        corpora = con.execute("SELECT corpus_id FROM corpora").fetchall()
        for c in corpora:
            con.execute(
                "INSERT OR IGNORE INTO user_corpora (account_id, corpus_id, role) VALUES (?,?,'member')",
                (account_id, c["corpus_id"]),
            )
        con.commit()
        assigned = [c["corpus_id"] for c in corpora]
        return {"status": "ok", "account_id": account_id, "email": str(payload.email), "corpora": assigned}
    finally:
        con.close()


@router.delete("/admin/users/{account_id}", status_code=200)
def remove_user(account_id: str, acct=Depends(require_admin)):
    con = get_conn()
    try:
        result = con.execute(
            "DELETE FROM user_corpora WHERE account_id=?", (account_id,)
        )
        con.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="user_not_found_or_no_memberships")
        return {"status": "ok"}
    finally:
        con.close()
