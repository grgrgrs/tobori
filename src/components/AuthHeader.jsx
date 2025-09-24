// src/components/AuthHeader.jsx
import React, { useEffect, useState, useRef  } from 'react';

export default function AuthHeader() {
  const LS_SLUG = "tobori.corpus_slug";
  const LS_ID   = "tobori.corpus_id";
  const [corpora, setCorpora] = useState([]);
  const [slug, setSlug] = useState(() => {
    // URL first
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = qs.get("corpus") || "";
    if (fromUrl) return fromUrl;
    // then localStorage
    try { return localStorage.getItem(LS_SLUG) || ""; } catch { return ""; }
  });

  const userChangeRef = useRef(false);


  React.useEffect(() => {
    // Resolve starting slug from URL → localStorage
    const urlSlug = new URLSearchParams(window.location.search).get("corpus") || "";
    let s = urlSlug;
    if (!s) { try { s = localStorage.getItem(LS_SLUG) || ""; } catch {} }
    setSlug(s);
    // Listen for cross-page changes
    const onChanged = (e) => { if (e?.detail?.slug) setSlug(e.detail.slug); };
    window.addEventListener("corpus:changed", onChanged);
    return () => window.removeEventListener("corpus:changed", onChanged);
  }, []);

  const withCorpus = (path) => slug ? `${path}?corpus=${encodeURIComponent(slug)}` : path;

  // Keep header select in sync when other pages change corpus
  useEffect(() => {
    const onChanged = (e) => {
      const s = e?.detail?.slug;
      if (!s) return;
      // update UI only; do NOT set userChangeRef.current
      setSlug(s);

      // keep URL + LS aligned (no emit because userChangeRef is false)
      try { localStorage.setItem(LS_SLUG, s); } catch {}
      const qs = new URLSearchParams(location.search);
      qs.set("corpus", s); qs.delete("corpus_id");
      history.replaceState(null, "", `?${qs.toString()}`);
    };
    window.addEventListener("corpus:changed", onChanged);
    return () => window.removeEventListener("corpus:changed", onChanged);
  }, []);


  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/corpora", { credentials: "include" });
      if (!r.ok) return;
      const j = await r.json();
      const list = Array.isArray(j?.corpora) ? j.corpora
                 : Array.isArray(j) ? j : [];
      if (!alive) return;

      setCorpora(list);

      // Resolve initial selection: URL → localStorage → first
      const qs = new URLSearchParams(location.search);
      const urlSlug = qs.get("corpus") || "";
      let lsSlug = "";
      try { lsSlug = localStorage.getItem(LS_SLUG) || ""; } catch {}

      const initial = urlSlug || lsSlug || (list[0]?.slug || list[0]?.corpus_id || "");
      if (!initial) return;

      // Set the header's <select> value, canonicalize URL,
      // but DO NOT broadcast here (avoid overriding other pages).
      setSlug(initial);
      const found = list.find(c => (c.slug || c.corpus_id) === initial);
      if (found) {
        try {
          localStorage.setItem(LS_SLUG, initial);
          localStorage.setItem(LS_ID, found.corpus_id);
        } catch {}
      }
      qs.set("corpus", initial); qs.delete("corpus_id");
      history.replaceState(null, "", `?${qs.toString()}`);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onChanged = (e) => {
      const s = e?.detail?.slug;
      if (!s) return;
      setSlug(s); // UI-only; userChangeRef stays false, so no re-broadcast
      // keep URL aligned
      const qs = new URLSearchParams(location.search);
      qs.set("corpus", s); qs.delete("corpus_id");
      history.replaceState(null, "", `?${qs.toString()}`);
      try { localStorage.setItem(LS_SLUG, s); } catch {}
    };
    window.addEventListener("corpus:changed", onChanged);
    return () => window.removeEventListener("corpus:changed", onChanged);
  }, []);


  // keep URL + listeners in sync when slug changes
  useEffect(() => {
    if (!slug) return;
    // map slug to corpus_id (if available)
    const found = corpora.find(c => (c.slug || c.corpus_id) === slug);

    // persist
    try {
      localStorage.setItem(LS_SLUG, slug);
      if (found?.corpus_id) localStorage.setItem(LS_ID, found.corpus_id);
    } catch {}

    // canonicalize URL
    const qs = new URLSearchParams(window.location.search);
    qs.set("corpus", slug); qs.delete("corpus_id");
    window.history.replaceState(null, "", `?${qs.toString()}`);

    // broadcast only for user-initiated changes
    if (userChangeRef.current) {
      window.dispatchEvent(new CustomEvent("corpus:changed", { detail: { slug } }));
      if (found?.corpus_id) {
        window.dispatchEvent(new CustomEvent("corpus-changed", { detail: found.corpus_id })); // legacy
      }
      userChangeRef.current = false;
    }
  }, [slug, corpora]);


  if (!corpora.length) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
        margin: '0 0 6px',
        fontSize: 13,
        lineHeight: 1.1,
        minHeight: 0,
      }}
    >
      <strong style={{ fontWeight: 600, fontSize: 13, marginRight: 4 }}>Corpus:</strong>
      <select
        value={slug}
        onChange={(e) => { userChangeRef.current = true; setSlug(e.target.value); }}

        style={{ fontSize: 13, padding: '1px 6px', height: 24, lineHeight: '20px', borderRadius: 6 }}
      >
        {corpora.map((c) => (
          <option key={c.slug || c.corpus_id} value={c.slug || c.corpus_id}>
            {c.label || c.name || c.slug || c.corpus_id}
          </option>
        ))}
      </select>
    </div>
  );
}
