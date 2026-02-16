import React, { useEffect, useState } from "react";
import AuthHeader from "./AuthHeader.jsx";

const STORY_FONT = "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
const BADGE = { border:'1px solid #e5e5e5', borderRadius:12, padding:'2px 8px', background:'#fff', marginLeft:6 };

const coverageLabel = (v) => (v === "daily" ? "Daily" : v === "weekly" ? "Weekly" : "Monthly");
const scopeLabel    = (v) => (v === "all" ? "All time" : "Coverage window");

const LS_SLUG = "tobori.corpus_slug";
const LS_ID   = "tobori.corpus_id";

function styledHtml(s) {
  return (s || "")
    .replaceAll("<h3>", '<h3 style="margin:14px 0 6px;font-size:18px;font-weight:600;">')
    .replaceAll("<p>",  '<p style="margin:10px 0;line-height:1.78;">')
    .replaceAll("<ul>", '<ul style="margin:10px 0 10px 20px;">')
    .replaceAll("<li>", '<li style="margin:6px 0;">');
}

export default function HomePage() {
  const [me, setMe] = useState(null);
  const [corpora, setCorpora] = useState([]);     // [{ corpus_id, label, slug }]
  const [slug, setSlug] = useState(() => {
    try {
      const ls = localStorage.getItem(LS_SLUG) || "";
      if (ls) return ls;
    } catch {}
    const qs = new URLSearchParams(window.location.search);
    return qs.get("corpus") || "";
  });
  const [corpusId, setCorpusId] = useState("");   // derived from slug
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  function onCorpusSelectChange(e) {
    const s = e.target.value;                       // new slug (or corpus_id fallback)
    setSlug(s);
    const c = corpora.find(x => (x.slug || x.corpus_id) === s);
    if (c) setCorpusId(c.corpus_id);

    try {
      localStorage.setItem(LS_SLUG, s);
      if (c?.corpus_id) localStorage.setItem(LS_ID, c.corpus_id);
    } catch {}

    const qs = new URLSearchParams(window.location.search);
    qs.set("corpus", s); qs.delete("corpus_id");
    window.history.replaceState(null, "", `?${qs.toString()}`);

    // **broadcast for other pages & header**
    window.dispatchEvent(new CustomEvent("corpus:changed", { detail: { slug: s } }));
    if (c?.corpus_id) {
      window.dispatchEvent(new CustomEvent("corpus-changed", { detail: c.corpus_id })); // legacy
    }
  }

async function refreshBrief(brief) {
  const id = String(brief.id);
  setBusyId(id);
  try {
    // Run now (server endpoint that already works)
    const runResp = await fetch(`/api/briefs/${encodeURIComponent(id)}/run`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}) // body is required by the FastAPI signature
    });
    if (!runResp.ok) {
      const msg = await runResp.text().catch(() => "");
      throw new Error(msg || `Run failed (${runResp.status})`);
    }

    // Pull the new latest run
    const r = await fetch(`/api/briefs/${encodeURIComponent(id)}/latest`, {
      credentials: "include",
    });
    if (r.ok) {
      const latest = await r.json();
      setItems(prev =>
        prev.map(b =>
          b.id === brief.id
            ? { ...b, latest_run: latest, last_run_at: latest.run_at ?? b.last_run_at }
            : b
        )
      );
    }
  } catch (e) {
    alert(e.message || "Refresh failed");
  } finally {
    setBusyId(null);
  }
}

// hydrate a list with latest run (content_html) per brief
async function hydrateLatest(list) {
  const out = [];
  for (const b of list) {
    // If the brief already carries its latest_run with HTML, keep it.
    if (b?.latest_run?.content_html) { out.push(b); continue; }
    try {
      // Fetch the brief's latest run (not the home list)
      const r = await fetch(`/api/briefs/${encodeURIComponent(b.id)}/latest`, {
        credentials: "include"
      });
      if (r.ok) {
        const run = await r.json();
        out.push({ ...b, latest_run: run, last_run_at: run.run_at ?? b.last_run_at });
      } else {
        out.push(b);
      }
    } catch {
      out.push(b);
    }
  }
  return out;
}

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/corpora", { credentials: "include" });
      const j = await r.json();
      const list = Array.isArray(j?.corpora) ? j.corpora : Array.isArray(j) ? j : [];
      if (!alive) return;
      setCorpora(list);
      // precedence: URL → localStorage → first
      const urlSlug = new URLSearchParams(location.search).get("corpus") || "";
      const lsSlug  = (() => { try { return localStorage.getItem(LS_SLUG) || ""; } catch { return ""; }})();
      const pick    = urlSlug || lsSlug || (list[0]?.slug || list[0]?.corpus_id || "");
      const c = list.find(x => (x.slug || x.corpus_id) === pick) || list[0];
      if (!c) return;
      const sl = c.slug || c.corpus_id;
      setSlug(sl);
      setCorpusId(c.corpus_id);
      try { localStorage.setItem(LS_SLUG, sl); localStorage.setItem(LS_ID, c.corpus_id); } catch {}
      const qp = new URLSearchParams(location.search);
      qp.set("corpus", sl); qp.delete("corpus_id");
      history.replaceState(null, "", `?${qp.toString()}`);
    })();
    return () => { alive = false; };
  }, []);  // ← run exactly once

  useEffect(() => {
    const onChanged = (e) => {
      const s = e?.detail?.slug;
      if (!s || s === slug) return;
      setSlug(s);
      const c = corpora.find(x => (x.slug || x.corpus_id) === s);
      if (c) {
        setCorpusId(c.corpus_id);
        try {
          localStorage.setItem(LS_SLUG, s);
          localStorage.setItem(LS_ID, c.corpus_id);
        } catch {}
        const qp = new URLSearchParams(location.search);
        qp.set("corpus", s);
        qp.delete("corpus_id");
        history.replaceState(null, "", `?${qp.toString()}`);
      }
    };
    window.addEventListener("corpus:changed", onChanged);
    return () => window.removeEventListener("corpus:changed", onChanged);
  }, [slug, corpora]);




  useEffect(() => {
    fetch(`/api/me`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  

  // keep id up to date if corpora or slug changes
  useEffect(() => {
    if (!slug || !corpora.length) return;
    const found = corpora.find(c => (c.slug || c.corpus_id) === slug);
    if (found && found.corpus_id !== corpusId) setCorpusId(found.corpus_id);
  }, [slug, corpora]);


  useEffect(() => {
    if (!corpusId) return;
    setLoading(true);
    (async () => {
      try {


        const qs = new URLSearchParams({ mine: "1", home: "1" });
        if (corpusId) qs.set("corpus_id", corpusId);
        const r = await fetch(`/api/briefs?${qs.toString()}`, { credentials: "include" });

        if (r.status === 401) { window.location = "/signin"; return; }
        if (!r.ok) throw new Error(await r.text());
        const list = await r.json();
        const firstSix = Array.isArray(list) ? list.slice(0, 6) : [];
        const hydrated = await hydrateLatest(firstSix);
        setItems(hydrated);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [corpusId]);

  function runJson(run) {
    if (!run || run.content_json == null) return null;
    return typeof run.content_json === "string" ? JSON.parse(run.content_json) : run.content_json;
  }

  function BriefTeaser ({ brief, bigImageTop = false, onOpen, onRefresh, isBusy }) {
    const updatedAt = brief?.latest_run?.run_at || brief?.last_run_at || null;
    const cj = runJson(brief.latest_run);
    // consider it "has run" if we have a run timestamp or a latest_run object
    const hasRun =
      !!(brief?.latest_run?.run_at || brief?.last_run_at || brief?.latest_run);
    const tease = (cj?.home_tease?.sentence || "").trim();
    const ht = brief?.latest_run?.content_json?.home_tease || {};
    return (
      <div
        onClick={onOpen}
        role="button"
        tabIndex={0}
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          background: "#fff",
          padding: 12,
          cursor: "pointer",
          position: "relative"        }}
      >


        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
          <div style={{ fontWeight: 600 }}>{brief.title}</div>
          <div style={{ fontSize: 12, fontWeight: 400, color: "#666" }}>
            Timeframe: {brief.window}
          </div>
        </div>
        <div style={{ fontSize: 14, color: "#111", marginBottom: 8 }}>
          {ht.lines_html
            ? <div dangerouslySetInnerHTML={{ __html: ht.lines_html }} />
            : ht.sentence
              ? <div style={{ fontSize: 14, color: "#222" }}>{ht.sentence}</div>
              : <div style={{ fontSize: 14, color: "#555" }}>No articles found for timeframe and filters.</div>}
        </div>

        <div style={{ fontSize: 12, color: "#666" }}>
          Updated {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
        </div>
      </div>
    );
  }



  return (
    <div style={{ maxWidth: 1100, margin: '4px auto 0', padding: '0 12px' }}>
      <AuthHeader />

      {loading && <div>Loading…</div>}

       {!loading && items.length > 0 && (
         <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
           {/* LEFT 2/3: up to two brief teasers stacked */}
           <div style={{ display: "grid", gridAutoRows: "minmax(0, auto)", gap: 16 }}>
             {items[0] && (
               <BriefTeaser
                 brief={items[0]}
                 onOpen={() => window.open(`/report?id=${encodeURIComponent(items[0].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                 onRefresh={() => refreshBrief(items[0])}
                 isBusy={busyId === String(items[0].id)}
               />
             )}
             {items[1] && (
               <BriefTeaser
                 brief={items[1]}
                 onOpen={() => window.open(`/report?id=${encodeURIComponent(items[1].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                 onRefresh={() => refreshBrief(items[1])}
                 isBusy={busyId === String(items[1].id)}
               />
             )}
           </div>
           {/* RIGHT 1/3: one teaser */}
           <div>
             {items[2] && (
               <BriefTeaser
                 brief={items[2]}
                 bigImageTop
                 onOpen={() => window.open(`/report?id=${encodeURIComponent(items[2].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                 onRefresh={() => refreshBrief(items[2])}
                 isBusy={busyId === String(items[2].id)}
               />
             )}
           </div>
         </div>
 
        )}


        {/* ===== Block 2: briefs 4–6 ===== */}
        {items.length > 3 && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginTop: 16 }}>
            {/* LEFT 2/3: up to two brief teasers stacked */}
            <div style={{ display: "grid", gridAutoRows: "minmax(0, auto)", gap: 16 }}>
              {items[3] && (
                <BriefTeaser
                  brief={items[3]}
                  onOpen={() => window.open(`/report?id=${encodeURIComponent(items[3].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                  onRefresh={() => refreshBrief(items[3])}
                  isBusy={busyId === String(items[3].id)}
                />
              )}
              {items[4] && (
                <BriefTeaser
                  brief={items[4]}
                  onOpen={() => window.open(`/report?id=${encodeURIComponent(items[4].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                  onRefresh={() => refreshBrief(items[4])}
                  isBusy={busyId === String(items[4].id)}
                />
              )}
            </div>
            <div>
              {items[5] && (
                <BriefTeaser
                  brief={items[5]}
                  bigImageTop
                  onOpen={() => window.open(`/report?id=${encodeURIComponent(items[5].id)}&corpus=${encodeURIComponent(slug)}`, "_blank", "noopener")}
                  onRefresh={() => refreshBrief(items[5])}
                  isBusy={busyId === String(items[5].id)}
                />
              )}
            </div>
          </div>
        )}

      {!loading && items.length === 0 && (
        <div style={{ border:"1px solid #e5e5e5", borderRadius:12, background:"#fff", padding:16 }}>
          <div style={{ fontWeight:600, marginBottom:6 }}>No Home reports yet</div>
          <div style={{ fontSize:14, color:"#555" }}>
            Mark a report as <em>Set as Home</em> on the <a href="/reports/">Reports</a> page.
          </div>
        </div>
      )}
    </div>



  );
}
