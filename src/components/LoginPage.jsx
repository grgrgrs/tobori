// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { setSelectedCorpusId } from '../lib/auth.js';

export default function LoginPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/articles';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('GR-LENS-2025');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      // 1) Invite → sets cookie
      const r = await fetch('/api/signup/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code }),
      });
      if (!r.ok) throw new Error(await r.text());

      // 2) Get corpora
      const corp = await fetch('/api/corpora', { credentials: 'include' }).then(r => r.json());
      const list = Array.isArray(corp?.corpora) ? corp.corpora : (Array.isArray(corp) ? corp : []);
      const firstId = list[0]?.corpus_id;
      const firstSlug = list[0]?.slug || firstId;
      if (firstId) setSelectedCorpusId(firstId);

      // 3) Go where the user wanted (append ?corpus=<slug> if missing)
      const u = new URL(next, location.origin);
      if (!u.searchParams.get('corpus') && firstSlug) {
        u.searchParams.set('corpus', firstSlug);
        u.searchParams.delete('corpus_id');
      }
      location.assign(u.toString());
    } catch (e2) {
      setErr(e2.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '12vh auto', fontFamily: 'system-ui', display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0 }}>Sign in</h1>
      <p style={{ marginTop: 0, color: '#666' }}>Enter your email and invite code to continue.</p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Email</span>
          <input required value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Invite code</span>
          <input required value={code} onChange={e => setCode(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
        {err && <div style={{ color: 'crimson' }}>{err}</div>}
      </form>
    </main>
  );
}
