import React, { useEffect, useState } from "react";

const STORY_FONT = "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
const BADGE = { border:'1px solid #e5e5e5', borderRadius:12, padding:'2px 8px', background:'#fff', marginLeft:6 };

const coverageLabel = (v) => (v === "daily" ? "Daily" : v === "weekly" ? "Weekly" : "Monthly");
const scopeLabel    = (v) => (v === "all" ? "All time" : "Coverage window");

function styledHtml(s) {
  return (s || "")
    .replaceAll("<h3>", '<h3 style="margin:14px 0 6px;font-size:18px;font-weight:600;">')
    .replaceAll("<p>",  '<p style="margin:10px 0;line-height:1.78;">')
    .replaceAll("<ul>", '<ul style="margin:10px 0 10px 20px;">')
    .replaceAll("<li>", '<li style="margin:6px 0;">');
}

export default function HomePage() {
  const [corpusId, setCorpusId] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);


  // hydrate a list with latest run (content_html) per brief
  async function hydrateLatest(list) {
    const out = [];
    for (const b of list) {
      // If list already includes latest_run with content_html, keep it.
      if (b?.latest_run?.content_html) { out.push(b); continue; }
      try {
        const r = await fetch(`/api/briefs/${b.id}/runs/latest`, { credentials: "include" });
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


  // pick active corpus from ?corpus_id or first from /api/corpora
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("corpus_id");
    if (fromUrl) {
      setCorpusId(fromUrl);
      return;
    }
    (async () => {
      try {
        const r = await fetch("/api/corpora", { credentials: "include" });
        if (r.status === 401) { window.location = "/signin"; return; }
        if (!r.ok) throw new Error("corpora");
        const data = await r.json();
        const list = Array.isArray(data) ? data : data?.corpora || [];
        const first = list[0]?.corpus_id || list[0]?.id || list[0]?.value;
        if (first) setCorpusId(first);
      } catch (e) {
        console.warn("No corpus available", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!corpusId) return;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/briefs?mine=1&home=1&corpus_id=${encodeURIComponent(corpusId)}`, { credentials: "include" });
        if (r.status === 401) { window.location = "/signin"; return; }
        if (!r.ok) throw new Error(await r.text());
        const list = await r.json();
        const firstFour = Array.isArray(list) ? list.slice(0, 4) : [];
        const hydrated = await hydrateLatest(firstFour);
        setItems(hydrated);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [corpusId]);

  async function runNow(id) {
    try {
      const r = await fetch(`/api/briefs/${id}/run`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      if (!r.ok) throw new Error(await r.text());
      // refresh
      const rr = await fetch(`/api/briefs?mine=1&home=1&corpus_id=${encodeURIComponent(corpusId)}`, { credentials: "include" });
      if (rr.ok) {
        const list = await rr.json();
        const firstFour = Array.isArray(list) ? list.slice(0, 4) : [];
        const hydrated = await hydrateLatest(firstFour);
        setItems(hydrated);
      }

    } catch (e) {
      alert(`Run failed: ${e.message}`);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 12 }}>
        <h1 style={{ margin:0, fontSize: 22 }}>Home</h1>
        <div style={{ fontSize: 13, color:"#555" }}>
          Corpus: <code>{corpusId || "…"}</code>
        </div>
      </div>

      {loading && <div>Loading…</div>}

      {!loading && items.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 16 }}>
          {items.map((b) => {
            const scope = b.options_json?.timeframe || b.options_json?.format?.timeframe || "window";
            const html  = b.content_html || "";
            const updated = b.last_run_at || b.latest_run?.run_at;
            return (
              <div key={b.id} style={{ border:"1px solid #e5e5e5", borderRadius:12, background:"#fff", overflow:"hidden" }}>
                <div style={{ padding:"10px 12px", borderBottom:"1px solid #e5e5e5", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ fontWeight:600 }}>
                    <a href={`/report?id=${b.id}`} className="text-blue-600 hover:underline">
                      {b.title}
                    </a>

                  </div>
                  <div style={{ display:"flex", alignItems:"center", fontSize:12, color:"#555" }}>
                    <span style={BADGE}>Coverage: {coverageLabel(b.window)}</span>
                    <span style={BADGE}>Scope: {scopeLabel(scope)}</span>
                  </div>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize:12, color:"#666", marginBottom:8 }}>
                    Updated {updated ? new Date(updated).toLocaleString() : "—"}
                  </div>
                  {html ? (
                    <div style={{ fontFamily: STORY_FONT }} dangerouslySetInnerHTML={{ __html: styledHtml(html) }} />
                  ) : (
                    <div style={{ fontSize:14, color:"#777" }}>No run yet.</div>
                  )}
                  <div style={{ marginTop: 10, display:"flex", justifyContent:"flex-end", gap: 8 }}>
                    <a
                      href={`/report?id=${b.id}`}
                      style={{ padding:"6px 10px", border:"1px solid #d0d0d0", borderRadius:6, background:"#fff", cursor:"pointer", textDecoration:"none", color:"#111" }}
                    >
                      Open
                    </a>
                    <button
                      onClick={() => runNow(b.id)}
                      style={{ padding:"6px 10px", border:"1px solid #d0d0d0", borderRadius:6, background:"#fff", cursor:"pointer" }}
                    >
                      Run now
                    </button>
                  </div>

                </div>
              </div>
            );
          })}
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
