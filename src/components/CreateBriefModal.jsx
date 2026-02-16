import React, { useEffect, useState } from "react";

// Light, consistent UI primitives (no Tailwind)
const UI = {
  fieldWrap: { minWidth: 0 },
  label: { display: "block", marginBottom: 4, fontSize: 13, color: "#111" },
  input: {
    width: "100%", boxSizing: "border-box",   // <— important in grids
    padding: "6px 10px", border: "1px solid #d9d9d9", borderRadius: 6, fontSize: 14,
  },
  select: {
    width: "100%", boxSizing: "border-box",   // <— important in grids
    padding: "6px 8px", border: "1px solid #d9d9d9", borderRadius: 6, fontSize: 14, background: "#fff",
  },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  row21: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 },
  btn: {
    base: {
      padding: "6px 12px",
      border: "1px solid #d0d0d0",
      borderRadius: 6,
      background: "#fff",
      cursor: "pointer",
    },
    primary: { background:'#2b6cb0', color:'#fff', borderColor:'#2b6cb0' },
  },
};
const STORY_FONT = "'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const LENGTH_TO_TOPN = { short: 3, medium: 5, long: 7 };
const coverageLabel = (v) => (v === "daily" ? "Daily" : v === "weekly" ? "Weekly" : "Monthly");
// New timeframe label set (UI values: '24h' | '7d' | '30d' | 'all')
const timeframeLabel = (v) =>
  v === "24h" ? "Last 24 hours" : v === "7d" ? "Last week" : v === "30d" ? "Last month" : "All time";
const BADGE = { border:'1px solid #e5e5e5', borderRadius:12, padding:'2px 8px', background:'#fff', marginLeft:6 };

function parseCSV(s) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeCorpora(list) {
  return (list || []).map((c) => ({
    value: c.corpus_id ?? c.id ?? c.value ?? "",
    label: c.label ?? c.name ?? c.display ?? (c.corpus_id ?? ""),
  })).filter(x => x.value);
}

export default function CreateBriefModal({
  open,
  mode = "create", // "create" | "edit"
  initial = null, // when edit: { id, title, corpus_id, window, visibility, prompt_template, options_json }
  corpusOptions = null,
  activeCorpus = null,
  onClose,
  onSaved,
}) {
  const isEdit = mode === "edit";

  // core fields
  const [title, setTitle] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [visibility, setVisibility] = useState("private");  // hidden control; payload still includes it
  const [prompt, setPrompt] = useState("");

  // options_json -> UI knobs (MVP)
  const [tone, setTone] = useState("conversational");
  const [length, setLength] = useState("medium"); // short|medium|long
  const [style, setStyle] = useState("paragraphs"); // paragraphs|bullets
  const [keywordsCSV, setKeywordsCSV] = useState("");
  const [sourcesCSV, setSourcesCSV] = useState("");
  // novelty control removed from UI (disabled in backend)
  // New timeframe choices mapped to backend:
  // '24h'|'7d'|'30d' -> timeframe='lookback' + lookback_days (1|7|30); 'all' -> timeframe='all'
  const [windowVal, setWindowVal] = useState(initial?.window ?? "daily");
  const [dateBasis, setDateBasis] = useState("published");

  const WINDOW_OPTIONS = [
    { value: "daily",   label: "Last 24 hours" },
    { value: "weekly",  label: "Last week" },
    { value: "monthly", label: "Last month" },
    { value: "all",     label: "All time" },
  ];

  const windowLabel = (w) =>
    (WINDOW_OPTIONS.find(o => o.value === (w || "daily")) || WINDOW_OPTIONS[0]).label;
  // map UI window to API payload: omit when "all"
  // preview state
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [compiledPrompt, setCompiledPrompt] = useState("");
  const [showCompiled, setShowCompiled] = useState(false);
  const [viewMode, setViewMode] = useState("latest"); // 'latest' | 'preview'
  const [latestRun, setLatestRun] = useState(null);
  const [fetchedCorpora, setFetchedCorpora] = useState([]);
  const corpusChoices =
    Array.isArray(corpusOptions) && corpusOptions.length ? corpusOptions : fetchedCorpora;

  useEffect(() => {
    if (!corpusId && corpusChoices.length) setCorpusId(corpusChoices[0].value);
  }, [corpusChoices, corpusId]);


  useEffect(() => {
    if (!initial?.corpus_id || !corpusChoices.length) return;

    const foundById = corpusChoices.find(c => c.value === initial.corpus_id);
    if (foundById) return; // already an id

    // try to resolve a label → id
    const foundByLabel = corpusChoices.find(c => c.label === initial.corpus_id);
    if (foundByLabel) setCorpusId(foundByLabel.value);
  }, [initial?.corpus_id, corpusChoices]);

  useEffect(() => {
    if (!corpusId && corpusChoices.length) setCorpusId(corpusChoices[0].value);
  }, [corpusChoices, corpusId]);


  useEffect(() => {
    if (Array.isArray(corpusOptions) && corpusOptions.length) return;

    (async () => {
      try {
        const r = await fetch("/api/corpora", { credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();   // expects the array from _corpora_payload
        setFetchedCorpora(normalizeCorpora(data));
      } catch {}
    })();
  }, [corpusOptions]);


  useEffect(() => {
    if (Array.isArray(corpusOptions) && corpusOptions.length) return;

    // a) pick up corpus from URL once
    const qs = new URLSearchParams(window.location.search);
    const urlSlug = qs.get("corpus");
    const urlId   = qs.get("corpus_id");
    if (urlId) setCorpusId(urlId);


    // b) stay in sync with header (if it dispatches this)
    const onCorpusChanged = (e) => { if (e?.detail) setCorpusId(e.detail); }; // legacy (id)
    const onCorpusChangedNew = (e) => {
      const s = e?.detail?.slug;
      if (!s) return;
      const m = fetchedCorpora.find(c => (c.slug || c.value) === s);
      if (m?.value) setCorpusId(m.value);
    };
    window.addEventListener("corpus-changed", onCorpusChanged);
    window.addEventListener("corpus:changed", onCorpusChangedNew);

    // c) fetch memberships
    (async () => {
      try {
        const res = await fetch("/api/corpora", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.corpora) ? data.corpora : (Array.isArray(data) ? data : []);
        const mapped = list.map(c => ({
          value: c.corpus_id || c.value || c.id,
          label: c.label || c.name || c.corpus_id,
          slug:  c.slug || c.corpus_id,
        }));
        setFetchedCorpora(mapped);

        // default to first if nothing selected
        if (!urlSlug && !urlId && !corpusId && mapped.length) setCorpusId(mapped[0].value);
        // if URL had slug, resolve now
        if (urlSlug && !corpusId) {
          const found = mapped.find(c => c.slug === urlSlug);
          if (found) setCorpusId(found.value);
        }
      } catch {}
    })();

    return () => {
      window.removeEventListener("corpus-changed", onCorpusChanged);
      window.removeEventListener("corpus:changed", onCorpusChangedNew);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpusOptions]);

  useEffect(() => {
    if (!open) return;
    setViewMode("latest");
    setPreviewHtml("");
    setCompiledPrompt("");

    if (isEdit && initial?.id) {
      fetch(`/api/briefs/${initial.id}/latest`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No latest run"))))
        .then((data) => {
          setLatestRun(data);
          setPreviewHtml(styledHtml(data.content_html || ""));
        })
        .catch(() => {
          setLatestRun(null);
          setPreviewHtml(""); // no run yet; viewer shows empty state
        });
    } else {
      setLatestRun(null);
    }
  }, [open, isEdit, initial?.id]);

  useEffect(() => {
    if (!open) return;
    // hydrate from initial (edit) or reset (create)
    setTitle(initial?.title || "");
    setCorpusId(initial?.corpus_id || activeCorpus?.id || activeCorpus?.corpus_id || "");
    // If options_json.timeframe === "all", show All time; else fall back to DB window
    try {
      const raw = initial?.options_json ?? initial?.options;
      const opts = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
      setWindowVal(opts?.timeframe === "all" ? "all" : (initial?.window || "daily"));
    } catch {
      setWindowVal(initial?.window || "daily");
    }
    setVisibility(initial?.visibility || "private");
    setPrompt(initial?.prompt_template || "");

    const opts = initial?.options_json || {};
    const fmt = opts.format || {};
    setTone(opts.tone || "conversational");
    setLength(fmt.length || "medium");
    setStyle(fmt.style || "paragraphs");
    setKeywordsCSV((opts.keywords || []).join(", "));
    setSourcesCSV((opts.sources_exclude || []).join(", "));
    // Hydrate date-basis (support either date_basis or recency_by if present)
    const basis = (opts.date_basis || opts.recency_by || "published").toLowerCase();
    setDateBasis(basis.startsWith("pub") ? "published" : "processed");


    setPreviewHtml("");
    setCompiledPrompt("");
    setShowCompiled(false);
    setSaving(false);
    setPreviewing(false);
  }, [open, initial, mode]);

  if (!open) return null;

  function mdLiteToHtml(md) {
    if (!md) return "";
    // escape (so HTML in user text can’t break layout)
    let s = md.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // links: [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
                  '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // bold/italic: **text** and *text*
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // paragraphs & bullets
    const lines = s.split(/\r?\n/);
    let html = "", inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (inList) { html += "</ul>"; inList = false; } continue; }
      if (/^[-•]\s+/.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${line.replace(/^[-•]\s+/, "")}</li>`;
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<p>${line}</p>`;
      }
    }
    if (inList) html += "</ul>";
    return html;
  }

  function coerceToHtml(s) {
    if (!s) return "";
    // If it already looks like HTML, trust it; otherwise convert Markdown-ish.
    const looksHtml = /<\/(p|div|ul|ol|li|h\d|a)>/i.test(s) || /<p[\s>]/i.test(s);
    return looksHtml ? s : mdLiteToHtml(s);
  }

  function buildOptionsJson() {
    const keywords = parseCSV(keywordsCSV);
    const sources_exclude = parseCSV(sourcesCSV).map((s) => s.toLowerCase());
    const top_n = LENGTH_TO_TOPN[length] || 5;

    // map UI window to backend semantics:
    // daily/weekly/monthly -> rolling lookback; all -> all time
    const timeframe =
      windowVal === "all" ? "all" : "lookback";
    const lookback_days =
      windowVal === "daily"   ? 1 :
      windowVal === "weekly"  ? 7 :
      windowVal === "monthly" ? 30 : 1;


    return {
      timeframe,
      lookback_days: timeframe === "lookback" ? lookback_days : undefined,
      date_basis: dateBasis,
      themes_include: [],
      keywords,
      sources_exclude,
      tone,
      format: {
        style,
        length,
        paragraphs: top_n,
        links_per_item_min: 1,
        links_per_item_max: 2,
        length_words: null,
        // keep your "since yesterday" line for non-all; all-time -> none
        since_yesterday: (windowVal === "all") ? "none" : "line",
      },
      top_n,
      candidate_pool: 250,
      input_per_source_cap: 5,
      output_per_source_cap: 2,
      novelty_boost: "none",
    };
  }

  // Convert markdown-ish text to minimal HTML if needed
  function normalizeReportHtml(s) {
    if (!s) return "";
    // already HTML?
    if (s.includes("<p") || s.includes("<h") || s.includes("<ul") || s.includes("<a ")) return s;

    // ### Headings → <h3>
    s = s.replace(/(^|\n)\s*###\s+(.+?)(\n|$)/g, '$1<h3>$2</h3>\n');
    // [text](url) → <a href="url">text</a>
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2">$1</a>');
    // **bold** → <strong>
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Paragraphs on blank lines
    s = s
      .trim()
      .split(/\n\s*\n/)
      .map((p) => `<p>${p.trim()}</p>`)
      .join("\n");
    return s;
  }

  function styledHtml(s) {

    let html = coerceToHtml(s || "");

    html = html
      .replaceAll("<p>", '<p style="margin:10px 0; line-height:1.78;">')
      .replaceAll("<ul>", '<ul style="margin:10px 0 10px 20px;">')
      .replaceAll("<li>", '<li style="margin:6px 0;">');

    return html;
  }

  async function handleSaveAndRun(e) {
    e?.preventDefault?.();
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        corpus_id: (corpusId || "").trim(),
        prompt_template: prompt,
        visibility,
        window: windowVal,               // 'daily' | 'weekly' | 'monthly' | 'all'
        options_json: buildOptionsJson(),
      };

      // create or patch
      let briefId = initial?.id;
      if (isEdit) {
        const resp = await fetch(`/api/briefs/${briefId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error(await resp.text());
      } else {
        const resp = await fetch(`/api/briefs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        briefId = data.id;
      }

      // run now (UPSERT today's window)
      const r2 = await fetch(`/api/briefs/${briefId}/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r2.ok) throw new Error(await r2.text());

      onSaved?.(); // tell parent to refresh list
      onClose?.();
    } catch (err) {
      alert(`Save & Run failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewHtml("");
    setCompiledPrompt("");

    try {
      const url = isEdit ? `/api/briefs/${initial.id}/preview` : `/api/briefs/preview/new`;

      const body = isEdit
        ? { options_overrides: buildOptionsJson(), prompt_template: prompt }
        
        : (() => {
            const base = {
              corpus_id: (corpusId || "").trim(),
              window: windowVal,
              prompt_template: prompt,
              options_json: buildOptionsJson(),
            };

            return { ...base, window: windowVal };
          })();

      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await resp.text());

      const data = await resp.json();
      setPreviewHtml(styledHtml(data.content_html || ""));
      setCompiledPrompt(data.compiled_prompt || "");
      setViewMode("preview");
    } catch (e) {
      alert(`Preview failed: ${e.message}`);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          margin: "1.5rem",
          width: "100%",
          maxWidth: "1200px",
          borderRadius: "16px",
          padding: "24px",
          background: "#fff",
          color: "#111",
          border: "1px solid #e5e5e5",
          boxShadow: "0 10px 24px rgba(0,0,0,.08)",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{isEdit ? "Edit Brief" : "Create Brief"}</h2>
        </div>

        {/* 2/7 : 5/7 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 2fr) 5fr",
            gap: "24px",
          }}
        >
          {/* LEFT: knobs / form */}

           <form
             onSubmit={handleSaveAndRun}
             style={{
               display: "grid",
               gridTemplateColumns: "1fr",
               rowGap: 8,                // tighter vertical rhythm
               alignSelf: "start",       // don’t stretch to match right column
               maxHeight: "64vh",        // keep it compact
               overflowY: "auto",        // scroll if it gets longer
               paddingRight: 4           // avoid scrollbar overlap
             }}
           >

            <div style={UI.fieldWrap}>
              <label style={UI.label}>Title</label>
              <input
                style={UI.input}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}  // <-- critical
                placeholder="e.g., Today, Weekly Roundup"
                disabled={saving}                           // do NOT disable during preview
              />
            </div>

            <div style={UI.row2}>
              <div style={UI.fieldWrap}>
                <label style={UI.label}>Corpus</label>
                <div style={{ fontSize: 14, padding: "6px 0" }}>
                  <span style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: "2px 8px", background: "#fff" }}>
                    {activeCorpus?.label || activeCorpus?.slug || activeCorpus?.id || corpusId || "—"}
                  </span>
                </div>
              </div>

              <div style={UI.fieldWrap}>
                <label style={UI.label}>Date basis</label>
                <select
                  style={UI.select}
                  value={dateBasis}
                  onChange={(e) => setDateBasis(e.target.value)}
                >
                  <option value="processed">Processed date</option>
                  <option value="published">Published date</option>
                </select>
              </div>


            </div> {/* end row2 (Corpus & Visibility) */}

            {/* Coverage (Schedule) hidden for now; keep state, no control */}
 
 
            {/* Row: Timeframe + Tone */}
            <div style={UI.row2}>
              <div style={UI.fieldWrap}>

              <label style={UI.label}>Timeframe</label>
              <select
                value={windowVal}
                onChange={(e) => setWindowVal(e.target.value)}
                style={UI.input}
              >
                {WINDOW_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              </div>
              <div style={UI.fieldWrap}>
                <label style={UI.label}>Tone</label>
                <select style={UI.select} value={tone} onChange={e => setTone(e.target.value)}>
                  <option value="conversational">Conversational</option>
                  <option value="executive">Executive</option>
                  <option value="researcher">Researcher</option>
                </select>
              </div>
            </div>  {/* end row2 (Timeframe + Tone) */}






            {/* Row: Length + Style (expanded) */}
            <div style={UI.row2}>
              <div style={UI.fieldWrap}>
                <label style={UI.label}>Length</label>
                <select style={UI.select} value={length} onChange={e => setLength(e.target.value)}>
                  <option value="short">Short (3)</option>
                  <option value="medium">Medium (5)</option>
                  <option value="long">Long (7)</option>
                </select>
              </div>

              <div style={UI.fieldWrap}>
                <label style={UI.label}>Style</label>
                <select style={UI.select} value={style} onChange={e => setStyle(e.target.value)}>
                  <option value="paragraphs">Paragraphs</option>
                  <option value="bullets">Bullets</option>
                </select>
              </div>
            </div>




            {/* Keywords (full row) */}
            <div>
              <label style={UI.label}>Keywords (comma-separated / Boolean)</label>
              <textarea
                value={keywordsCSV}
                onChange={(e) => setKeywordsCSV(e.target.value)}
                placeholder={`e.g., (ai OR "artificial intelligence") AND (buddhist OR buddhism)`}
                rows={4}
                style={{ ...UI.input, height: "auto", minHeight: 88, resize: "vertical" }}
              />
            </div>

            {/* Per-source cap & What's-new removed from UI in this phase */}


            {/* Source exclusions (full row) */}
            <div>
              <label style={UI.label}>Source exclusions (comma-separated)</label>
              <input
                style={UI.input}
                value={sourcesCSV}
                onChange={(e) => setSourcesCSV(e.target.value)}
                placeholder="medium.com, youtube.com"
              />
            </div>


            <div style={UI.actions}>
              <button type="button" onClick={onClose} style={UI.btn.base}>
                Cancel
              </button>
              <button type="button" onClick={handlePreview} disabled={previewing} style={UI.btn.base}>
                {previewing ? "Previewing…" : "Preview"}
              </button>
              <button type="submit" disabled={saving} style={{ ...UI.btn.base, ...UI.btn.primary }}>
                {saving ? "Saving…" : isEdit ? "Save & Run" : "Create & Run"}
              </button>
            </div>
          </form>

          {/* RIGHT: viewer + prompt */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Viewer */}
              <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden",
                flex: "1 1 auto", minHeight: 420 }}>
              {/* Status bar */}
              <div
                style={{
                  background: "#f7f7f9",
                  borderBottom: "1px solid #e5e5e5",
                  padding: "6px 10px",
                  fontSize: 12,
                  color: "#555",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  {viewMode === "latest" && latestRun ? (
                    <>
                      Viewing <strong style={{ color: "#111" }}>latest run</strong> ·{" "}
                      {new Date(latestRun.run_at).toLocaleString()}
                    </>
                  ) : (
                    <>
                      Viewing <strong style={{ color: "#111" }}>preview</strong> (not saved)
                    </>
                  )}

                 <div style={{ display:'flex', alignItems:'center' }}>
                    <span style={UI.badge}>Timeframe: {windowLabel(windowVal)}</span>
                    <span style={BADGE}>Basis: {dateBasis === "published" ? "Published" : "Processed"}</span>
                 </div>


                </div>
              </div>

              {/* Story body */}
              <div style={{ padding: 16, height: "58vh", overflowY: "auto", fontFamily: STORY_FONT,
                  wordBreak: 'break-word' }}>


                {previewHtml ? (
                  <>
                    <div
                      className="brief-html"
                      dangerouslySetInnerHTML={{
                        __html: styledHtml(normalizeReportHtml(previewHtml)),
                      }}
                    />

                  </>
                ) : (


                  <p style={{ fontSize: 14, color: "#777", margin: 0 }}>
                    {isEdit ? "No runs yet. Click Preview to generate a draft." : "Fill the form and click Preview."}
                  </p>
                )}
              </div>
            </div>

            {/* Prompt editor */}
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff", padding: 12 }}>


              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Prompt (per-brief)</label>
              </div>

              <textarea
                style={{
                  width: "100%",
                  height: 160,
                  fontFamily: STORY_FONT,
                  padding: "8px 12px",
                  border: "1px solid #d9d9d9",
                  borderRadius: 6,
                }}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe priorities, POV, emphasis…"
              />

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
