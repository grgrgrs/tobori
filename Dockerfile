
# -----------------------
# 1. Build Astro frontend
# -----------------------
FROM node:20 as frontend
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# -----------------------
# 2. Backend with Python
# -----------------------
FROM python:3.11-slim as backend
WORKDIR /app

RUN apt-get update && apt-get install -y sqlite3 nano vim && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy frontend build output
COPY --from=frontend /app/dist ./dist

# Copy backend code
COPY src ./src
COPY routes ./routes

# Copy SQLite database
COPY sqlite/articles.db ./sqlite/articles.db

# Copy the ingestion script into the container
COPY ingest_fly_side.sh /app/ingest_fly_side.sh
RUN chmod +x /app/ingest_fly_side.sh

# Expose FastAPI port
EXPOSE 8080

# Run FastAPI
CMD ["uvicorn", "routes.user:app", "--host", "0.0.0.0", "--port", "8080"]

