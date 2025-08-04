#!/usr/bin/env bash

set -e

APP="tobori-sql"
SQL_SRC="../article-database/insert_articles.sql"
REMOTE_SQL="/data/insert_articles.sql"
DATE=$(date +%Y%m%d)
LOG_FILE="./logs/ingest_${DATE}_fly.log"
REMOTE_LOG="/data/ingest_${DATE}.log"

echo "🔹 Starting push & trigger for ${DATE}"

# Step 1: Upload insert_articles.sql
echo "🔹 Uploading insert_articles.sql to Fly via SFTP..."
fly ssh sftp shell -a $APP <<EOF
put $SQL_SRC $REMOTE_SQL
EOF

# Step 2: Trigger ingest script on Fly
echo "🔹 Triggering ingest script on Fly..."
fly ssh console -a $APP -C "bash /app/ingest_fly_side.sh $REMOTE_LOG"

# Step 3: Fetch log to local
echo "🔹 Fetching Fly log to local logs folder..."
fly ssh sftp shell -a $APP <<EOF
get $REMOTE_LOG $LOG_FILE
rm $REMOTE_LOG
EOF

echo "✅ Daily ingestion completed."
echo "Local log: $LOG_FILE"
