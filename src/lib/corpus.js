export function normalizeCorpora(raw) {
  const list = Array.isArray(raw?.corpora) ? raw.corpora : Array.isArray(raw) ? raw : [];
  return list.map(o => ({
    id: o.id || o.corpus_id,                 // use corpus_id as id
    slug: o.slug || o.corpus_id,             // slug (backfilled) or fall back to id
    name: o.name || o.label || o.slug || o.corpus_id,
  })).filter(x => x.id && x.slug);
}

export function slugToId(corpora, slug) {
  const m = corpora.find(c => String(c.slug) === String(slug));
  return m ? m.id : "";
}

export function idToSlug(corpora, id) {
  const m = corpora.find(c => String(c.id) === String(id));
  return m ? m.slug : "";
}

export function resolveInitialSlug(corpora, mePref="") {
  const urlSlug = new URLSearchParams(window.location.search).get("corpus");
  const ls = localStorage.getItem("active_corpus_slug") || "";
  const candidates = [urlSlug, mePref, ls, corpora[0]?.slug].filter(Boolean);
  const firstValid = candidates.find(s => corpora.some(c => c.slug === s));
  return firstValid || corpora[0]?.slug || "";
}

export async function persistActiveSlug(slug) {
  try {
    await fetch("/api/me/active_corpus", {
      method:"POST", credentials:"include",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ slug }),
    });
  } catch {}
  localStorage.setItem("active_corpus_slug", slug);
}

export function setUrlCorpus(slug, replace=true) {
  const u = new URL(window.location.href);
  u.searchParams.set("corpus", slug);
  u.searchParams.delete("corpus_id"); // remove legacy param
  (replace ? window.history.replaceState : window.history.pushState).call(window.history, {}, "", u.toString());
}
