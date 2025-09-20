import React, { useEffect, useMemo, useState } from "react";
import CreateBriefModal from "../components/CreateBriefModal.jsx";

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

// put near the top of ReportsPage.jsx
const fmtTs = (ts) => {
  if (!ts) return "—";
  // mm/dd/yy hh:mm (24h)
  const d = new Date(ts);
  const f = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return f.format(d);
};


export default function ReportsPage({ corpusOptions = [] }) {
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // brief to edit
  const [busyId, setBusyId] = useState(null);
  const [me, setMe] = useState(null);
  const [corpusId, setCorpusId] = useState("");

  // Pick a corpus: URL → me.preferred_corpus_id → localStorage → <meta name="x-default-corpus">
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qp = new URLSearchParams(window.location.search);
    const fromUrl = qp.get("corpus_id");
    if (fromUrl) { setCorpusId(fromUrl); return; }
    const fromStorage = localStorage.getItem("preferred_corpus") || "";
    const fromMeta = document.querySelector('meta[name="x-default-corpus"]')?.content || "";
    const picked = fromStorage || fromMeta || "";
    if (picked) {
      setCorpusId(picked);
      qp.set("corpus_id", picked);
      window.history.replaceState(null, "", `?${qp.toString()}`);
    }
  }, []);

  async function openEdit(briefRow) {
    try {
      const r = await fetch(`/api/briefs/${briefRow.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load brief");
      const detail = await r.json(); // includes prompt_template
      setEditing(detail);
    } catch (e) {
      alert("Could not load brief for edit.");
    }
  }

  async function load() {
    setLoading(true);
    try {
      const resp = await fetch("/api/briefs?mine=1", { credentials: "include" });
      const data = await resp.json();
      setBriefs(Array.isArray(data) ? data : []);
      if (!corpusId && Array.isArray(data) && data.length) {
        const first =
          data[0].corpus_id ||
          data[0].corpus ||
          data[0].slug ||
          data[0].name ||
          "";
        if (first) {
          setCorpusId(first);
          if (typeof window !== "undefined") {
            const qp = new URLSearchParams(window.location.search);
            qp.set("corpus_id", first);
            window.history.replaceState(null, "", `?${qp.toString()}`);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    // seed from global (instant)
    setMe(window.__me || null);
    // subscribe to changes
    const onAuth = (ev) => setMe(ev.detail || null);
    window.addEventListener("auth-state", onAuth);
    return () => window.removeEventListener("auth-state", onAuth);
  }, []);

  useEffect(() => {
    const qp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const meUrl = corpusId ? `/api/me?corpus_id=${encodeURIComponent(corpusId)}` : "/api/me";
    fetch(meUrl, { credentials: "include" })

      .then(r => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        // If we don't already have a corpus, adopt the user's preferred.
        if (!corpusId && m?.preferred_corpus_id) {
          const next = m.preferred_corpus_id;
          setCorpusId(next);
          if (qp) { qp.set("corpus_id", next); window.history.replaceState(null, "", `?${qp.toString()}`); }
        }
      })
      .catch(() => {});
  }, [corpusId]);

  useEffect(() => {
    load();
  }, []);


  useEffect(() => {
    if (corpusId) return;
    (async () => {
      try {
        const r = await fetch("/api/corpora", { credentials: "include" });
        if (!r.ok) return;
        const list = await r.json();
        const first =
          Array.isArray(list) &&
          (list[0]?.corpus_id || list[0]?.id || list[0]?.slug || list[0]?.name);
          if (first) {
          setCorpusId(first);
          if (typeof window !== "undefined") {
            const qp = new URLSearchParams(window.location.search);
            qp.set("corpus_id", first);
            window.history.replaceState(null, "", `?${qp.toString()}`);
          }
        }
      } catch {}
    })();
  }, [corpusId]);


  async function runNow(idOrBrief) {
    const id = typeof idOrBrief === "string" ? idOrBrief : idOrBrief?.id;
    setBusyId(id);
    try {
      await fetch(`/api/briefs/${id}/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // today ET
      });
      await load();
    } catch (e) {
      alert("Run failed");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHome(brief, checked) {
    setBusyId(brief.id);
    try {
      const resp = await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_on_home: !!checked }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await load();
    } catch (e) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function updateHomeOrder(brief, value) {
    const v = Number.isFinite(Number(value)) ? Number(value) : 0;
    setBusyId(brief.id);
    try {
      const resp = await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home_order: v }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      // no need to reload every keystroke; but simplest is to reload
      await load();
    } catch (e) {
      alert(`Order update failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }


  async function toggleVisibility(brief) {
    const next = brief.visibility === "public" ? "private" : "public";
    setBusyId(brief.id);
    try {
      await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function copyPublicLink(brief) {
    // needs latest run id; fetch latest
    const r = await fetch(`/api/briefs/${brief.id}/latest`, {
      credentials: "include",
    });
    if (!r.ok) {
      alert("No runs yet."); return;
    }
    const data = await r.json();
    const url = `${location.origin}/r/${data.id}`;
    await navigator.clipboard.writeText(url);
    alert("Link copied");
  }

  const hasBriefs = briefs.length > 0;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <style>{`
        .btn {
          display: inline-block;
          padding: 4px 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
          background: #f8f8f8;
          font-size: 0.9rem;
          line-height: 1.2;
          text-decoration: none;
          color: #111;
        }
        .btn:hover { background: #f0f0f0; }
        .btn[aria-disabled="true"] {
          opacity: 0.45;
          pointer-events: none;
        }
        .btn-link {
          color: #0645ad;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .badge {
          display: inline-block;
          padding: 2px 6px;
          border: 1px solid #999;
          border-radius: 6px;
          font-size: 0.8rem;
          text-transform: lowercase;
          background: #fafafa;
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between">
        <h1 style={{ fontSize: "1 rem", marginBottom: 16 }}>
          Briefs for {me?.display_name || me?.email || "you"}
          {corpusId ? ` (corpus ${corpusId})` : ""}
        </h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Create Brief
        </button>
      </div>

      {loading ? (
        <p className="text-gray-600">Loading…</p>
      ) : !hasBriefs ? (
        <div className="rounded-lg border p-6 text-gray-700">
          <p className="mb-3">
            No briefs yet. Create your first daily/weekly/monthly brief.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            Create Brief
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border">
            <thead className="bg-gray-50">
              <tr className="text-left text-sm" style={{ fontSize: "0.95rem" }} >
                <th>Title</th>
                <th>Corpus</th>
                <th>Window</th>
                <th>Visibility</th>
                <th>Last Run</th>
                <th>Pin to Home</th>
                <th>Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => (

                <tr key={b.id} style={{ fontSize: "0.95rem" }}>
                  <td><a href={`/report?id=${encodeURIComponent(b.id)}&corpus_id=${encodeURIComponent(corpusId)}`} className="btn-link">{b.title}</a></td>
                  <td>{b.corpus_id}</td>
                  <td>{b.coverage_window || "—"}</td>
                  <td><span className="badge">{b.visibility || "private"}</span></td>
                  <td>{fmtTs(b.last_run_at)}</td>

                  <td>
                    <input
                      type="checkbox"
                      checked={!!b.show_on_home}
                      onChange={(e) => toggleHome(b, e.target.checked)}
                      aria-label="Pin to Home"
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      value={b.home_order ?? 0}
                      onChange={(e) => updateHomeOrder(b, e.target.value)}
                      style={{ width: 48, textAlign: "center" }} // ← narrower box
                    />
                  </td>

                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <a
                        href={`/report?id=${encodeURIComponent(b.id)}&corpus_id=${encodeURIComponent(corpusId)}`}
                        className="btn"
                      >
                        Open
                      </a>
                      <button className="btn" onClick={() => openEdit(b)}>Edit</button>
                      <button className="btn" onClick={() => runNow(b)}>Run now</button>
                      {/* Public link only when visibility is public and there is a latest run */}
                      <a
                        className="btn"
                        href={b.visibility === "public" && b.latest_run_id ? `/r/${b.latest_run_id}` : undefined}
                        aria-disabled={!(b.visibility === "public" && b.latest_run_id)}
                        onClick={(e) => {
                          if (!(b.visibility === "public" && b.latest_run_id)) e.preventDefault();
                        }}
                        title={
                          b.visibility === "public"
                            ? (b.latest_run_id ? "Open public link" : "No run yet")
                            : "Set visibility to public to enable"
                        }
                      >
                        Get link
                      </a>
                    </div>
                  </td>
                </tr>




              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateBriefModal
        open={creating}
        mode="create"
        corpusOptions={corpusOptions}
        onClose={() => setCreating(false)}
        onSaved={() => load()}
      />

      {editing && (
        <CreateBriefModal
          open={true}
          mode="edit"
          initial={editing}
          corpusOptions={corpusOptions}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
