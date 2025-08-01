#!/usr/bin/env bash
set -euo pipefail

# --- Directories ---
TOBORI_DIR="/c/Users/georg/Documents/Projects/tobori"
SQL_DIR="/c/Users/georg/Documents/Projects/article-database"
cd "$TOBORI_DIR"

# --- Fly Config ---
APP_NAME="tobori-sql"
DB_PATH="/sqlite/articles.db"

# --- Logging ---
LOG_DIR="$TOBORI_DIR/logs"
mkdir -p "$LOG_DIR"
DATE_STR=$(date +%Y%m%d)
LOG_FILE="$LOG_DIR/nightly_${DATE_STR}.txt"

exec > >(tee "$LOG_FILE") 2>&1

echo "🔹 Starting nightly ingestion for $DATE_STR"

# --- STEP 1: Backup DB ---
echo "🔹 Creating DB backup on Fly volume..."
fly ssh console -a "$APP_NAME" --command "cp $DB_PATH \${DB_PATH%.db}_backup_${DATE_STR}.db"

# --- STEP 2: Upload & Execute insert_articles.sql ---
if [[ -f "$SQL_DIR/insert_articles.sql" ]]; then
    echo "🔹 Uploading insert_articles.sql via SFTP..."
    printf 'put "%s/insert_articles.sql" /insert_articles.sql\nquit\n' "$SQL_DIR" | fly ssh sftp shell "$APP_NAME"

    echo "🔹 Executing insert_articles.sql..."
    fly ssh console -a "$APP_NAME" --command "sh -c 'sqlite3 $DB_PATH < /insert_articles.sql'"
else
    echo "⚠ insert_articles.sql not found in $SQL_DIR, skipping insert"
fi

# --- STEP 3: Upload & Execute prune_old_articles.sql ---
if [[ -f "$SQL_DIR/prune_old_articles.sql" ]]; then
    echo "🔹 Uploading prune_old_articles.sql via SFTP..."
    printf 'put "%s/prune_old_articles.sql" /prune_old_articles.sql\nquit\n' "$SQL_DIR" | fly ssh sftp shell "$APP_NAME"
else
    echo "🔹 Generating prune_old_articles.sql dynamically..."
    cat > prune_generated.sql <<'EOF'
-- Delete old, low-confidence, unliked articles
DELETE FROM articles
WHERE id NOT IN (SELECT DISTINCT article_id FROM user_interactions)
  AND (
       (published_date < DATE('now', '-30 day') AND confidence_score < 0.05)
    OR (published_date < DATE('now', '-45 day') AND confidence_score < 0.10)
    OR (published_date < DATE('now', '-60 day') AND confidence_score < 0.15)
    OR (published_date < DATE('now', '-90 day') AND confidence_score < 0.20)
  );

-- Remove orphaned article texts
DELETE FROM article_texts
WHERE article_id NOT IN (SELECT id FROM articles);

-- Reclaim space
VACUUM;
EOF
    printf 'put prune_generated.sql /prune_old_articles.sql\nquit\n' | fly ssh sftp shell "$APP_NAME"
fi

echo "🔹 Executing prune_old_articles.sql..."
fly ssh console -a "$APP_NAME" --command "sh -c 'sqlite3 $DB_PATH < /prune_old_articles.sql'"

# --- STEP 4: Log job run ---
echo "🔹 Creating and uploading log_job.sql..."
cat > log_job.sql <<'EOF'
INSERT INTO job_runs (job_name, purpose, start_time, end_time, run_time_sec, status, trigger)
VALUES ('nightly_ingest', 'insert+prune', datetime('now','-5 minutes'), datetime('now'), 300, 'success', 'external_push');
EOF

printf 'put log_job.sql /log_job.sql\nquit\n' | fly ssh sftp shell "$APP_NAME"

echo "🔹 Executing log_job.sql..."
fly ssh console -a "$APP_NAME" --command "sh -c 'sqlite3 $DB_PATH < /log_job.sql'"

# --- STEP 5: Cleanup ---
echo "🔹 Cleaning up remote temp files..."
fly ssh console -a "$APP_NAME" --command "rm -f /insert_articles.sql /prune_old_articles.sql /log_job.sql"

rm -f sftp_commands.txt prune_generated.sql log_job.sql

echo "✅ Nightly ingestion and pruning completed for $DATE_STR"
echo "Log saved to $LOG_FILE"
