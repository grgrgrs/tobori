#!/usr/bin/env bash
export PATH="$HOME/.fly/bin:$PATH"

#  safety check
command -v fly >/dev/null 2>&1 || { 
    echo "❌ 'fly' not found in PATH (WSL). Install or symlink flyctl."
    exit 1
}
set -euo pipefail

DATESTAMP=$(date +%Y%m%d)
APP_NAME="tobori-sql"
REMOTE_SQL="/data/insert_articles_${DATESTAMP}.sql"
LOCAL_SQL="../article-database/insert_articles.sql"
LOG_FILE="./logs/ingest_${DATESTAMP}_fly.log"

echo "=== Starting Fly.io Daily Ingest for ${DATESTAMP} ==="

command -v fly >/dev/null 2>&1 || { echo "❌ 'fly' not found in PATH (WSL). Install or symlink flyctl."; exit 1; }
mkdir -p logs

# --- 1. Upload SQL into /data ---
echo "🔹 Uploading SQL to Fly via tar stream..."
tar -C ../article-database -cf - insert_articles.sql | \
  fly ssh console -a "$APP_NAME" --command \
  "sh -c 'cd /data && tar xf - && mv insert_articles.sql insert_articles_${DATESTAMP}.sql && ls -lh insert_articles_${DATESTAMP}.sql'" || {
    echo "❌ Upload failed."
    exit 1
}

# --- 1.5 Rename to what the ingest script expects ---
echo "🔹 Renaming uploaded SQL file for ingestion..."
fly ssh console -a "$APP_NAME" --command \
  "sh -c 'cp /data/insert_articles_${DATESTAMP}.sql /data/insert_articles.sql'" || {
  echo "❌ Rename failed"
  exit 1
}

# --- 1.6 Prune old DB backups (keep latest 2) ---
echo "🔹 Pruning old /data DB backups on Fly (keeping latest 2)..."
fly ssh console -a "$APP_NAME" --command \
  "bash -lc '
    shopt -s nullglob
    cd /data
    # list newest-first; remove everything after the first 2
    files=( \$(ls -1t articles_backup_*.db 2>/dev/null) )
    if (( \${#files[@]} > 2 )); then
      printf \"%s\0\" \"\${files[@]:2}\" | xargs -0 rm -f
    fi
    # Show what remains for sanity
    ls -lh articles_backup_*.db 2>/dev/null || true
  '"

echo "🔹 Pruning old /data SQL files (keeping latest 5)..."
fly ssh console -a "$APP_NAME" --command \
  "bash -lc '
    shopt -s nullglob
    cd /data
    files=( \$(ls -1t insert_articles_*.sql 2>/dev/null) )
    if (( \${#files[@]} > 5 )); then
      printf \"%s\0\" \"\${files[@]:5}\" | xargs -0 rm -f
    fi
  '"


# --- 2. Trigger ingestion on Fly ---
echo "🔹 Triggering ingestion job on Fly..."
fly ssh console -a "$APP_NAME" --command \
  "sh -c '/app/ingest_fly_side.sh /data/ingest_${DATESTAMP}.log'" || {
  echo "❌ Ingestion failed"
  exit 1
}

# --- 3. Fetch logs ---
echo "🔹 Fetching Fly log to local logs folder..."
mkdir -p logs
fly ssh console -a "$APP_NAME" --command "cat /data/ingest_${DATESTAMP}.log" > "$LOG_FILE" || {
  echo "⚠ Failed to fetch log"
}

echo "✅ Daily ingestion completed."
echo "Local log: $LOG_FILE"
