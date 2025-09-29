import React, { useEffect, useMemo, useState } from "react";
import CreateBriefModal from "../components/CreateBriefModal.jsx";
import AuthHeader from "./AuthHeader.jsx";

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
const LS_SLUG = "tobori.corpus_slug";
const LS_ID   = "tobori.corpus_id";

const recencyOf = (b) => {
  // tolerate options_json as object OR JSON string
  let opts = b?.options_json ?? b?.options ?? {};
  if (typeof opts === "string") {
    try { opts = JSON.parse(opts); } catch { opts = {}; }
  }
  const tf  = String(opts.timeframe || "").toLowerCase();   // "lookback" | "window" | "all"
  const d   = Number(opts.lookback_days || 0);
  if (tf === "all") return "All time";
  if (tf === "lookback") {
    if (d >= 30) return "Last month";
    if (d >= 7)  return "Last week";
    return "Last 24 hours";
  }
  // tf === "window" (or anything else) → derive from brief/window field
  const w = String(b?.window || opts.window || "").toLowerCase(); // "daily" | "weekly" | "monthly"
  if (w === "daily")   return "Last 24 hours";
  if (w === "weekly")  return "Last week";
  if (w === "monthly") return "Last 30 days";
  // final fallback, if backend provided a precomputed label
  return b.coverage_window || "—";
};



export default function ReportsPage({ corpusOptions = [] }) {
  const [allBriefs, setAllBriefs] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // brief to edit
  const [busyId, setBusyId] = useState(null);
  const [me, setMe] = useState(null);
  const [corpora, setCorpora] = useState([]); // [{ corpus_id, label, slug }]
  const [slug, setSlug] = useState(() => {
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = qs.get("corpus") || "";
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem(LS_SLUG) || null; } catch { return null; }
  });
  const [corpusId, setCorpusId] = useState(""); // derived from slug
  const [corpusSlug, setCorpusSlug] = useState("");


  const activeCorpus = useMemo(() => {
    const found = corpora.find(c => (c.slug || c.corpus_id) === slug) || null;
    return found
      ? { id: found.corpus_id, slug: found.slug || found.corpus_id, label: found.label || found.name || found.corpus_id }
      : (corpusId ? { id: corpusId, slug } : null);
  }, [corpora, slug, corpusId]);



  function applyCorpus(c, { broadcast = false } = {}) {
    if (!c) return;
    const slug = c.slug || c.corpus_id;
    setCorpusId(c.corpus_id);
    setCorpusSlug(slug);
    try {
      localStorage.setItem(LS_SLUG, slug);
      localStorage.setItem(LS_ID, c.corpus_id);
    } catch {}
    const qp = new URLSearchParams(window.location.search);
    qp.set("corpus", slug);
    qp.delete("corpus_id");
    window.history.replaceState(null, "", `?${qp.toString()}`);

    if (broadcast) {
      window.dispatchEvent(new CustomEvent("corpus:changed", { detail: { slug } }));
      window.dispatchEvent(new CustomEvent("corpus-changed", { detail: c.corpus_id })); // legacy
    }

    // Reload briefs scoped to the new corpus
    load(c.corpus_id);
  }


  useEffect(() => {
    const onChanged = (e) => {
      const s = e?.detail?.slug;
      if (!s || s === slug) return;            // no-op if already on this slug
      const c = corpora.find(x => (x.slug || x.corpus_id) === s);
      if (c) applyCorpus(c, { broadcast: false });  // ← do NOT re-emit
      setSlug(s);
    };
    window.addEventListener("corpus:changed", onChanged);
    return () => window.removeEventListener("corpus:changed", onChanged);
  }, [corpora, slug]);



  useEffect(() => {
    (async () => {
      const rc = await fetch("/api/corpora", { credentials: "include" });
      if (!rc.ok) return;
      const data = await rc.json();
      const list = Array.isArray(data?.corpora) ? data.corpora
                 : Array.isArray(data) ? data : [];
      setCorpora(list);

      // Resolve starting slug: URL → localStorage → first
      const urlSlug = new URLSearchParams(window.location.search).get("corpus") || "";
      const lsSlug  = (() => { try { return localStorage.getItem("tobori.corpus_slug") || ""; } catch { return ""; }})();
      const s = urlSlug || slug || lsSlug || (list[0]?.slug || list[0]?.corpus_id || "");
      if (!s) return;

      setSlug(s);
      const found = list.find(c => (c.slug || c.corpus_id) === s);
      if (found) applyCorpus(found, { broadcast: false });
      else {
        // still canonicalize URL to contain ?corpus=
        const u = new URL(window.location.href);
        u.searchParams.set("corpus", s);
        u.searchParams.delete("corpus_id");
        window.history.replaceState({}, "", u);
      }
    })();
  }, []);

  async function deleteBrief(b) {
    if (!window.confirm(`Delete "${b.title}"? This cannot be undone.`)) return;
    const bid = encodeURIComponent(String(b.id).trim());
    setBusyId(b.id);
    try {
      const resp = await fetch(`/api/briefs/${bid}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || `Server responded ${resp.status}`);
      }
      await load(); // refresh list
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

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

  async function load(cid = corpusId) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ mine: "1" });
      if (cid) qs.set("corpus_id", cid);
      const resp = await fetch(`/api/briefs?${qs.toString()}`, { credentials: "include" });
      const data = await resp.json();
      const list = Array.isArray(data) ? data : [];

      // Keep a master copy for any future local filtering/sorting
      setAllBriefs(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const list = allBriefs.filter(b => !corpusId || b.corpus_id === corpusId);
    list.sort((a, b) =>
      ((a.home_order ?? 0) - (b.home_order ?? 0)) ||
      String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
    );
    setBriefs(list);
  }, [allBriefs, corpusId]);


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
    const meUrl = "/api/me";
    fetch(meUrl, { credentials: "include" })

      .then(r => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        // If we don't already have a corpus, adopt the user's preferred.
        // no-op here; we now canonicalize by slug
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, []);




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
    // Optimistic UI so rows don't jump between clicks
    setBriefs(prev => {
      const next = prev.map(x => x.id === brief.id ? { ...x, show_on_home: !!checked } : x);
      next.sort((a, b) =>
        ( (a.home_order ?? 0) - (b.home_order ?? 0) ) ||
        String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
      );
      return next;
    });
    try {
      const resp = await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_on_home: !!checked }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      // Background reconcile (keeps sort stable)
      await load();
    } catch (e) {
      alert(`Update failed: ${e.message}`);
      // Revert optimistic change if server failed
      setBriefs(prev => prev.map(x => x.id === brief.id ? { ...x, show_on_home: !checked } : x));
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
      <AuthHeader />
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
        <h1 style={{ fontSize: "0.95rem", marginBottom: 16 }}>
          Briefs for {me?.display_name || me?.email || "you"}
          {slug ? ` (corpus ${slug})` : ""}
        </h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Create new brief
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
                <th>Timeframe</th>
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
                  <td>
                    <a href={`/report?id=${encodeURIComponent(b.id)}&corpus=${encodeURIComponent(slug)}`} className="btn-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{b.title}</a></td>
                  <td>{recencyOf(b)}</td>
                  <td><span className="badge">{b.visibility || "private"}</span></td>
                  <td>{fmtTs(b.last_run_at)}</td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!b.show_on_home}
                      onChange={(e) => toggleHome(b, e.target.checked)}
                      disabled={busyId === b.id}
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

                      <button className="btn" onClick={() => openEdit(b)}>Edit</button>
                      <button className="btn" onClick={() => runNow(b)}>Refresh</button>
                      {/* (removed 9/25 for now) Public link only when visibility is public and there is a latest run */}
                      <button className="btn" onClick={() => deleteBrief(b)} disabled={busyId === b.id}>Delete</button>
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
        activeCorpus={activeCorpus}
        onClose={() => setCreating(false)}
        onSaved={() => load()}
      />

      {editing && (
        <CreateBriefModal
          open={true}
          mode="edit"
          initial={editing}
          corpusOptions={corpusOptions}
          activeCorpus={activeCorpus}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
