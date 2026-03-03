// src/components/AdminUsers.jsx
import React, { useState, useEffect, useCallback } from 'react';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { text, ok }
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    const r = await fetch('/api/admin/users', { credentials: 'include' });
    if (r.status === 403) { setDenied(true); setLoading(false); return; }
    const data = await r.json();
    setUsers(data.users || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleAdd(e) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || r.status);
      setMsg({ text: `Added ${data.email} — they can now log in.`, ok: true });
      setEmail('');
      await loadUsers();
    } catch (err) {
      setMsg({ text: err.message || 'Error adding user', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(accountId, userEmail) {
    if (!confirm(`Remove ${userEmail}? They will lose access immediately.`)) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${accountId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.detail || r.status);
      }
      setMsg({ text: `Removed ${userEmail}.`, ok: true });
      await loadUsers();
    } catch (err) {
      setMsg({ text: err.message || 'Error removing user', ok: false });
    }
  }

  if (denied) {
    return (
      <div style={{ maxWidth: 700, margin: '4rem auto', fontFamily: 'system-ui' }}>
        <p style={{ color: 'crimson' }}>Access denied. Admin account required.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h2 style={{ marginTop: 0 }}>User Management</h2>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <label style={{ display: 'grid', gap: 4, flexGrow: 1 }}>
          <span style={{ fontSize: '0.9rem' }}>Email address</span>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
            style={{ fontSize: '1rem', padding: '0.5rem 0.6rem', border: '1px solid #ccc', borderRadius: 4 }}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{ fontSize: '1rem', padding: '0.5rem 1rem', cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Adding…' : 'Add User'}
        </button>
      </form>

      {msg && (
        <p style={{ color: msg.ok ? '#2a7a2a' : 'crimson', marginBottom: '1rem' }}>{msg.text}</p>
      )}

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : users.length === 0 ? (
        <p style={{ color: '#888' }}>No users yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.75rem' }}>Email</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Corpora</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Added</th>
              <th style={{ padding: '0.5rem 0.75rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.account_id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem 0.75rem' }}>{u.email}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: '#555' }}>
                  {u.corpora.length > 0 ? u.corpora.join(', ') : <em>none</em>}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', color: '#888', whiteSpace: 'nowrap' }}>
                  {u.created_at ? u.created_at.slice(0, 10) : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <button
                    onClick={() => handleRemove(u.account_id, u.email)}
                    style={{ fontSize: '0.85rem', color: 'crimson', background: 'none', border: '1px solid crimson', borderRadius: 3, padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
