from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
import datetime
from routes import articles 
from fastapi.staticfiles import StaticFiles
import os
from fastapi import Request

# ----------------------
# FastAPI app and CORS
# ----------------------
app = FastAPI()

# --- CORS setup ---
origins = [
    "http://localhost:4321",  # Vite dev server
    "http://127.0.0.1:4321",
    "http://localhost:5173",  # if using Vite default
    "http://127.0.0.1:5173",
]

app.include_router(articles.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "/data/articles.db"  # Use the persistent volume

# ----------------------
# Data models
# ----------------------

class Interaction(BaseModel):
    user_id: str
    session_id: Optional[str] = None
    article_id: Optional[str] = None
    interaction_type: str
    value: Optional[str] = None



class RegisterUser(BaseModel):
    user_id: str


class RegisterSession(BaseModel):
    session_id: str
    user_id: str

class MergeUser(BaseModel):
    old_user_id: str
    new_user_id: str


# ----------------------
# Endpoints
# ----------------------

@app.post("/merge_user")
def merge_user(data: MergeUser):
    """Merge anonymous user history into a new user_id."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Ensure new user exists
    cursor.execute(
        "INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)",
        (data.new_user_id, datetime.datetime.utcnow().isoformat())
    )

    # Merge interactions
    cursor.execute(
        "UPDATE user_interactions SET user_id = ? WHERE user_id = ?",
        (data.new_user_id, data.old_user_id)
    )

    # Merge sessions
    cursor.execute(
        "UPDATE sessions SET user_id = ? WHERE user_id = ?",
        (data.new_user_id, data.old_user_id)
    )

    conn.commit()
    conn.close()
    return {"status": "merged"}


@app.post("/log_interaction")
def log_interaction(interaction: Interaction):
    """Log any user interaction with an article"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)",
                   (interaction.user_id, datetime.datetime.utcnow().isoformat()))

    cursor.execute("INSERT OR IGNORE INTO sessions (session_id, user_id, started_at, last_seen) VALUES (?, ?, ?, ?)",
                   (interaction.session_id, interaction.user_id,
                    datetime.datetime.utcnow().isoformat(),
                    datetime.datetime.utcnow().isoformat()))

    # Insert interaction
    cursor.execute("""
        INSERT INTO user_interactions
        (user_id, session_id, article_id, interaction_type, value, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        interaction.user_id,
        interaction.session_id,
        interaction.article_id,
        interaction.interaction_type,
        interaction.value,
        datetime.datetime.utcnow().isoformat()
    ))

    # Update session last_seen
    cursor.execute(
        "UPDATE sessions SET last_seen = ? WHERE session_id = ?",
        (datetime.datetime.utcnow().isoformat(), interaction.session_id)
    )

    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/register_user")
def register_user(data: RegisterUser):
    """Register a new user (anonymous or identified)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)",
        (data.user_id, datetime.datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/register_session")
def register_session(data: RegisterSession):
    """Register a new session for a given user"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR IGNORE INTO sessions
        (session_id, user_id, started_at, last_seen)
        VALUES (?, ?, ?, ?)
        """,
        (
            data.session_id,
            data.user_id,
            datetime.datetime.utcnow().isoformat(),
            datetime.datetime.utcnow().isoformat(),
        )
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/user_interactions")
def log_user_interaction(interaction: Interaction):
    return log_interaction(interaction)


app.mount("/", StaticFiles(directory="dist", html=True), name="static")

