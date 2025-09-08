import React, { useState, useEffect } from "react";

export default function LoggedInStatus() {
  const [userId, setUserId] = useState(null);

  // Load current user ID on client
  useEffect(() => {
    let uid = localStorage.getItem("userId");
    if (!uid) {
      uid = `user-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("userId", uid);
    }
    setUserId(uid);
  }, []);

  // Handle logout -> reset to anonymous
  const handleLogout = () => {
    const anonId = `user-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("userId", anonId);
    setUserId(anonId);
  };

  if (userId === null) return null; // Prevent SSR flash

  // Anonymous users -> show Log In link
  if (!userId || userId.startsWith("user-")) {
    return (
      <a
        href="/api/login"
        style={{
          textDecoration: "none",
          color: "#333",
          fontWeight: 500,
          padding: "0.25rem 0.5rem",
          borderRadius: "4px",
          backgroundColor: "#f0f0f0",
        }}
      >
        Log In
      </a>
    );
  }

  // Logged-in users -> badge + logout option


  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.15rem 0.4rem",
        borderRadius: "4px",
        backgroundColor: "#f0f0f0",
        fontSize: "0.85rem",
        fontWeight: 500,
        color: "#333",
        lineHeight: "1.2",
        whiteSpace: "nowrap", // keep badge text together
      }}
    >
      Logged in as {userId}
      <button
        onClick={handleLogout}
        title="Log out"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "0.85rem",
          lineHeight: "1",
          padding: "0",
          color: "#777",
        }}
        onMouseEnter={(e) => (e.target.style.color = "#000")}
        onMouseLeave={(e) => (e.target.style.color = "#777")}
      >
        ×
      </button>
    </span>
  );



}
