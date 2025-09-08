// src/lib/auth.js
const isBrowser =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof localStorage !== 'undefined';

export function getSelectedCorpusId() {
  if (!isBrowser) return '';
  try { return localStorage.getItem('selectedCorpusId') || ''; }
  catch { return ''; }
}

export function setSelectedCorpusId(id) {
  if (!isBrowser) return;
  try {
    if (id) localStorage.setItem('selectedCorpusId', id);
    else localStorage.removeItem('selectedCorpusId');
  } catch {}
}

// Redirect to /login if not authed; no-op during SSR
export async function ensureAuthedOrRedirect() {
  if (!isBrowser) return []; // let the client run the real check
  const r = await fetch('/api/corpora', { credentials: 'include' });
  if (r.status === 401 || r.status === 403) {
    const next = encodeURIComponent(location.pathname + location.search);
    if (!location.pathname.startsWith('/api/login')) {
      location.assign(`/api/login?next=${next}`);
    }
    throw new Error('redirecting to login');
  }
  if (!r.ok) throw new Error(`corpora ${r.status}`);
  return r.json();
}
