import React, { useEffect, useMemo, useState } from "react";

const UI = {
  page: { maxWidth: 1100, margin: "28px auto", padding: "0 16px" },
  h1: { fontSize: 22, fontWeight: 600, margin: 0 },
  sub: { color: "#666", fontSize: 13 },
  badges: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  badge: { border: "1px solid #e5e5e5", borderRadius: 12, padding: "2px 8px", background: "#fff" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 12,
    borderBottom: "1px solid #eee",
    marginBottom: 16,
  },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    padding: "6px 12px",
    border: "1px solid #d0d0d0",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
  },
  primary: { background: "#2b6cb0", color: "#fff", borderColor: "#2b6cb0" },
  layout: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" },
  card: { border: "1px solid #e5e5e5", borderRadius: 12, background: "#fff", padding: 14 },
  html: {
    lineHeight: 1.55,
    fontSize: 16,
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  li: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #eee",
    marginBottom: 8,
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
  },
  small: { fontSize: 12, color: "#666" },
};

const coverageLabel = (w) => (w === "weekly" ? "Weekly" : w === "monthly" ? "Monthly" : "Daily");
const scopeLabel = (tf) => (tf === "all" ? "All time" : "Coverage window");

export default function ReportView({ id }) {

  // Fallback: read ?id= from the URL on the client if the prop is empty
  const effectiveId =
    id && String(id).trim()
      ? id
      : (typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("id")) ||
        "";

  // quick sanity log
  if (typeof window !== "undefined") {
    console.debug("ReportView init", {
      propId: id,
      effectiveId,
      href: window.location.href,
    });
  }


  const [err, setErr] = useState(null);


  const [brief, setBrief] = useState(null);
  const [briefId, setBriefId] = useState(id || "");
  const [latest, setLatest] = useState(null); // { id, run_at, content_html, ... }
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [pinning, setPinning] = useState(false);

  const coverage = useMemo(() => coverageLabel(brief?.window), [brief]);
  const scope = useMemo(
    () => scopeLabel(brief?.options_json?.timeframe || "window"),
    [brief]
  );

  // Helpers copied from the modal so the viewer renders identically
  function normalizeReportHtml(h = "") {
    // lightweight cleanup; extend as needed
    return h.replaceAll("<p><br></p>", "<br/>");
  }

  function styledHtml(html, font = "'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif", size = 15, line = 1.55) {
    return `
      <div style="font-family:${font}; font-size:${size}px; line-height:${line}; color:#111;">
        <style>
          p { margin: 0 0 12px; }
          ul, ol { margin: 0 0 12px 20px; }
          li { margin: 0 0 6px; }
          a { text-decoration: underline; }
          blockquote { margin: 0 0 12px; padding-left: 12px; border-left: 3px solid #e5e5e5; color:#333; }
          h1,h2,h3 { margin: 14px 0 8px; font-weight:600; }
        </style>
        ${html || ""}
      </div>
    `;
  }

  useEffect(() => {
  // derive id on the client if it wasn't serialized in static build
  const qid =
      id ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("id")
        : "");
    if (!qid) {
      setBriefId("");
      setLoading(false);
      return;
    }
    setBriefId(qid);
    (async () => {
      setLoading(true);
      try {
        // 1) brief metadata
        const r1 = await fetch(`/api/briefs/${qid}`, { credentials: "include" });
        if (r1.status === 401) { window.location = "/signin"; return; }
        if (!r1.ok) throw new Error(await r1.text());
        const b = await r1.json();
        setBrief(b);

        // 2) latest run (tolerate 404)
        try {
          const r = await fetch(`/api/briefs/${qid}/latest`, { credentials: "include" });
          if (!r.ok) {
            setLatest(null);
          } else {
            const j = await r.json();
            setLatest(j);
          }
        } catch {
          setLatest(null);
        }

        // 3) history (fallback if ?limit unsupported)
        let hist = [];
        const r3 = await fetch(`/api/briefs/${qid}/runs?limit=20`, { credentials: "include" });
        if (r3.ok) hist = await r3.json();
        else {
          const r3b = await fetch(`/api/briefs/${qid}/runs`, { credentials: "include" });
          if (r3b.ok) hist = await r3b.json();
        }
        setHistory(hist || []);
      } catch (e) {
        console.error(e);
        alert(`Failed to load report: ${e.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);


  async function openRun(runId) {
    try {
      const r = await fetch(`/api/briefs/${briefId}/runs/${runId}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const run = await r.json();
      setLatest(run);
    } catch (e) {
      alert(`Failed to load run: ${e.message}`);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await fetch(`/api/briefs/${briefId}/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error(await r.text());

      // refresh latest + history
      const r2 = await fetch(`/api/briefs/${briefId}/latest`, { credentials: "include" });
      if (r2.ok) setLatest(await r2.json());

      const r3 = await fetch(`/api/briefs/${briefId}/runs?limit=20`, { credentials: "include" });
      if (r3.ok) setHistory(await r3.json());
    } catch (e) {
      alert(`Run failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  async function togglePin() {
    if (!brief) return;
    setPinning(true);
    try {
      const resp = await fetch(`/api/briefs/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_on_home: !brief.show_on_home,
          home_order: brief.home_order || 0,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setBrief({ ...brief, show_on_home: !brief.show_on_home });
    } catch (e) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setPinning(false);
    }
  }

  function edit() {
    // If your Reports page can open a modal by querystring, use ?edit=<id>
    window.location.href = `/reports?edit=${encodeURIComponent(id)}`;
  }

  function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      () => alert("Link copied"),
      () => alert("Copy failed")
    );
  }

  const updated = latest?.run_at || brief?.last_run_at || null;

  return (
    <div style={UI.page}>
      <div style={UI.header}>
        <div>
          <h1 style={UI.h1}>{brief?.title || "Report"}</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
            <div style={UI.badges}>
              <span style={UI.badge}>Coverage: {coverage}</span>
              <span style={UI.badge}>Scope: {scope}</span>
            </div>
            {updated && <span style={UI.sub}>Updated {new Date(updated).toLocaleString()}</span>}
          </div>
        </div>
        <div style={UI.actions}>
          <button style={{ ...UI.btn }} onClick={copyLink}>Copy link</button>
          <button style={{ ...UI.btn }} onClick={edit}>Edit</button>
          <button style={{ ...UI.btn }} onClick={togglePin} disabled={pinning}>
            {brief?.show_on_home ? "Unpin from Home" : "Pin to Home"}
          </button>
          <button
            style={{ ...UI.btn, ...UI.primary }}
            onClick={runNow}
            disabled={running}
            title="Run now"
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      <div style={UI.layout}>
        {/* MAIN CONTENT */}
        <div style={UI.card}>

          {loading ? (
            <div style={{ color: "#666" }}>Loading…</div>
          ) : latest?.content_html?.trim() ? (
            <div
              dangerouslySetInnerHTML={{
                __html: styledHtml(
                  normalizeReportHtml(latest.content_html),
                  "'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
                  15,
                  1.55
                ),
              }}
            />
          ) : latest?.content_json ? (
            // very lightweight fallback if backend only returned JSON
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#333", margin: 0 }}>
              {JSON.stringify(latest.content_json, null, 2)}
            </pre>
          ) : (
            <div style={{ color: "#666" }}>No run yet.</div>
          )}


        </div>

        {/* SIDEBAR: History */}
        <aside style={UI.card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>History</div>
          {history?.length ? (
            <ul style={UI.list}>
              {history.map((h) => (
                <li key={h.id} style={UI.li} onClick={() => openRun(h.id)}>
                  <span>{new Date(h.run_at).toLocaleString()}</span>
                  <span style={UI.small}>{h.status || ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={UI.sub}>No prior runs.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
