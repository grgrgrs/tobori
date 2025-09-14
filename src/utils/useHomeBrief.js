import { useEffect, useMemo, useState } from "react";

/**
 * Resolve the user's default brief for a given active corpus.
 * Falls back to the first brief in that corpus if no default set.
 * Returns { brief, latestRun, html, loading, error }
 */
export function useHomeBrief(activeCorpusId) {
  const [brief, setBrief] = useState(null);
  const [latestRun, setLatestRun] = useState(null);
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeCorpusId) {
        setBrief(null);
        setLatestRun(null);
        setHtml(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/briefs?mine=1", { credentials: "include" });
        const all = await resp.json();
        const inCorpus = (all || []).filter((b) => b.corpus_id === activeCorpusId);
        if (inCorpus.length === 0) {
          if (!cancelled) {
            setBrief(null);
            setLatestRun(null);
            setHtml(null);
          }
          return;
        }
        const def = inCorpus.find((b) => b.is_default_home) || inCorpus[0];
        if (!cancelled) setBrief(def);

        // show latest run (yesterday OK until the ingestion-triggered run updates it)
        const r = await fetch(`/api/briefs/${def.id}/runs/latest`, {
          credentials: "include",
        });
        if (r.ok) {
          const data = await r.json();
          if (!cancelled) {
            setLatestRun(data);
            setHtml(data.content_html || null);
          }
        } else {
          if (!cancelled) {
            setLatestRun(null);
            setHtml(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeCorpusId]);

  return { brief, latestRun, html, loading, error };
}
