#!/bin/bash
set -euo pipefail

LOG_FILE="${1:-/data/ingest_manual.log}"
DB_PATH="/data/articles.db"
SQL_FILE="/data/insert_articles.sql"
BACKUP="/data/articles_backup_$(date +%Y%m%d).db"

echo "===============================" | tee "$LOG_FILE"
echo "🔹 Ingestion job STARTED at $(date -u)" | tee -a "$LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"

# Step 1: Verify SQL file exists and has content
if [[ ! -s "$SQL_FILE" ]]; then
    echo "❌ SQL file missing or empty. Aborting." | tee -a "$LOG_FILE"
    exit 1
fi

FILE_SIZE=$(stat -c%s "$SQL_FILE")
echo "🔹 SQL file size: ${FILE_SIZE} bytes" | tee -a "$LOG_FILE"

# Step 2: Backup current DB
echo "🔹 Creating backup: $BACKUP" | tee -a "$LOG_FILE"
cp "$DB_PATH" "$BACKUP"

# Step 3: Run ingestion
echo "🔹 Applying SQL updates..." | tee -a "$LOG_FILE"
if sqlite3 "$DB_PATH" < "$SQL_FILE"; then
    echo "✅ SQL applied successfully." | tee -a "$LOG_FILE"
else
    echo "❌ SQL ingestion failed. DB restored from backup." | tee -a "$LOG_FILE"
    cp "$BACKUP" "$DB_PATH"
    exit 1
fi

# Step 4: Optional cleanup of SQL file after successful ingestion
rm -f "$SQL_FILE"
echo "🔹 SQL file cleaned up after successful ingestion." | tee -a "$LOG_FILE"

echo "===============================" | tee -a "$LOG_FILE"
echo "✅ Ingestion job COMPLETED at $(date -u)" | tee -a "$LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"
