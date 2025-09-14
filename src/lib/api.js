// src/lib/api.js
import { getSelectedCorpusId } from './auth.js';



// Base fetch that always sends cookies (same-origin) and JSON headers.
export async function apiFetch(path, options = {}) {
  const opts = {
    credentials: 'include', // send/receive the sid cookie
    headers: { ...(options.headers || {}) },
    ...options,
  };
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  // not all routes return JSON; try JSON first, fall back to text
  try { return await res.json(); } catch { return await res.text(); }
}

// Add ?corpus_id=… to GETs and include cookies.
export async function apiGetJSON(path, { withCorpus = true } = {}) {
  let url = path;
  if (withCorpus) {
    const cid = getSelectedCorpusId();
    if (cid) url += (url.includes('?') ? '&' : '?') + 'corpus_id=' + encodeURIComponent(cid);
  }
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// POST JSON (with cookies); body is JS object.
export async function apiPostJSON(path, body, { withCorpus = false } = {}) {
  let url = path;
  if (withCorpus) {
    const cid = getSelectedCorpusId();
    if (cid) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}corpus_id=${encodeURIComponent(cid)}`;
    }
  }
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}
