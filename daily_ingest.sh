#!/usr/bin/env bash
set -Eeuo pipefail

DATE_STR=$(date +%Y%m%d)
SQL_SRC="../article-database/insert_articles.sql"

REMOTE_SQL="/data/insert_articles.sql"
REMOTE_LOG="/data/ingest_${DATE_STR}.log"
LOCAL_LOG="./logs/ingest_${DATE_STR}_fly.log"

echo "🔹 Starting push & trigger for $DATE_STR"

if [[ ! -f "$SQL_SRC" ]]; then
  echo "❌ SQL file not found: $SQL_SRC"
  exit 1
fi

mkdir -p logs

# -------------------------
# 1. Upload SQL file via SSH pipe (with shell)
# -------------------------
echo "🔹 Uploading insert_articles.sql to Fly via SSH pipe..."
cat "$SQL_SRC" | fly ssh console -C "sh -c 'cat > $REMOTE_SQL'"

# -------------------------
# 2. Trigger ingestion on Fly
# -------------------------
echo "🔹 Triggering ingest script on Fly..."
fly ssh console -C "bash /app/ingest_fly_side.sh $REMOTE_LOG"

# -------------------------
# 3. Fetch Fly log via SSH pipe
# -------------------------
echo "🔹 Fetching Fly log to local logs folder..."
fly ssh console -C "cat $REMOTE_LOG" > "$LOCAL_LOG"

# -------------------------
# 4. Cleanup remote Fly log
# -------------------------
echo "🔹 Cleaning up remote Fly log..."
fly ssh console -C "rm -f $REMOTE_LOG"

echo "✅ Daily ingestion completed."
echo "Local log: $LOCAL_LOG"
