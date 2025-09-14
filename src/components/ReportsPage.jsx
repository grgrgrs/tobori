import React, { useEffect, useMemo, useState } from "react";
import CreateBriefModal from "../components/CreateBriefModal.jsx";

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

export default function ReportsPage({ corpusOptions = [] }) {
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // brief to edit
  const [busyId, setBusyId] = useState(null);

  async function openEdit(briefRow) {
    try {
      const r = await fetch(`/api/briefs/${briefRow.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load brief");
      const detail = await r.json(); // includes prompt_template
      setEditing(detail);
    } catch (e) {
      alert("Could not load brief for edit.");
    }
  }

  async function load() {
    setLoading(true);
    try {
      const resp = await fetch("/api/briefs?mine=1", { credentials: "include" });
      const data = await resp.json();
      setBriefs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runNow(id) {
    setBusyId(id);
    try {
      await fetch(`/api/briefs/${id}/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // today ET
      });
      await load();
    } catch (e) {
      alert("Run failed");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHome(brief, checked) {
    setBusyId(brief.id);
    try {
      const resp = await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_on_home: !!checked }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await load();
    } catch (e) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function updateHomeOrder(brief, value) {
    const v = Number.isFinite(Number(value)) ? Number(value) : 0;
    setBusyId(brief.id);
    try {
      const resp = await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home_order: v }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      // no need to reload every keystroke; but simplest is to reload
      await load();
    } catch (e) {
      alert(`Order update failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }


  async function toggleVisibility(brief) {
    const next = brief.visibility === "public" ? "private" : "public";
    setBusyId(brief.id);
    try {
      await fetch(`/api/briefs/${brief.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function copyPublicLink(brief) {
    // needs latest run id; fetch latest
    const r = await fetch(`/api/briefs/${brief.id}/runs/latest`, {
      credentials: "include",
    });
    if (!r.ok) {
      alert("No runs yet."); return;
    }
    const data = await r.json();
    const url = `${location.origin}/r/${data.id}`;
    await navigator.clipboard.writeText(url);
    alert("Link copied");
  }

  const hasBriefs = briefs.length > 0;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Create Brief
        </button>
      </div>

      {loading ? (
        <p className="text-gray-600">Loading…</p>
      ) : !hasBriefs ? (
        <div className="rounded-lg border p-6 text-gray-700">
          <p className="mb-3">
            No briefs yet. Create your first daily/weekly/monthly brief.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            Create Brief
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border">
            <thead className="bg-gray-50">
              <tr className="text-left text-sm">
                <th className="border-b px-3 py-2">Title</th>
                <th className="border-b px-3 py-2">Corpus</th>
                <th className="border-b px-3 py-2">Window</th>
                <th className="border-b px-3 py-2">Visibility</th>
                <th className="border-b px-3 py-2">Last Run</th>
                <th className="border-b px-3 py-2">Set as Home</th>
                <th className="border-b px-3 py-2">Order</th>
                <th className="border-b px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.id} className="text-sm">
                  <td className="border-b px-3 py-2">
                    <a href={`/report?id=${b.id}`} className="text-blue-600 hover:underline">
                      {b.title}
                    </a>
                  </td>
                  <td className="border-b px-3 py-2">{b.corpus_id}</td>
                  <td className="border-b px-3 py-2 uppercase">{b.window}</td>
                  <td className="border-b px-3 py-2">
                    <button
                      onClick={() => toggleVisibility(b)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                      disabled={busyId === b.id}
                      title="Toggle visibility"
                    >
                      {b.visibility}
                    </button>
                  </td>
                  <td className="border-b px-3 py-2">{fmtDate(b.last_run_at)}</td>


                  <td className="border-b px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!b.show_on_home}
                      onChange={(e) => toggleHome(b, e.target.checked)}
                      disabled={busyId === b.id}
                    />
                  </td>

                  <td className="border-b px-3 py-2" style={{ width: 80 }}>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={b.home_order ?? 0}
                      onChange={(e) => updateHomeOrder(b, e.target.value)}
                      className="w-16 rounded border px-2 py-1"
                      disabled={busyId === b.id}
                    />
                  </td>

                  
                  <td className="border-b px-3 py-2">
                    <div className="flex flex-wrap gap-2">

                      <a
                        href={`/report?id=${b.id}`}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Open
                      </a>

                      <button
                        onClick={() => openEdit(b)}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => runNow(b.id)}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                        disabled={busyId === b.id}
                      >
                        {busyId === b.id ? "Running…" : "Run now"}
                      </button>

                      <button
                        onClick={() => copyPublicLink(b)}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                        title={b.visibility === "public" ? "Copy public link" : "Set to public to share"}
                        disabled={b.visibility !== "public"}
                      >
                        Get link
                      </button>
                    </div>
                  </td>






                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateBriefModal
        open={creating}
        mode="create"
        corpusOptions={corpusOptions}
        onClose={() => setCreating(false)}
        onSaved={() => load()}
      />

      {editing && (
        <CreateBriefModal
          open={true}
          mode="edit"
          initial={editing}
          corpusOptions={corpusOptions}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
