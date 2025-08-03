// Auto-detect API base URL
let API_BASE = "";

// If running locally (Vite dev)
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  API_BASE = "http://localhost:8007"; // <-- Your FastAPI backend
} else {
  // In production, same origin as frontend (Fly.io deployment)
  API_BASE = "";
}

export async function getOrCreateUserId() {
  let userId = localStorage.getItem("user_id");
  if (!userId) {
    userId = "user-" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("user_id", userId);

    await fetch(`${API_BASE}/register_user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
  }
  return userId;
}

export async function getOrCreateSessionId(userId) {
  let sessionId = sessionStorage.getItem("session_id");
  if (!sessionId) {
    sessionId = "sess-" + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem("session_id", sessionId);

    await fetch(`${API_BASE}/register_session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, user_id: userId }),
    });
  }
  return sessionId;
}


export async function logInteraction(articleId, type, value = null) {
  const userId = await getOrCreateUserId();
  const sessionId = await getOrCreateSessionId(userId);

  try {
    const response = await fetch(`${API_BASE}/log_interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_id: sessionId,
        article_id: articleId,
        interaction_type: type,
        value: value,
      }),
    });

    if (!response.ok) {
      console.error("Failed to log interaction:", response.status, await response.text());
    }
  } catch (err) {
    console.error("Network error logging interaction:", err);
  }
}
