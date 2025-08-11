#!/usr/bin/env bash

set -euo pipefail

APP="tobori-sql"
ORIG_SQL="../article-database/update_test.txt"
SQL_SRC="$(realpath "$ORIG_SQL")"
REMOTE_SQL="/app/update_test.txt"
DATE=$(date +%Y%m%d)
LOG_DIR="./logs"
LOG_FILE="${LOG_DIR}/ingest_${DATE}_fly.log"
REMOTE_LOG="/data/ingest_${DATE}.log"

mkdir -p "$LOG_DIR"

echo "🔹 Starting push & trigger for ${DATE}"

# Step 0: Normalize line endings to a Windows-accessible file in current dir
tmpfile="$(pwd)/normalized_update_test.txt"
tr -d '\r' < "$SQL_SRC" > "$tmpfile"
SQL_SRC="$tmpfile"


# Step 1: Upload file using base64 over SSH with safe quoting
echo "🔹 Uploading test file to Fly via SSH (base64)..."

openssl base64 -A -in "$SQL_SRC" \
| fly ssh console -a "$APP" -C 'sh -c "base64 -d > /app/update_test.txt && ls -l /app/update_test.txt"' 2> /dev/null


# Step 2: Trigger ingestion on Fly
echo "🔹 Triggering ingest script on Fly..."
fly ssh console -a "$APP" -C "bash /app/test_ingest_fly_side.sh $REMOTE_LOG"

# Step 3: Fetch log to local folder
echo "🔹 Fetching Fly log to local logs folder..."
fly ssh sftp shell -a "$APP" <<EOF
get $REMOTE_LOG $LOG_FILE
rm $REMOTE_LOG
EOF

echo "✅ Test ingestion completed."
echo "Local log: $LOG_FILE"

# Cleanup temp file
rm -f "$tmpfile"
