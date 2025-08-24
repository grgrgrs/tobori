from fastapi import APIRouter, Query
from typing import List, Optional
from datetime import datetime, timedelta
import os, sqlite3, json
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from pathlib import Path

router = APIRouter()

# DB_PATH = "/data/articles.db"
IS_FLY = bool(os.getenv("FLY_APP_NAME") or os.getenv("FLY_ALLOC_ID"))
# local default: ../article-database/sqlite/articles.db (relative to repo root)
DEFAULT_LOCAL_DB = str(
    Path(__file__).resolve().parents[2] / "article-database" / "sqlite" / "articles.db"
)
DB_PATH = os.getenv("SQLITE_PATH", "/data/articles.db" if IS_FLY else DEFAULT_LOCAL_DB)

print(f"[DB] Using {DB_PATH}")

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
    "%arXiv%": 0.75,
    "%Reddit%": 0.6,
    "%BioRxiv%": 0.70,
    "%GR%": 1.25
}


@router.get("/api/liked_articles")
def get_liked_articles(user_id: str):
    conn = sqlite3.connect(DB_PATH)
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
@router.get("/api/articles")
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
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()


    # -------------------------------
    # 1. Base Query
    # -------------------------------
    # Build CASE expression for adj_score
    case_clauses = []
    for pattern, multiplier in FEED_ADJUSTMENTS.items():
        case_clauses.append(f"WHEN a.feed_name LIKE '{pattern}' THEN a.confidence_score * {multiplier}")

    adj_score_sql = f"""
        CASE
            {' '.join(case_clauses)}
            ELSE a.confidence_score
        END
    """

    query = f"""
        SELECT a.id,
               a.title,
               a.url,
               a.summary,
               {adj_score_sql} AS adj_score,
               a.processed_date,
               a.theme,
               a.category
        FROM articles a
    """
    params = []
    join_params = []
    cond_params = []
    join_clauses = []
    conditions = []
    
    # -------------------------------
    # 2. Liked / Opened Subqueries
    # -------------------------------
    if liked and user_id:
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
        join_params.append(user_id)

    if opened and user_id:
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
        cond_params.extend([user_id, f"-{int(period)} days"])


    if unOpened and user_id:
        unopened_subquery = """
            SELECT DISTINCT article_id
            FROM user_interactions
            WHERE interaction_type='open' AND user_id = ?
        """
        join_clauses.append(f"LEFT JOIN ({unopened_subquery}) uuo ON a.id = uuo.article_id")
        conditions.append("uuo.article_id IS NULL")
        join_params.append(user_id)



    # -------------------------------
    # 3. Filters
    # -------------------------------


    # Handle period filtering using processed_date
    if period <= 1:
        since_date = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
        conditions.append(
            "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19)) >= ?"
        )
        cond_params.append(since_date)
    else:
        since_date = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")
        conditions.append(
            "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19)) >= ?"
        )
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
            conditions.append("a.theme = ?"); cond_params.append(theme)
            if category:
                conditions.append("a.category = ?"); cond_params.append(category)


    # Keyword filtering
    if keyword:
        kw_like = f"%{keyword.lower()}%"
        conditions.append("(LOWER(a.title) LIKE ? OR LOWER(a.summary) LIKE ?)")
        cond_params.extend([kw_like, kw_like])

    # Exclude 'forget' articles for this user
    if user_id:
        conditions.append("""
            NOT EXISTS (
                SELECT 1 FROM user_interactions ui
                WHERE ui.article_id = a.id
                  AND ui.user_id = ?
                  AND ui.interaction_type = 'rate'
                  AND ui.value = 'forget'
            )
        """)
        cond_params.append(user_id)

    # Feed name inclusion/exclusion (case-sensitive)
    if feed_include:
        conditions.append("a.feed_name LIKE ?")
        cond_params.append(f"%{feed_include}%")

    if feed_exclude:
        conditions.append("a.feed_name NOT LIKE ?")
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
            "title": row[1],
            "url": row[2],
            "summary": row[3],
            "adj_score": row[4],
            "processed_date": row[5],
            "theme": row[6],
            "category": row[7],
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
@router.get("/themes/")
def get_themes(period: int = 7):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    since_date = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        SELECT DISTINCT theme
        FROM articles
        WHERE theme IS NOT NULL
          AND datetime(substr(REPLACE(processed_date, 'T', ' '), 1, 19)) >= ?
        ORDER BY theme
    """, (since_date,))
    themes = [row[0] for row in cursor.fetchall()]
    conn.close()
    return themes


# -------------------------------
# Get Categories
# -------------------------------
@router.get("/categories/")
def get_categories(period: int = 7, theme: Optional[str] = None):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    since_date = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")

    query = """
        SELECT DISTINCT category
        FROM articles
        WHERE category IS NOT NULL
          AND datetime(substr(REPLACE(processed_date, 'T', ' '), 1, 19)) >= ?
    """
    params = [since_date]

    # ✅ If theme is provided, filter categories by that theme
    if theme:
        query += " AND theme = ?"
        params.append(theme)

    query += " ORDER BY category"

    cursor.execute(query, params)
    categories = [row[0] for row in cursor.fetchall()]
    conn.close()
    return categories

# -------------------------------------
# Clusters and Groups
# --------------------------------------------
# --- helpers shared with both endpoints ---
def _common_filters_sql(params, *, period, keyword, liked, opened, unOpened, user_id, feed_include, feed_exclude):
    from datetime import datetime, timedelta
    conds, joins = [], []

    since = (datetime.utcnow() - (timedelta(hours=24) if period <= 1 else timedelta(days=period))).strftime("%Y-%m-%d %H:%M:%S")
    conds.append("datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19)) >= ?")
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

@router.get("/article_clusters")
def cluster_facets(
    period: float = 100,
    keyword: Optional[str] = None,
    liked: bool = False,
    opened: bool = False,
    unOpened: bool = False,
    user_id: Optional[str] = None,
    feed_include: Optional[str] = None,
    feed_exclude: Optional[str] = None,
):
    conn = sqlite3.connect(DB_PATH); cur = conn.cursor()
    params: list = []
    joins, conds = _common_filters_sql(params, period=period, keyword=keyword, liked=liked,
                                       opened=opened, unOpened=unOpened, user_id=user_id,
                                       feed_include=feed_include, feed_exclude=feed_exclude)

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

# readyz + daily brief

# --- readyz + daily brief  ---
def _conn(ro: bool = False):
    mode = 'ro' if ro else 'rw'
    uri = f"file:{DB_PATH}?mode={mode}"
    if ro and not os.path.exists(DB_PATH):
        raise FileNotFoundError(DB_PATH)
    c = sqlite3.connect(uri, uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c

@router.get("/api/readyz")
def readyz():
    try:
        c = _conn(ro=True)
        c.execute("SELECT 1").fetchone()
        c.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

def ensure_daily_briefs_table():
    con = sqlite3.connect(DB_PATH)
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

@router.post("/api/daily-brief")
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

    con = sqlite3.connect(DB_PATH)
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

@router.get("/api/daily-brief")
def get_daily_brief(date: Optional[str] = None):
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    if date:
        cur.execute("SELECT date,title,summary_html,top_articles FROM daily_briefs WHERE date=? LIMIT 1", (date,))
    else:
        cur.execute("SELECT date,title,summary_html,top_articles FROM daily_briefs ORDER BY date DESC LIMIT 1")
    row = cur.fetchone(); con.close()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "date": row[0],
        "title": row[1] or "",
        "summary_html": row[2] or "",
        "top_articles": json.loads(row[3] or "[]"),
    }



