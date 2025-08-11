from fastapi import APIRouter, Query
from typing import List, Optional
import sqlite3
from datetime import datetime, timedelta

router = APIRouter()

DB_PATH = "/data/articles.db"

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
        params.append(user_id)

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
        params.extend([user_id, f"-{int(period)} days"])


    if unOpened and user_id:
        unopened_subquery = """
            SELECT DISTINCT article_id
            FROM user_interactions
            WHERE interaction_type='open' AND user_id = ?
        """
        join_clauses.append(f"LEFT JOIN ({unopened_subquery}) uuo ON a.id = uuo.article_id")
        conditions.append("uuo.article_id IS NULL")
        params.append(user_id)

    if join_clauses:
        query += "\n".join(join_clauses)

    # -------------------------------
    # 3. Filters
    # -------------------------------


    # Handle period filtering using processed_date
    if period <= 1:
        since_date = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
        conditions.append(
            "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19)) >= ?"
        )
        params.append(since_date)
    else:
        since_date = (datetime.utcnow() - timedelta(days=period)).strftime("%Y-%m-%d %H:%M:%S")
        conditions.append(
            "datetime(substr(REPLACE(a.processed_date, 'T', ' '), 1, 19)) >= ?"
        )
        params.append(since_date)


    # Theme and category
    if theme:
        conditions.append("a.theme = ?")
        params.append(theme)
        if category:
            conditions.append("a.category = ?")
            params.append(category)

    # Keyword filtering
    if keyword:
        kw_like = f"%{keyword.lower()}%"
        conditions.append("(LOWER(a.title) LIKE ? OR LOWER(a.summary) LIKE ?)")
        params.extend([kw_like, kw_like])

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
        params.append(user_id)

    # Feed name inclusion/exclusion (case-sensitive)
    if feed_include:
        conditions.append("a.feed_name LIKE ?")
        params.append(f"%{feed_include}%")

    if feed_exclude:
        conditions.append("a.feed_name NOT LIKE ?")
        params.append(f"%{feed_exclude}%")

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    # 3–5× limit is usually plenty for variety‐mode
    fetch_cap = limit * 5 if variety else limit

    query += " ORDER BY adj_score DESC LIMIT ?"   # NEW
    params.append(fetch_cap)


    # -------------------------------
    # 4. Execute Query
    # -------------------------------
    print("---- FINAL QUERY ----")
    print(query)
    print("---- PARAMS ----")
    print(params)


    cursor.execute(query, params)
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
