from fastapi import APIRouter
import sqlite3
from datetime import datetime, timedelta

router = APIRouter()

DB_PATH = "/data/articles.db"


def fetch_articles(limit=100, liked_only=False):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if liked_only:
        query = """
        SELECT a.title, a.url, a.summary, a.confidence_score, a.published_date, a.theme, a.category
        FROM articles a
        JOIN user_interactions ui ON a.id = ui.article_id
        WHERE ui.liked = 1
        ORDER BY a.confidence_score DESC
        LIMIT ?
        """
        cursor.execute(query, (limit,))
    else:
        query = """
        SELECT title, url, summary, confidence_score, published_date, theme, category
        FROM articles
        ORDER BY confidence_score DESC
        LIMIT ?
        """
        cursor.execute(query, (limit,))

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "title": row[0],
            "url": row[1],
            "summary": row[2],
            "score": row[3],
            "published_date": row[4],
            "theme": row[5],
            "category": row[6],
        }
        for row in rows
    ]


@router.get("/articles")
async def get_articles():
    return fetch_articles(limit=200)


@router.get("/articles/liked")
async def get_liked_articles():
    return fetch_articles(limit=200, liked_only=True)


@router.get("/home_articles")
async def get_home_articles():
    """
    Returns:
    1. The top article in each category in the last 24h
    2. Then the top N overall in the last 24h
    3. Falls back to top 15 overall if none are recent
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    now = datetime.utcnow()
    since24 = (now - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")

    # 1. Top article per category in last 24 hours
    cursor.execute("""
        SELECT DISTINCT category
        FROM articles
        WHERE published_date >= ?
        ORDER BY category
    """, (since24,))
    categories = [row[0] for row in cursor.fetchall()]

    articles = []
    seen_urls = set()

    for cat in categories:
        cursor.execute("""
            SELECT title, url, summary, confidence_score, published_date, theme, category
            FROM articles
            WHERE category = ? AND published_date >= ?
            ORDER BY confidence_score DESC
            LIMIT 1
        """, (cat, since24))
        row = cursor.fetchone()
        if row and row[1] not in seen_urls:
            articles.append({
                "title": row[0],
                "url": row[1],
                "summary": row[2],
                "confidence_score": row[3],
                "published": row[4],
                "theme": row[5],
                "category": row[6],
            })
            seen_urls.add(row[1])

    # 2. Add top 10 overall in last 24 hours (not already included)
    cursor.execute("""
        SELECT title, url, summary, confidence_score, published_date, theme, category
        FROM articles
        WHERE published_date >= ?
        ORDER BY confidence_score DESC
        LIMIT 10
    """, (since24,))
    for row in cursor.fetchall():
        if row[1] not in seen_urls:
            articles.append({
                "title": row[0],
                "url": row[1],
                "summary": row[2],
                "confidence_score": row[3],
                "published": row[4],
                "theme": row[5],
                "category": row[6],
            })
            seen_urls.add(row[1])

    conn.close()

    # 3. Fallback to top 15 overall if nothing recent
    if not articles:
        return fetch_articles(limit=15)
    articles.sort(key=lambda x: x["confidence_score"], reverse=True)
    return articles
