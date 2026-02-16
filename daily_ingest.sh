#!/usr/bin/env bash
export PATH="$HOME/.fly/bin:$PATH"
set -euo pipefail

DATESTAMP=$(date +%Y%m%d)
APP_NAME="tobori"

# Local + remote paths
LOCAL_SQL="../article-database/insert_articles.sql"
REMOTE_SQL="/data/insert_articles_${DATESTAMP}.sql"
REMOTE_SQL_LINK="/data/insert_articles.sql"
REMOTE_TMP="/app/tmp_upload"

LOG_FILE="./logs/ingest_${DATESTAMP}_fly.log"

echo "=== Starting Fly.io Daily Ingest for ${DATESTAMP} ==="

# --- safety: ensure fly is available ---
if ! command -v fly >/dev/null 2>&1; then
  echo "❌ 'fly' not found in PATH (WSL). Install or adjust PATH."
  exit 1
fi

mkdir -p logs

# --- 1. Ensure remote temp directory exists ---
echo "🔹 Ensuring remote temp directory exists..."
fly ssh console -a "$APP_NAME" --command \
  "sh -c 'mkdir -p ${REMOTE_TMP}'"

# --- 2. Upload SQL to /app/tmp_upload safely via tar ---
echo "🔹 Uploading SQL to /app/tmp_upload (SAFE)..."
tar -C ../article-database -cf - insert_articles.sql | \
  fly ssh console -a "$APP_NAME" --command \
    "sh -c 'cd ${REMOTE_TMP} && tar xf - && ls -lh ${REMOTE_TMP}/insert_articles.sql'" \
  || { echo '❌ Upload failed'; exit 1; }

# --- 3. Copy SQL from /app/tmp_upload to /data ---
echo "🔹 Copying SQL to /data..."
fly ssh console -a "$APP_NAME" --command \
  "sh -c 'cp ${REMOTE_TMP}/insert_articles.sql ${REMOTE_SQL}'" \
  || { echo '❌ SQL copy failed'; exit 1; }

# --- 4. Set /data/insert_articles.sql symlink/copy that ingest script expects ---
echo "🔹 Creating /data/insert_articles.sql copy..."
fly ssh console -a "$APP_NAME" --command \
  "sh -c '[ -f ${REMOTE_SQL_LINK} ] && rm -f ${REMOTE_SQL_LINK}; cp ${REMOTE_SQL} ${REMOTE_SQL_LINK}'" \
  || { echo '❌ Failed to set ingestion SQL'; exit 1; }

# --- 5. Prune old DB backups (keep latest 2) safely ---
echo "🔹 Pruning old /data DB backups (keep latest 2)..."
fly ssh console -a "$APP_NAME" --command \
  "bash -lc '
    cd /data
    shopt -s nullglob
    # This expands ONLY to real matching files, or empty if none
    files=(articles_backup_*.db)
    if (( \${#files[@]} > 2 )); then
      # keep the first 2 (newest), prune the rest
      printf \"%s\0\" \"\${files[@]:2}\" | xargs -0 rm -f
    fi
    ls -lh articles_backup_*.db 2>/dev/null || true
  '"

# --- 6. Prune old SQL files (keep latest 5) safely ---
echo "🔹 Pruning old /data SQL files (keep latest 5)..."
fly ssh console -a "$APP_NAME" --command \
  "bash -lc '
    cd /data
    shopt -s nullglob
    files=(insert_articles_*.sql)
    if (( \${#files[@]} > 5 )); then
      printf \"%s\0\" \"\${files[@]:5}\" | xargs -0 rm -f
    fi
  '"

# --- 7. Trigger ingestion job on Fly (run under bash) ---
echo "🔹 Triggering ingestion job on Fly..."
fly ssh console -a "$APP_NAME" --command \
  "bash -lc \"/usr/bin/env bash /app/ingest_fly_side.sh /data/ingest_${DATESTAMP}.log\"" \
  || { echo '❌ Remote ingestion failed'; exit 1; }

# --- 8. Fetch remote ingest log back to local ---
echo "🔹 Fetching Fly log to local logs folder..."
if fly ssh console -a "$APP_NAME" --command "cat /data/ingest_${DATESTAMP}.log" > "$LOG_FILE"; then
  echo "✅ Ingestion log saved to $LOG_FILE"
else
  echo "⚠️ Failed to fetch log (log file may be missing)."
fi

echo "✅ Daily ingestion completed."
echo "Local log: $LOG_FILE"
