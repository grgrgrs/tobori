import React, { useState, useEffect } from "react";

export default function LoginPage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loginName, setLoginName] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    // Initialize userId in localStorage
    let uid = localStorage.getItem("userId");
    if (!uid) {
      uid = `user-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("userId", uid);
    }
    setCurrentUser(uid);

    // ✅ Auto-redirect if already logged in with a userName
    if (localStorage.getItem("userName")) {
      window.location.href = "/articles";
    }
  }, []);

  const handleLogin = async () => {
    if (!loginName.trim()) {
      setStatus("Please enter a name or email.");
      return;
    }

    const oldUserId = currentUser;
    const newUserId = loginName.trim();

    try {
      await fetch("/merge_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_user_id: oldUserId, new_user_id: newUserId }),
      });

      // ✅ Persist both userId and userName
      localStorage.setItem("userId", newUserId);
      localStorage.setItem("userName", newUserId);

      setCurrentUser(newUserId);
      setStatus(`Logged in as ${newUserId}`);

      // ✅ Redirect to articles page
      window.location.href = "/articles";
    } catch (err) {
      console.error("Error merging user:", err);
      setStatus("Error during login.");
    }
  };

  if (currentUser === null) {
    return <div style={{ textAlign: "center", marginTop: "2rem" }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: "500px", margin: "2rem auto", textAlign: "center" }}>
      <h1>Log In</h1>
      <p>This is optional. Enter any name or email to keep your likes and views across devices.</p>

      <input
        type="text"
        value={loginName}
        placeholder="Enter your name or email"
        onChange={(e) => setLoginName(e.target.value)}
        style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
      />

      <button onClick={handleLogin} style={{ padding: "0.5rem 1rem" }}>
        Save
      </button>

      {status && <p style={{ marginTop: "1rem" }}>{status}</p>}
    </div>
  );
}
