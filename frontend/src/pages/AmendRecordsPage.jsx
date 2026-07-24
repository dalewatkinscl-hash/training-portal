import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCompletions, updateCompletion } from '../lib/api';
import { formatDate, formatStatus, statusTone } from '../lib/training';

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function AmendRecordsPage() {
  const [completions, setCompletions] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ completedAt: '', expiresAt: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = async (params = {}) => {
    const response = await fetchCompletions({ scope: 'all', ...params });
    if (!response.ok) throw new Error(response.error || 'Failed to load records.');
    const rows = [...(response.completions || [])].sort((a, b) =>
      String(a.employeeName || '').localeCompare(String(b.employeeName || ''))
      || String(a.courseTitle || '').localeCompare(String(b.courseTitle || '')),
    );
    setCompletions(rows);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load records.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const search = async (event) => {
    event?.preventDefault?.();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await load({ q });
    } catch (err) {
      setError(err.message || 'Failed to load records.');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraft({
      completedAt: toDateInput(item.completedAt),
      expiresAt: toDateInput(item.expiresAt),
      notes: item.notes || '',
    });
    setMessage('');
    setError('');
  };

  const cancelEdit = () => {
    setEditingId('');
    setDraft({ completedAt: '', expiresAt: '', notes: '' });
  };

  const saveEdit = async (item) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await updateCompletion(item.id, {
        completedAt: draft.completedAt || null,
        expiresAt: draft.expiresAt || null,
        notes: draft.notes,
      });
      if (!response.ok) throw new Error(response.error || 'Failed to save changes.');
      setMessage(`Updated ${item.employeeName || 'record'} · ${item.courseTitle || 'course'}.`);
      cancelEdit();
      await load({ q });
    } catch (err) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/admin" className="text-xs text-cl-muted hover:text-cl-fg">
            ← Admin
          </Link>
          <h2 className="text-xl font-semibold text-cl-fg mt-2">Amend training dates</h2>
          <p className="text-sm text-cl-muted mt-1">
            Correct completion and expiry dates. Status updates automatically from the new dates.
          </p>
        </div>
      </div>

      <form onSubmit={search} className="cl-card p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm space-y-1.5 flex-1 min-w-[220px]">
          <span className="text-xs text-cl-muted">Search employee or course</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, course…"
          />
        </label>
        <button type="submit" className="cl-btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Course</th>
                <th className="px-3 py-3 font-medium">Completed</th>
                <th className="px-3 py-3 font-medium">Expires</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Notes</th>
                <th className="px-3 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading && !completions.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">Loading…</td>
                </tr>
              ) : !completions.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">No records found.</td>
                </tr>
              ) : (
                completions.map((item) => {
                  const editing = editingId === item.id;
                  return (
                    <tr key={item.id} className="border-b border-cl-border/60 last:border-0 align-top">
                      <td className="px-3 py-2.5 whitespace-nowrap text-cl-fg font-medium">
                        {item.employeeName || '—'}
                        {item.employeeEmail && (
                          <div className="text-xs text-cl-muted font-normal">{item.employeeEmail}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-cl-fg">{item.courseTitle || '—'}</td>
                      <td className="px-3 py-2.5">
                        {editing ? (
                          <input
                            type="date"
                            className="cl-input"
                            value={draft.completedAt}
                            onChange={(e) => setDraft((prev) => ({ ...prev, completedAt: e.target.value }))}
                          />
                        ) : (
                          <span className="text-cl-muted whitespace-nowrap">{formatDate(item.completedAt)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editing ? (
                          <input
                            type="date"
                            className="cl-input"
                            value={draft.expiresAt}
                            onChange={(e) => setDraft((prev) => ({ ...prev, expiresAt: e.target.value }))}
                          />
                        ) : (
                          <span className="text-cl-muted whitespace-nowrap">{formatDate(item.expiresAt)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                      </td>
                      <td className="px-3 py-2.5 min-w-[180px]">
                        {editing ? (
                          <input
                            className="cl-input w-full"
                            value={draft.notes}
                            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                            placeholder="Optional note"
                          />
                        ) : (
                          <span className="text-cl-muted text-xs">{item.notes || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {editing ? (
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              className="cl-btn-ghost"
                              disabled={saving}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="cl-btn-primary"
                              disabled={saving}
                              onClick={() => saveEdit(item)}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="cl-btn-ghost" onClick={() => startEdit(item)}>
                            Amend
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
