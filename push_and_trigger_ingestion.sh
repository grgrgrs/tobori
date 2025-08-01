#!/usr/bin/env bash
set -euo pipefail

APP_NAME=tobori-sql
SQL_DIR="/mnt/c/Users/georg/Documents/Projects/article-database"
DATE_STR=$(date +%Y%m%d)
LOCAL_LOG="/mnt/c/Users/georg/Documents/Projects/tobori/logs/ingest_${DATE_STR}.log"
FLY_LOG="/data/ingest_${DATE_STR}.log"

echo "🔹 Starting push & trigger for $DATE_STR"

# Step 1: Verify SQL file exists
if [[ ! -f "$SQL_DIR/insert_articles.sql" ]]; then
    echo "❌ insert_articles.sql not found in $SQL_DIR"
    exit 1
fi

# Step 2: Upload insert_articles.sql reliably
echo "🔹 Uploading insert_articles.sql to Fly..."
cat "$SQL_DIR/insert_articles.sql" | \
fly ssh console -a $APP_NAME --command "sh -c 'cat > /data/insert_articles.sql'"

# Step 3: Trigger Fly-side ingestion
echo "🔹 Triggering ingestion script on Fly..."
fly ssh console -a $APP_NAME --command "bash /app/ingest_fly_side.sh"

# Step 4: Fetch Fly log to local logs folder
echo "🔹 Fetching Fly log to local logs folder..."
rm -f "$LOCAL_LOG"
fly ssh sftp get $FLY_LOG "$LOCAL_LOG"

echo "✅ Ingestion completed. Local log saved to $LOCAL_LOG"
