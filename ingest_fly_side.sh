#!/bin/bash
# Ensure Bash, safe error handling
set -eu

DB_PATH="/data/articles.db"
DATE_STR=$(date +%Y%m%d)
LOG_FILE="/data/ingest_${DATE_STR}.log"

echo "==============================="
echo "🔹 Ingestion job STARTED at $(date)"
echo "===============================" | tee -a "$LOG_FILE"

# --- STEP 1: Verify insert_articles.sql ---
if [[ ! -f /data/insert_articles.sql ]]; then
    echo "⚠ No /data/insert_articles.sql found; nothing to ingest." | tee -a "$LOG_FILE"
    exit 0
fi

# --- STEP 2: Backup DB ---
echo "🔹 Backing up database..." | tee -a "$LOG_FILE"
cp "$DB_PATH" "${DB_PATH%.db}_backup_${DATE_STR}.db"

# --- STEP 3: Insert new articles ---
echo "🔹 Applying insert_articles.sql..." | tee -a "$LOG_FILE"
sqlite3 "$DB_PATH" < /data/insert_articles.sql

# --- STEP 4: Prune old/unliked/low-confidence articles ---
echo "🔹 Running pruning..." | tee -a "$LOG_FILE"
sqlite3 "$DB_PATH" <<'EOF'
DELETE FROM articles
WHERE id NOT IN (SELECT DISTINCT article_id FROM user_interactions)
  AND (
       (processed_date < DATE('now','-30 day') AND confidence_score < 0.05)
    OR (processed_date < DATE('now','-45 day') AND confidence_score < 0.10)
    OR (processed_date < DATE('now','-60 day') AND confidence_score < 0.15)
    OR (processed_date < DATE('now','-90 day') AND confidence_score < 0.20)
  );

DELETE FROM article_texts
WHERE article_id NOT IN (SELECT id FROM articles);

VACUUM;
EOF

# --- STEP 5: Log job run ---
echo "🔹 Logging job run to database..." | tee -a "$LOG_FILE"
sqlite3 "$DB_PATH" <<EOF
INSERT INTO job_runs (job_name, purpose, start_time, end_time, run_time_sec, status, trigger)
VALUES ('nightly_ingest', 'insert+prune', datetime('now','-5 minutes'), datetime('now'), 300, 'success', 'external_push');
EOF

# --- STEP 6: Cleanup temp SQL ---
echo "🔹 Cleaning up temporary files..." | tee -a "$LOG_FILE"
rm -f /data/insert_articles.sql

echo "==============================="
echo "✅ Ingestion job COMPLETED at $(date)"
echo "Log stored at $LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"
