import React, { useEffect, useState } from 'react';
import { apiGetJSON, apiPostJSON } from '../lib/api.js';
import { setSelectedCorpusId, getSelectedCorpusId } from '../lib.auth.js';

export default function LoginGate({ onReady }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('GR-LENS-2025');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [corpora, setCorpora] = useState([]);
  const [selected, setSelected] = useState(() => getSelectedCorpusId());

  async function loadCorpora() {
    const list = await apiGetJSON('/corpora', { withCorpus: false });
    if (Array.isArray(list)) setCorpora(list);
    return list;
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // If already authed, this will succeed and we can skip the form
        const list = await loadCorpora();
        if (!selected && list?.length) {
          setSelected(list[0].corpus_id);
        }
      } catch {
        // not logged in → show form
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // announce readiness whenever selection becomes available
    if (selected) {
      setSelectedCorpusId(selected);
      onReady?.(selected);
    }
  }, [selected, onReady]);

  async function handleInvite(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      // 1) POST invite; server sets sid cookie
      await apiPostJSON('/signup/invite', { email, code }, { withCorpus: false });

      // 2) fetch corpora
      const list = await loadCorpora();
      if (list?.length) {
        setSelected(list[0].corpus_id);
      }
    } catch (ex) {
      setErr(ex.message || 'Invite failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setErr('');
    setLoading(true);
    try {
      await apiPostJSON('/api/logout', {}, { withCorpus: false });
    } finally {
      setSelectedCorpusId('');
      setSelected('');
      setCorpora([]);
      setLoading(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  if (!corpora.length) {
    return (
      <form onSubmit={handleInvite} style={{ maxWidth: 380, margin: '10vh auto', display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Sign in with Invite</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Invite Code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} required />
        </label>
        <button type="submit">Continue</button>
        {err && <div style={{ color: 'crimson' }}>{err}</div>}
      </form>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #eee' }}>
      <strong>Corpus:</strong>
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {corpora.map((c) => (
          <option key={c.corpus_id} value={c.corpus_id}>
            {c.label || c.corpus_id}
          </option>
        ))}
      </select>
      <div style={{ flex: 1 }} />
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}
