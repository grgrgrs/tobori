// src/components/AuthHeader.jsx
import React, { useEffect, useState } from 'react';
import { getSelectedCorpusId, setSelectedCorpusId } from '../lib/auth.js';

export default function AuthHeader() {
  const [corpora, setCorpora] = useState([]);
  const [sel, setSel] = useState(getSelectedCorpusId());

  useEffect(() => {
    (async () => {


      const res = await fetch('/api/corpora', { credentials: 'include' });
      if (res.status === 401) {
        // Not logged in → render no menu; page can redirect elsewhere
        setCorpora([]);
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data?.corpora) ? data.corpora
                 : Array.isArray(data) ? data : [];
      setCorpora(list);

  
      if (!sel && list.length) {
        setSel(list[0].corpus_id);
        setSelectedCorpusId(list[0].corpus_id);
      }



    })();
  }, []);

  // When selection changes: persist, update the URL, and notify the page
  useEffect(() => {
    if (!sel) return;
    setSelectedCorpusId(sel);
    const url = new URL(window.location.href);
    url.searchParams.set('corpus_id', sel);
    window.history.replaceState({}, '', url);
    window.dispatchEvent(new CustomEvent('corpus-changed', { detail: sel }));
  }, [sel]);

  async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    setSelectedCorpusId('');
    location.assign('/login');
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderBottom:'1px solid #eee' }}>
      <strong>Corpus:</strong>

      <select value={sel || ''} onChange={e => setSel(e.target.value)}>
        {(Array.isArray(corpora) ? corpora : []).map(c => (
          <option key={c.corpus_id} value={c.corpus_id}>
            {c.label || c.corpus_id}
          </option>
        ))}

      </select>
      <div style={{ flex:1 }} />
      <button onClick={logout}>Logout</button>
    </div>
  );
}
