import React, { useEffect, useState } from "react";

export default function LoggedInStatus() {
  const [me, setMe] = useState(undefined); // undefined = unknown, null = not authed, object = authed

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        const data = r.ok ? await r.json() : null;
        if (mounted) setMe(data);
      } catch {
        if (mounted) setMe(null);
      }
    }

    // initial fetch
    check();

    // listen to global auth-state events your layout emits
    const onAuth = (e) => setMe(e.detail || null);
    window.addEventListener("auth-state", onAuth);

    return () => {
      mounted = false;
      window.removeEventListener("auth-state", onAuth);
    };
  }, []);

  // Avoid label flicker until we know auth
  if (me === undefined) {
    return <span style={{ visibility: "hidden" }}>Log In</span>;
  }

  // Not signed in -> Log In (preserve next=)
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <a
        href={`/login?next=${next}`}
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

  // Signed in -> Log Out
  return (
    <button
      onClick={async () => {
        try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch {}
        localStorage.removeItem("active_corpus_slug");
        location.assign("/"); // go to public home; BaseLayout will refresh auth
      }}
      style={{
        textDecoration: "none",
        color: "#333",
        fontWeight: 500,
        padding: "0.25rem 0.5rem",
        borderRadius: "4px",
        backgroundColor: "#f0f0f0",
        border: "none",
        cursor: "pointer",
      }}
      title={`Log out${me?.display_name ? ` (${me.display_name})` : ""}`}
    >
      Log Out
    </button>
  );
}
