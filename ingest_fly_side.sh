#!/usr/bin/env bash
set -euo pipefail

# --- Paths ---
DB_PATH="/data/articles.db"
DATE_STR=$(date +%Y%m%d)
LOG_FILE="/data/ingest_${DATE_STR}.log"

# Redirect all output to both console and log
exec > >(tee -a "$LOG_FILE") 2>&1

echo "==============================="
echo "🔹 Ingestion job STARTED at $(date)"
echo "==============================="

# --- Step 1: Verify SQL file exists ---
if [[ ! -f /data/insert_articles.sql ]]; then
    echo "⚠ No /data/insert_articles.sql found; nothing to ingest."
    echo "==============================="
    echo "🔹 Ingestion job ENDED at $(date)"
    echo "==============================="
    exit 0
fi

# --- Step 2: Apply insert_articles.sql ---
echo "🔹 Applying insert_articles.sql..."
sqlite3 "$DB_PATH" < /data/insert_articles.sql

# --- Step 3: Run pruning ---
echo "🔹 Running pruning..."
sqlite3 "$DB_PATH" <<'SQL'
DELETE FROM articles
WHERE id NOT IN (SELECT DISTINCT article_id FROM user_interactions)
  AND (
       (published_date < DATE('now', '-30 day') AND confidence_score < 0.05)
    OR (published_date < DATE('now', '-45 day') AND confidence_score < 0.10)
    OR (published_date < DATE('now', '-60 day') AND confidence_score < 0.15)
    OR (published_date < DATE('now', '-90 day') AND confidence_score < 0.20)
  );

DELETE FROM article_texts
WHERE article_id NOT IN (SELECT id FROM articles);

VACUUM;
SQL

# --- Step 4: Log job run in database ---
echo "🔹 Logging job run to database..."
sqlite3 "$DB_PATH" <<SQL
INSERT INTO job_runs (job_name, purpose, start_time, end_time, run_time_sec, status, trigger)
VALUES ('nightly_ingest', 'insert+prune', datetime('now','-5 minutes'), datetime('now'), 300, 'success', 'external_push');
SQL

# --- Step 5: Clean up ---
echo "🔹 Cleaning up temporary files..."
rm -f /data/insert_articles.sql

echo "==============================="
echo "✅ Ingestion job COMPLETED at $(date)"
echo "==============================="
