from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from .db import get_conn

pub = APIRouter(tags=["public"])

@pub.get("/r/{run_id}", response_class=HTMLResponse)
def get_public_run(run_id: str):
    with get_conn(ro=True) as conn:
        row = conn.execute("""
            SELECT r.content_html, b.visibility
            FROM brief_runs r
            JOIN briefs b ON b.id = r.brief_id
            WHERE r.id=?
        """, (run_id,)).fetchone()
        if not row: raise HTTPException(404)
        if row[1] != "public": raise HTTPException(403, "not public")
        return row[0] or "<p>No content</p>"
