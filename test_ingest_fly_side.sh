#!/bin/bash
# Ensure Bash, safe error handling
set -eu

DB_PATH="/data/articles.db"
DATE_STR=$(date +%Y%m%d)
LOG_FILE="/data/test_ingest_${DATE_STR}.log"

echo "==============================="
echo "🔹 Ingestion job STARTED at $(date)"
echo "===============================" | tee -a "$LOG_FILE"

# --- STEP 1: Verify insert_articles.sql ---
if [[ ! -f /app/update_test.txt ]]; then
    echo "⚠ No /app/update_test.txt found; nothing to ingest." | tee -a "$LOG_FILE"
    exit 0
fi



echo "==============================="
echo "✅ Test job COMPLETED at $(date)"
echo "Log stored at $LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"
