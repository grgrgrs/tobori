from fastapi import APIRouter, Query, Depends
from typing import List, Optional
from datetime import datetime, timedelta
import os, sqlite3, json, re
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from pathlib import Path
from math import exp
from collections import Counter
from .db import get_conn
from .deps import get_current_user
from .auth import require_session
from .deps import current_account_id

router = APIRouter(prefix="/api", dependencies=[Depends(require_session)])
compat = APIRouter(dependencies=[Depends(require_session)])

# DB_PATH = "/data/articles.db"
IS_FLY = bool(os.getenv("FLY_APP_NAME") or os.getenv("FLY_ALLOC_ID"))
# local default: ../article-database/sqlite/articles.db (relative to repo root)
DEFAULT_LOCAL_DB = str(
    Path(__file__).resolve().parents[2] / "article-database" / "sqlite" / "articles.db"
)
DB_PATH = os.getenv("SQLITE_PATH", "/data/articles.db" if IS_FLY else DEFAULT_LOCAL_DB)

print(f"[DB] Using {DB_PATH}")

def _effective_corpus_id(request: Request) -> Optional[str]:
    """
    If query param corpus_id is present and the user is a member -> use it.
    If absent -> use their first membership (if any).
    If they are not a member of the requested corpus -> 403.
    If they have no memberships -> None (we'll 403 on endpoints that require one).
    """
    acct = require_session(request)  # get {account_id, email}
    account_id = acct["account_id"]
    want = request.query_params.get("corpus_id")

    con = get_conn()
    cur = con.cursor()
    try:
        if want:
            row = cur.execute(
                "SELECT 1 FROM user_corpora WHERE account_id=? AND corpus_id=?",
                (account_id, want)
            ).fetchone()
            if row:
                return want
            raise HTTPException(status_code=403, detail="corpus_forbidden")

        row = cur.execute(
            "SELECT corpus_id FROM user_corpora WHERE account_id=? ORDER BY rowid ASC LIMIT 1",
            (account_id,)
        ).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def get_admin_token() -> Optional[str]:
    t = os.environ.get("ADMIN_TOKEN")
    if t:
        return t.strip()
    # admin_token.txt next to the script
    p = Path(__file__).with_name("admin_token.txt")
    if p.exists():
        return p.read_text(encoding="utf-8").strip().strip('"').strip("'")
    # simple .env parser (ADMIN_TOKEN=...)
    envp = Path(__file__).with_name(".env")
    if envp.exists():
        for line in envp.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("ADMIN_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

admin_token = get_admin_token()

# Feed score adjustments: pattern -> multiplier
FEED_ADJUSTMENTS = {
    "%arXiv%": 1,
    "%Reddit%": 0.4,
    "%BioRxiv%": 1,
    "%GR%": 1, 
    "%Medium%": .5,
    "%lesswrong%": 1.25,
    "%substack%" : 1.25
}

TITLE_ADJUSTMENTS = {
    # "%Top %": 0.90,
    # "%Beginner%'s guide%": 0.95,
}

# Structural title rules that LIKE can't express cleanly.
#  - Starts with a number
#  - Starts with "The " followed by a number
TITLE_EXTRA_WHENS = [
    "WHEN SUBSTR(LTRIM(a.title), 1, 1) BETWEEN '0' AND '9' THEN 0.70",
    "WHEN (LTRIM(a.title) LIKE 'The %' COLLATE NOCASE AND SUBSTR(LTRIM(a.title), 5, 1) BETWEEN '0' AND '9') THEN 0.70",
]

# Core emoji blocks + symbols commonly used as "decorations"
_EMOJI_RE = re.compile(
    r"["                       # single codepoints
    r"\U0001F1E6-\U0001F1FF"  # flags (regional indicators)
    r"\U0001F300-\U0001F5FF"  # misc symbols & pictographs
    r"\U0001F600-\U0001F64F"  # emoticons
    r"\U0001F680-\U0001F6FF"  # transport & map
    r"\U0001F700-\U0001F77F"  # alchemical
    r"\U0001F780-\U0001F7FF"  # geometric ext
    r"\U0001F800-\U0001F8FF"  # supplemental arrows-c
    r"\U0001F900-\U0001F9FF"  # supplemental symbols & pictographs
    r"\U0001FA70-\U0001FAFF"  # symbols & pictographs ext-A
    r"\u2600-\u26FF"          # misc symbols
    r"\u2700-\u27BF"          # dingbats
    r"\u2B50\u2B55"           # star, heavy large circle
    r"]+",
    flags=re.UNICODE,
)
# ZWJ + VS16 often glue emoji; remove them so no leftovers
_ZWJ_VS_RE = re.compile(r"[\u200D\uFE0F]")

def strip_emoji(text: Optional[str] = None) -> str:
    if not text:
        return ""
    t = _ZWJ_VS_RE.sub("", text)
    t = _EMOJI_RE.sub("", t)
    return t.strip()

@router.get("/liked_articles")
def get_liked_articles(request: Request, user_id: Optional[str] = None):
    # Prefer the authenticated person; fall back to provided user_id for compatibility
    try:
        user_id = current_account_id(request)
    except Exception:
        if not user_id:
            raise HTTPException(status_code=401, detail="no_session")

    conn = get_conn()
    cursor = conn.cursor()

    # Select the last 'rate' interaction for each article by timestamp
    cursor.execute("""
        SELECT article_id
        FROM (
            SELECT article_id, value, MAX(timestamp) AS last_ts
            FROM user_interactions
            WHERE user_id = ? AND interaction_type = 'rate'
            GROUP BY article_id
        )
        WHERE value = 'liked'
    """, (user_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return {"likedIds": [r[0] for r in rows]}

# -------------------------------
# Fetch Articles
# -------------------------------
@router.get("/articles", dependencies=[Depends(require_session)])
def fetch_articles(
    limit: int = 100,
    period: float = 100,
    theme: Optional[str] = None,
    category: Optional[str] = None,
    keyword: Optional[str] = None,
    liked: bool = False,
    opened: bool = False,
    unOpened: bool = False,
    variety: bool = False,
    user_id: Optional[str] = None,
    feed_include: Optional[str] = None,
    feed_exclude: Optional[str] = None,
    clusters: Optional[str] = None,   # e.g., "cluster_3|cluster_7"
    corpus_id: Optional[str] = None, 
    recency_by: str = "processed",    # "processed" | "published"
    request: Request = None,
):
    # --- enforce allowed corpus
    corpus_id = _effective_corpus_id(request)
    if corpus_id is None:
        raise HTTPException(status_code=403, detail="no_corpus_membership")
    try:
        uid = current_account_id(request)  # logged-in required here
    except Exception:
        uid = None

    conn = get_conn()
    cursor = conn.cursor()


    # -------------------------------
    # 1. Base Query
    # -------------------------------
    # Build CASE expression for adj_score
    case_clauses = []
    for pattern, multiplier in FEED_ADJUSTMENTS.items():
        case_clauses.append(f"WHEN a.feed_name LIKE '{pattern}' COLLATE NOCASE THEN a.confidence_score * {multiplier}")

    adj_score_sql = f"""
        CASE
            {' '.join(case_clauses)}
            ELSE a.confidence_score
        END
    """



   # Title multiplier CASE (patterns + structural rules)
    title_case_clauses = [f"WHEN LTRIM(a.title) LIKE '{p}' COLLATE NOCASE THEN {m}" for p, m in TITLE_ADJUSTMENTS.items()]
    title_case_clauses += TITLE_EXTRA_WHENS
    title_multiplier_sql = f"CASE {' '.join(title_case_clauses)} ELSE 1.0 END"

    # Final adjusted score = (feed-adjusted score) * (title multiplier)
    adj_score_sql = f"""
        (
          CASE
            {' '.join(case_clauses)}
            ELSE a.confidence_score
          END
        ) * (
          {title_multiplier_sql}
        )
    """



    query = f"""
        SELECT a.id,
               a.title,
               a.url,
               a.summary,
               COALESCE(acs.combined_score, {adj_score_sql}) AS adj_score,
               a.processed_date,
               COALESCE(acs.theme, a.theme)     AS theme,
               COALESCE(acs.category, a.category) AS category,
               a.published_date,
               a.feed_name,
               COALESCE(rc_out.out_count, 0)  AS related_count,
               COALESCE(rc_in.in_count,   0)  AS incoming_related_count
        FROM articles a
        /* Pre-aggregated counts to avoid per-row scalar subqueries */
        LEFT JOIN (
          SELECT article_id, COUNT(*) AS out_count
          FROM related_articles
          GROUP BY article_id
        ) AS rc_out ON rc_out.article_id = a.id
        LEFT JOIN (
          SELECT related_id, COUNT(*) AS in_count
          FROM related_articles
          GROUP BY related_id
        ) AS rc_in  ON rc_in.related_id = a.id
    """
    params = []
    join_params = []
    cond_params = []
    join_clauses = []
    conditions = []
    

    # Always join ACS so COALESCE(acs.*, a.*) is valid even when corpus_id is not provided
    # --- Corpus JOIN (hard filter when corpus_id provided) ---
    if corpus_id:
        # Strict: only rows scored for this corpus
        join_clauses.insert(0,
            "JOIN article_corpus_scores acs "
            "ON acs.article_id = a.id AND acs.corpus_id = ?"
        )
        join_params.insert(0, corpus_id)
    else:
        # Legacy/global: allow fallback via COALESCE(...)
        join_clauses.insert(0,
            "LEFT JOIN article_corpus_scores acs ON acs.article_id = a.id"
        )


    # -------------------------------
    # 2. Liked / Opened Subqueries
    # -------------------------------
    if liked and uid:
        liked_subquery = """
            SELECT article_id
            FROM (
                SELECT article_id,
                       value,
                       MAX(timestamp) AS last_ts
                FROM user_interactions
                WHERE interaction_type = 'rate' AND user_id = ?
                GROUP BY article_id
            )
            WHERE value = 'liked'
        """
        join_clauses.append(f"JOIN ({liked_subquery}) ul ON a.id = ul.article_id")
        join_params.append(uid)

    if opened and uid:
        conditions.append("""
            EXISTS (
                SELECT 1
                FROM user_interactions ui
                WHERE ui.user_id = ?
                  AND ui.interaction_type = 'open'
                  AND ui.article_id = a.id
                  AND ui.timestamp >= datetime('now', ?)
            )
        """)
        cond_params.extend([uid, f"-{int(period)} days"])


    if unOpened and uid:
        unopened_subquery = """
            SELECT DISTINCT article_id
            FROM user_interactions
            WHERE interaction_type='open' AND user_id = ?
        """
        join_clauses.append(f"LEFT JOIN ({unopened_subquery}) uuo ON a.id = uuo.article_id")
        conditions.append("uuo.article_id IS NULL")
        join_params.append(uid)



    # -------------------------------
    # 3. Filters
    # -------------------------------


    # Handle period filtering using selected date basis
    # recency_by == "published" → use COALESCE(published_date, processed_date) to avoid dropping rows with missing published_date
    date_expr = (
        "datetime(substr(REPLACE(COALESCE(a.published_date, a.processed_date), 'T', ' '), 1, 19))"
        if str(recency_by).lower().startswith("pub")
        else "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19))"
    )
    # “Last 24 hours” → silently expand to 48h when basis is Published
    if period <= 1:
        hours = 48 if str(recency_by).lower().startswith("pub") else 24
        since_date = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    else:
        since_date = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")
    conditions.append(f"{date_expr} >= ?")
    cond_params.append(since_date)


    # ---- Cluster / Tag filters (mutually exclusive; cluster wins) ----
    # CLUSTERS
    if clusters:
        c_ids = [x for x in clusters.split("|") if x]
        if c_ids:
            placeholders = ",".join("?" * len(c_ids))
            join_clauses.append(f"""
                JOIN group_manifest gm_c
                  ON gm_c.group_type='article_cluster'
                 AND gm_c.group_id IN ({placeholders})
                JOIN json_each(gm_c.member_article_ids) je_c
                  ON (a.id = CAST(je_c.value AS INTEGER) OR a.url = je_c.value)
            """)
            join_params.extend(c_ids)


    # Theme/Category only when no clusters/tags
    if not clusters:
        if theme:
            conditions.append("LOWER(COALESCE(acs.theme, a.theme)) = LOWER(?)")
            cond_params.append(theme)
        if category:
            conditions.append("LOWER(COALESCE(acs.category, a.category)) = LOWER(?)")
            cond_params.append(category)


    # Keyword filtering
    if keyword:
        kw_like = f"%{keyword.lower()}%"
        conditions.append("(LOWER(a.title) LIKE ? OR LOWER(a.summary) LIKE ?)")
        cond_params.extend([kw_like, kw_like])

    # Exclude 'forget' articles for this user
    if uid:
        conditions.append("""
            NOT EXISTS (
                SELECT 1 FROM user_interactions ui
                WHERE ui.article_id = a.id
                  AND ui.user_id = ?
                  AND ui.interaction_type = 'rate'
                  AND ui.value = 'forget'
            )
        """)
        cond_params.append(uid)

    # Feed name inclusion/exclusion (case-sensitive)
    if feed_include:
        conditions.append("a.feed_name LIKE ? COLLATE NOCASE")
        cond_params.append(f"%{feed_include}%")

    if feed_exclude:
        conditions.append("a.feed_name NOT LIKE ? COLLATE NOCASE")
        cond_params.append(f"%{feed_exclude}%")



    if join_clauses:
        query += "\n".join(join_clauses)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    # 3–5× limit is usually plenty for variety‐mode
    fetch_cap = limit * 5 if variety else limit

    query += " ORDER BY adj_score DESC LIMIT ?"   # NEW
    final_params = join_params + cond_params + [fetch_cap]


    # -------------------------------
    # 4. Execute Query
    # -------------------------------
    print("---- FINAL QUERY ----"); print(query)
    print("---- PARAMS ----");     print(final_params)


    cursor.execute(query, final_params)
    rows = cursor.fetchall()
    conn.close()

    articles = [
        {
            "id": row[0],
            "title": strip_emoji(row[1]),
            "url": row[2],
            "summary": row[3],
            "adj_score": row[4],
            "processed_date": row[5],
            "theme": row[6],
            "category": row[7],
            "published_date": row[8],                
            "feed_name": row[9],                     
            "related_count": row[10],                
            "incoming_related_count": row[11],       #          
        }
        for row in rows
    ]


    # -------------------------------
    # 5. Variety Mode
    # -------------------------------
    variety_mode = (
        variety and not theme and not category and limit >= 50 and len(articles) >= 50
    )

    if not variety_mode:
        return articles[:limit]

    # Pick top 1 per (theme, category)
    top_per_category = {}
    for art in articles:
        key = (art["theme"], art["category"])
        if key not in top_per_category:
            top_per_category[key] = art

    category_picks = list(top_per_category.values())
    selected_ids = {a["id"] for a in category_picks}
    remaining_pool = [a for a in articles if a["id"] not in selected_ids]

    overall_needed = max(0, limit - len(category_picks))
    overall_top = remaining_pool[:overall_needed]

    combined = category_picks + overall_top
    combined_ids = {a["id"] for a in combined}

    # Fill remaining slots if needed
    if len(combined) < limit:
        for art in remaining_pool[overall_needed:]:
            if art["id"] not in combined_ids:
                combined.append(art)
                combined_ids.add(art["id"])
                if len(combined) >= limit:
                    break

    return combined[:limit]


# -------------------------------
# Get Themes
# -------------------------------
@router.get("/themes", dependencies=[Depends(require_session)])
def get_themes(period: int = 7, corpus_id: Optional[str] = None, request: Request = None):
    corpus_id = _effective_corpus_id(request)
    if corpus_id is None:
        raise HTTPException(status_code=403, detail="no_corpus_membership")
    conn = get_conn()
    cursor = conn.cursor()

    since_date = (
        datetime.utcnow() - (timedelta(hours=24) if period <= 1 else timedelta(days=period))
    ).strftime("%Y-%m-%d %H:%M:%S")


    # Build JOIN and params depending on corpus_id
    if corpus_id:
        join = "JOIN article_corpus_scores acs ON acs.article_id = a.id AND acs.corpus_id = ?"
        params = [corpus_id]
    else:
        join = "LEFT JOIN article_corpus_scores acs ON acs.article_id = a.id"
        params = []

    params.append(since_date)

    cursor.execute(
        f"""
        SELECT DISTINCT COALESCE(acs.theme, a.theme) AS theme
        FROM articles a
        {join}
        WHERE COALESCE(acs.theme, a.theme) IS NOT NULL
          AND datetime(substr(REPLACE(a.processed_date,'T',' '),1,19)) >= ?
        ORDER BY theme COLLATE NOCASE
        """,
        params,
    )

    out = [r[0] for r in cursor.fetchall()]
    conn.close()
    return out

# Compat: also answer /themes and /themes/ (no /api) to squash old calls and trailing-slash typos.
@compat.get("/themes")
@compat.get("/themes/")
def get_themes_compat(period: int = 7, request: Request = None):
    return get_themes(period=period, request=request)
# -------------------------------
# Get Categories
# -------------------------------
@router.get("/categories/", dependencies=[Depends(require_session)])
def get_categories(
    period: int = 7,
    theme: Optional[str] = None,
    corpus_id: Optional[str] = None,
    request: Request = None,
):
    corpus_id = _effective_corpus_id(request)
    if corpus_id is None:
        raise HTTPException(status_code=403, detail="no_corpus_membership")

    conn = get_conn()
    cursor = conn.cursor()

    since_date = (
        datetime.utcnow() - (timedelta(hours=24) if period <= 1 else timedelta(days=period))
    ).strftime("%Y-%m-%d %H:%M:%S")


    # JOIN based on corpus_id
    if corpus_id:
        join = "JOIN article_corpus_scores acs ON acs.article_id = a.id AND acs.corpus_id = ?"
        params: list = [corpus_id, since_date]
    else:
        join = "LEFT JOIN article_corpus_scores acs ON acs.article_id = a.id"
        params: list = [since_date]

    clauses = [
        "COALESCE(acs.category, a.category) IS NOT NULL",
        "datetime(substr(REPLACE(a.processed_date,'T',' '),1,19)) >= ?",
    ]
    if theme:
        clauses.append("LOWER(COALESCE(acs.theme, a.theme)) = ?")
        params.append(theme.lower())

    sql = f"""
        SELECT DISTINCT COALESCE(acs.category, a.category) AS category
        FROM articles a
        {join}
        WHERE {' AND '.join(clauses)}
        ORDER BY category COLLATE NOCASE
    """

    cursor.execute(sql, params)
    
    out = [r[0] for r in cursor.fetchall()]
    conn.close()
    return out

@compat.get("/categories/")
def get_categories_compat(period: int = 7, theme: Optional[str] = None, request: Request = None):
    return get_categories(period=period, theme=theme, request=request)

# -------------------------------------
# Clusters and Groups
# --------------------------------------------
# --- helpers shared with both endpoints ---
def _common_filters_sql(params, *, period, keyword, liked, opened, unOpened, user_id, feed_include, feed_exclude, recency_by="processed"):
    conds, joins = [], []

    # “Last 24 hours” → silently expand to 48h when basis is Published
    if period <= 1:
        hours = 48 if str(recency_by).lower().startswith("pub") else 24
        since = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    else:
        since = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")
    date_expr = (
        "datetime(substr(REPLACE(COALESCE(a.published_date, a.processed_date), 'T', ' '), 1, 19))"
        if str(recency_by).lower().startswith("pub")
        else "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19))"
    )
    conds.append(f"{date_expr} >= ?")

    params.append(since)

    if keyword:
        kw = f"%{keyword.lower()}%"
        conds.append("(LOWER(a.title) LIKE ? OR LOWER(a.summary) LIKE ?)")
        params.extend([kw, kw])

    if liked and user_id:
        joins.append("""
         JOIN (
            SELECT article_id FROM (
              SELECT article_id, value, MAX(timestamp) AS last_ts
              FROM user_interactions
              WHERE interaction_type='rate' AND user_id=?
              GROUP BY article_id
            ) WHERE value='liked'
         ) ul ON a.id=ul.article_id
        """)
        params.append(user_id)

    if opened and user_id:
        conds.append("""
          EXISTS (
            SELECT 1 FROM user_interactions ui
            WHERE ui.user_id=? AND ui.interaction_type='open'
              AND ui.article_id=a.id AND ui.timestamp >= datetime('now', ?)
          )
        """)
        params.extend([user_id, f"-{int(period)} days"])

    if unOpened and user_id:
        joins.append("""
          LEFT JOIN (
            SELECT DISTINCT article_id FROM user_interactions
            WHERE interaction_type='open' AND user_id=?
          ) uo ON a.id=uo.article_id
        """)
        conds.append("uo.article_id IS NULL")
        params.append(user_id)

    if user_id:
        conds.append("""
          NOT EXISTS (
            SELECT 1 FROM user_interactions ui
            WHERE ui.article_id=a.id AND ui.user_id=? AND ui.interaction_type='rate' AND ui.value='forget'
          )
        """)
        params.append(user_id)

    if feed_include:
        conds.append("a.feed_name LIKE ?")
        params.append(f"%{feed_include}%")
    if feed_exclude:
        conds.append("a.feed_name NOT LIKE ?")
        params.append(f"%{feed_exclude}%")

    return joins, conds

@router.get("/article_clusters", dependencies=[Depends(require_session)])
def cluster_facets(
    period: float = 100,
    recency_by: str = "processed",
    keyword: Optional[str] = None,
    liked: bool = False,
    opened: bool = False,
    unOpened: bool = False,
    feed_include: Optional[str] = None,
    feed_exclude: Optional[str] = None,
    request: Request = None,
):
    # Resolve the authenticated person for personalization
    try:
        uid = current_account_id(request)
    except Exception:
        uid = None

    conn = get_conn()
    cur = conn.cursor()
    params: list = []
    joins, conds = _common_filters_sql(
        params,
        period=period,
        keyword=keyword,
        liked=liked,
        opened=opened,
        unOpened=unOpened,
        user_id=uid,
        feed_include=feed_include,
        feed_exclude=feed_exclude,
        recency_by=recency_by,
    )

    sql = f"""
      SELECT gm.group_id, gm.label, COUNT(*) AS cnt
      FROM group_manifest gm
      JOIN json_each(gm.member_article_ids) je
      JOIN articles a ON a.id = je.value
      {' '.join(joins)}
      WHERE gm.group_type='article_cluster'
        AND gm.label IS NOT NULL AND gm.label <> '' AND gm.label_source <> 'pending'
        {(' AND ' + ' AND '.join(conds)) if conds else ''}
      GROUP BY gm.group_id, gm.label
      HAVING cnt > 0
      ORDER BY gm.label COLLATE NOCASE
    """
    cur.execute(sql, params)
    rows = [{"group_id": r[0], "label": r[1], "count": r[2]} for r in cur.fetchall()]
    conn.close()
    return rows

@compat.get("/article_clusters")
def cluster_facets_compat(
    period: float = 100,
    keyword: Optional[str] = None,
    liked: bool = False,
    opened: bool = False,
    unOpened: bool = False,
    feed_include: Optional[str] = None,
    feed_exclude: Optional[str] = None,
    recency_by: str = "processed",
    request: Request = None,
):
    return cluster_facets(
        period=period,
        keyword=keyword,
        liked=liked,
        opened=opened,
        unOpened=unOpened,
        feed_include=feed_include,
        feed_exclude=feed_exclude,
        recency_by=recency_by,
        request=request,
    )


# readyz + daily brief

@router.get("/readyz", dependencies=[])
def readyz():
    try:
        c = get_conn(ro=True)
        c.execute("SELECT 1").fetchone()
        c.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

def ensure_daily_briefs_table():
    con = get_conn()
    con.execute("""
    CREATE TABLE IF NOT EXISTS daily_briefs (
      date TEXT PRIMARY KEY,
      title TEXT,
      summary_html TEXT,
      top_articles TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    con.commit(); con.close()

@router.on_event("startup")
def _startup_daily():
    ensure_daily_briefs_table()

@router.post("/daily-brief")
async def upsert_daily_brief(req: Request, token: Optional[str] = None):
    # auth
    
    if admin_token and token != admin_token:
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await req.json()

    date_str      = body.get("date") or datetime.now().date().isoformat()
    title         = body.get("title") or ""
    summary_html  = body.get("summary_html") or ""
    top_articles  = body.get("top_articles") or []
    if not isinstance(top_articles, (list, tuple)):
        top_articles = []
    top_json = json.dumps(list(top_articles), ensure_ascii=False)

    con = get_conn()
    con.execute("""
      INSERT INTO daily_briefs(date,title,summary_html,top_articles,updated_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET
        title=excluded.title,
        summary_html=excluded.summary_html,
        top_articles=excluded.top_articles,
        updated_at=CURRENT_TIMESTAMP
    """, (str(date_str), str(title), str(summary_html), top_json))
    con.commit(); con.close()
    return {"ok": True}

@router.get("/daily-brief")
def get_daily_brief(date: Optional[str] = None):
    conn = get_conn()
    cur = conn.cursor()
    if date:
        cur.execute("SELECT date,title,summary_html,top_articles FROM daily_briefs WHERE date=? LIMIT 1", (date,))
    else:
        cur.execute("SELECT date,title,summary_html,top_articles FROM daily_briefs ORDER BY date DESC LIMIT 1")
    row = cur.fetchone(); conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "date": row[0],
        "title": row[1] or "",
        "summary_html": row[2] or "",
        "top_articles": json.loads(row[3] or "[]"),
    }


@router.get("/article_related")
def get_article_related(article_id: int, limit: int = 50, min_score: float = 0.0):
    """
    Related (sibling) articles for a given seed, using related_articles edges:
      article_id -> related_id
    - Does NOT include the seed itself.
    - Sorted by published/processed recency DESC, then by similarity_score.
    - Read-only; does not change any existing behavior.
    """
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            a2.id,
            a2.title,
            a2.url,
            COALESCE(a2.feed_name, ''),
            a2.published_date,
            a2.processed_date, 
            a2.summary,
            COALESCE(ra.similarity_score, 0.0)
        FROM related_articles ra
        JOIN articles a2 ON a2.id = ra.related_id
        WHERE ra.article_id = ?
          AND COALESCE(ra.similarity_score, 0.0) >= ?
        ORDER BY
          COALESCE(a2.published_date, a2.processed_date) DESC,
          COALESCE(ra.similarity_score, 0.0) DESC
        LIMIT ?
    """, (article_id, float(min_score), int(limit)))
    rows = cur.fetchall()
    conn.close()

    return {
        "article_id": article_id,
        "count": len(rows),
        "siblings": [
            {
                "id": r[0],
                "title": strip_emoji(r[1]),
                "url": r[2],
                "feed_name": r[3],
                "published_date": r[4],
                "processed_date": r[5],
                "summary": r[6],
                "similarity_score": r[7],
            } for r in rows
        ],
    }



def _parse_iso(dt_str: Optional[str]):
    if not dt_str:
        return None
    s = dt_str.replace("T", " ")
    try:
        return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


@router.get("/article_collections")
def get_article_collections(
    ids: str = Query(..., description="Comma-separated article IDs that define the candidate set"),
    group_limit: int = 40,
    max_siblings: int = 50,
    min_similarity: float = 0.20,
    half_life_days: float = 7.0,
    min_group_size_to_seed: int = 2,
    corpus_id: Optional[str] = None,
    w_rel: float = 0.6,
    w_rec: float = 0.3,
    w_nov: float = 0.1,  
    request: Request = None,  
):
    """
    Build non-overlapping seed groups from the candidate set (ids),
    using a greedy coverage algorithm on related_articles.
    Exclusive coverage: an article appears at most once (as seed or sibling).
    seed_score = 0.6*relevance  0.3*recency  0.1*novelty
      - relevance: normalized article_corpus_scores.global_score (for corpus_id)
      - recency:   exp(-age / half_life)
      - novelty:   1 / (1 + incoming_related_count)
    """

    corpus_id = _effective_corpus_id(request)
    if corpus_id is None:
        raise HTTPException(status_code=403, detail="no_corpus_membership")
        
    # 1) Parse candidate IDs        
    try:
        cand_ids = [int(x) for x in ids.split(",") if x.strip()]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ids parameter")
    if not cand_ids:
        return {"params": {"count_candidates": 0}, "groups": []}

    conn = get_conn()
    cur = conn.cursor()

    # 2) Pull candidate rows with counts  optional relevance
    placeholders = ",".join("?" * len(cand_ids))
    params = list(cand_ids)

    join_score = (
      "LEFT JOIN article_corpus_scores s "
      "ON s.article_id = a.id AND s.corpus_id = ?"
    )
    score_sel = "COALESCE(s.combined_score, 0.0)"
    score_params = [corpus_id]  # can be None; that's OK


    if corpus_id is not None:
        join_score = "LEFT JOIN article_corpus_scores s ON s.article_id = a.id AND s.corpus_id = ?"
        score_sel = "COALESCE(s.combined_score, 0.0)"  # <-- was global_score
        score_params = [str(corpus_id)]

    cur.execute(f"""
        SELECT
            a.id,
            a.title,
            a.url,
            COALESCE(a.feed_name, ''),
            a.published_date,
            a.processed_date, a.summary,
            {score_sel} AS global_score,
            COALESCE((SELECT COUNT(*) FROM related_articles r WHERE r.article_id = a.id), 0) AS related_count,
            COALESCE((SELECT COUNT(*) FROM related_articles r WHERE r.related_id = a.id), 0) AS incoming_related_count
        FROM articles a
        {join_score}
        WHERE a.id IN ({placeholders})
    """, score_params + params)
    cand_rows = cur.fetchall()

    now = datetime.utcnow()

    # --- normalize weights safely (defaults preserved if invalid) ---
    try:
        wr, wrc, wnv = float(w_rel), float(w_rec), float(w_nov)
        if wr < 0 or wrc < 0 or wnv < 0:
            raise ValueError
        wsum = wr + wrc + wnv
        if wsum > 0:
            wr, wrc, wnv = wr/wsum, wrc/wsum, wnv/wsum
        else:
            wr, wrc, wnv = 0.6, 0.3, 0.1
    except Exception:
        wr, wrc, wnv = 0.6, 0.3, 0.1


    # cand_rows columns: id(0), title(1), url(2), feed(3), published(4), processed(5), summary(6), global_score(7), out_deg(8), in_deg(9)
    gs = [row[7] for row in cand_rows] if cand_rows else []
    # relevance normalization
    if gs:
        gmin, gmax = min(gs), max(gs)
        gspan = (gmax - gmin) if (gmax > gmin) else 0.0
    else:
        gmin, gmax, gspan = 0.0, 0.0, 0.0

    def norm_rel(g):
        if gspan <= 0.0:
            return 0.0
        return max(0.0, (g - gmin) / gspan)

    def recency_of(pd_str, pr_str):
        dt = _parse_iso(pd_str) or _parse_iso(pr_str)
        if not dt:
            return 0.0
        age_sec = (now - dt).total_seconds()
        hl = max(half_life_days, 0.1) * 86400.0
        return exp(-age_sec / hl)

    candidates = []
    for r in cand_rows:
        cid, title, url, feed, pd, pr,summary, gscore, out_deg, in_deg = r
        relevance = norm_rel(gscore or 0.0)
        recency = recency_of(pd, pr)
        novelty = 1.0 / (1.0 + float(in_deg or 0))

        # seed_score = 0.6 * relevance + 0.3 * recency + 0.1 * novelty
        # weighted seed score (relevance from article_corpus_scores, recency half-life, novelty from incoming edges)
        seed_score = (wr * relevance) + (wrc * recency) + (wnv * novelty)
        candidates.append({
            "id": cid, "title": title, "url": url, "feed_name": feed,
            "published_date": pd, "processed_date": pr, "summary": summary,
            "global_score": gscore or 0.0,
            "related_count": int(out_deg or 0),
            "incoming_related_count": int(in_deg or 0),
            "seed_score": seed_score,
        })

    # 4) Greedy exclusive coverage
    candidates.sort(key=lambda x: x["seed_score"], reverse=True)
    covered = set()
    groups = []

    for cand in candidates:
        if len(groups) >= group_limit:
            break
        if cand["id"] in covered:
            continue
        if cand["related_count"] < min_group_size_to_seed:
            continue  # skip weak/singleton seeds

        # Fetch siblings for this seed
        cur.execute("""
            SELECT
                a2.id, a2.title, a2.url, COALESCE(a2.feed_name, ''),
                a2.published_date, a2.processed_date, a2.summary,
                COALESCE(ra.similarity_score, 0.0)
            FROM related_articles ra
            JOIN articles a2 ON a2.id = ra.related_id
            WHERE ra.article_id = ?
              AND COALESCE(ra.similarity_score, 0.0) >= ?
            ORDER BY
              datetime(replace(substr(COALESCE(a2.published_date, a2.processed_date),1,19),'T',' ')) DESC,
              COALESCE(ra.similarity_score, 0.0) DESC,
              a2.id DESC
            LIMIT ?
        """, (cand["id"], float(min_similarity), int(max_siblings)))
        sib_rows = cur.fetchall()

        sibs = [
            {
                "id": s[0], "title": strip_emoji(s[1]), "url": s[2], "feed_name": s[3],
                "published_date": s[4], "processed_date": s[5], "summary": s[6],
                "similarity_score": s[7],
            }
            for s in sib_rows if s[0] not in covered
        ]

        members = [{"id": cand["id"], "title": strip_emoji(cand["title"]), "url": cand["url"],
                    "feed_name": cand["feed_name"], "published_date": cand["published_date"],
                    "processed_date": cand["processed_date"], "summary": cand["summary"], 
                    "similarity_score": 1.0}] + sibs

        if len(members) < 2:
            continue

        for m in members:
            covered.add(m["id"])

        src_counts = Counter([m["feed_name"] for m in members if m["feed_name"]])
        top_sources = [src for src, _ in src_counts.most_common(5)]

        groups.append({
            "seed": {
                "id": cand["id"],
                "title": strip_emoji(cand["title"]),
                "url": cand["url"],
                "feed_name": cand["feed_name"],
                "published_date": cand["published_date"],
                "processed_date": cand["processed_date"],
                "seed_score": cand["seed_score"],
                "related_count": cand["related_count"],
                "incoming_related_count": cand["incoming_related_count"],
                "global_score": cand["global_score"],
            },
            "members": members,
            "top_sources": top_sources,
        })

    conn.close()
    return {
        "params": {
            "count_candidates": len(candidates),
            "group_limit": group_limit,
            "max_siblings": max_siblings,
            "min_similarity": min_similarity,
            "half_life_days": half_life_days,
            "min_group_size_to_seed": min_group_size_to_seed,
            "corpus_id": corpus_id,
            "exclusive": True,
            "weights": {"relevance": wr, "recency": wrc, "novelty": wnv}  # normalized for transparency
        },
        "groups": groups
    }


api_router = router
compat_router = compat