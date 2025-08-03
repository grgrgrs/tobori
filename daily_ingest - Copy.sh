#!/usr/bin/env bash
# Robust daily ingestion script for Tobori -> Fly.io
set -Eeuo pipefail

# -------------------------
# Auto-detect directories
# -------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOBORI_DIR="$SCRIPT_DIR"                       # where the script lives
SQL_DIR="$SCRIPT_DIR/../article-database"      # assumes parallel folder

APP_NAME="tobori-sql"
DB_PATH="/data/articles.db"

LOG_DIR="$TOBORI_DIR/logs"
mkdir -p "$LOG_DIR"
DATE_STR=$(date +%Y%m%d)
LOCAL_LOG="$LOG_DIR/ingest_${DATE_STR}.log"
FLY_LOG_REMOTE="/data/ingest_${DATE_STR}.log"
FLY_LOG_LOCAL="$LOG_DIR/ingest_${DATE_STR}_fly.log"

exec > >(tee "$LOCAL_LOG") 2>&1

echo "🔹 Starting push & trigger for $DATE_STR"

# -------------------------
# 1. Check for insert SQL
# -------------------------
INSERT_SQL="$SQL_DIR/insert_articles.sql"
if [[ ! -f "$INSERT_SQL" ]]; then
    echo "❌ insert_articles.sql not found in $SQL_DIR"
    exit 1
fi

echo "🔹 Using insert file: $INSERT_SQL"

# -------------------------
# 2. Upload SQL to Fly
# -------------------------
echo "🔹 Uploading insert_articles.sql to Fly..."
#fly ssh sftp shell -a "$APP_NAME" <<EOF
#put "$INSERT_SQL" /data/insert_articles.sql
echo "🔹 Uploading insert_articles.sql to Fly..."
fly ssh sftp put "$INSERT_SQL" /data/insert_articles.sql -a "$APP_NAME"
quit
EOF

# -------------------------
# 3. Trigger ingestion on Fly
# -------------------------
echo "🔹 Triggering ingestion script on Fly..."
fly ssh console -a "$APP_NAME" --command "bash /app/ingest_fly_side.sh"

# -------------------------
# 4. Fetch Fly log to local
# -------------------------
echo "🔹 Fetching Fly log to local logs folder..."
fly ssh sftp shell -a "$APP_NAME" <<EOF
get "$FLY_LOG_REMOTE" "$FLY_LOG_LOCAL"
quit
EOF

# -------------------------
# 5. Optional: Cleanup remote Fly log
# -------------------------
fly ssh console -a "$APP_NAME" --command "rm -f $FLY_LOG_REMOTE"

echo "✅ Daily ingestion completed."
echo "Local logs:"
echo "  - Main log: $LOCAL_LOG"
echo "  - Fly log:  $FLY_LOG_LOCAL"
