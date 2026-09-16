import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteCompletion, fetchCompletions, updateCompletion } from '../lib/api';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function AmendRecordsPage() {
  const { t, formatDate, formatStatus } = useI18n();
  const [completions, setCompletions] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ completedAt: '', expiresAt: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [confirmingId, setConfirmingId] = useState('');

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
      completedAt: toDateInput(item.nativeCompletedAt || item.completedAt),
      expiresAt: toDateInput(item.nativeExpiresAt || item.expiresAt),
      notes: item.notes || '',
    });
    setMessage('');
    setError('');
    setConfirmingId('');
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
      setMessage(t('amend.updated', { name: item.employeeName || t('common.employee'), course: item.courseTitle || t('common.course') }));
      cancelEdit();
      await load({ q });
    } catch (err) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (item) => {
    setRemovingId(item.id);
    setError('');
    setMessage('');
    try {
      const response = await deleteCompletion(item.id);
      if (!response.ok) throw new Error(response.error || 'Failed to remove course.');
      setMessage(t('amend.removed', { course: item.courseTitle || t('common.course'), name: item.employeeName || t('common.employee') }));
      setConfirmingId('');
      await load({ q });
    } catch (err) {
      setError(err.message || 'Failed to remove course.');
    } finally {
      setRemovingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/admin" className="text-xs text-cl-muted hover:text-cl-fg">
            {t('amend.backAdmin')}
          </Link>
          <h2 className="text-xl font-semibold text-cl-fg mt-2">{t('amend.title')}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {t('amend.subtitle')}
          </p>
        </div>
      </div>

      <form onSubmit={search} className="cl-card p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm space-y-1.5 flex-1 min-w-[220px]">
          <span className="text-xs text-cl-muted">{t('amend.searchLabel')}</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('amend.searchPlaceholder')}
          />
        </label>
        <button type="submit" className="cl-btn-primary" disabled={loading}>
          {loading ? t('amend.searching') : t('amend.search')}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">{t('common.employee')}</th>
                <th className="px-3 py-3 font-medium">{t('common.course')}</th>
                <th className="px-3 py-3 font-medium">{t('common.completed')}</th>
                <th className="px-3 py-3 font-medium">{t('common.expires')}</th>
                <th className="px-3 py-3 font-medium">{t('common.status')}</th>
                <th className="px-3 py-3 font-medium">{t('common.notes')}</th>
                <th className="px-3 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading && !completions.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">{t('common.loading')}</td>
                </tr>
              ) : !completions.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">{t('amend.empty')}</td>
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
                      <td className="px-3 py-2.5 text-cl-fg">
                        {item.courseTitle || '—'}
                        {item.courseLevel > 1 && (
                          <div className="text-xs text-cl-muted font-normal">{t('common.level', { level: item.courseLevel })}</div>
                        )}
                        {item.coveredByCourseTitle && (
                          <div className="text-xs text-sky-300/90 font-normal">
                            {t('common.coveredBy', { title: item.coveredByCourseTitle })}
                          </div>
                        )}
                      </td>
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
                            placeholder={t('amend.optionalNote')}
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
                              {t('common.cancel')}
                            </button>
                            <button
                              type="button"
                              className="cl-btn-primary"
                              disabled={saving}
                              onClick={() => saveEdit(item)}
                            >
                              {saving ? t('common.saving') : t('common.save')}
                            </button>
                          </div>
                        ) : (
                          confirmingId === item.id ? (
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                className="cl-btn-ghost"
                                disabled={Boolean(removingId)}
                                onClick={() => setConfirmingId('')}
                              >
                                {t('common.cancel')}
                              </button>
                              <button
                                type="button"
                                className="cl-btn-ghost text-rose-300 border-rose-400/40 hover:bg-rose-500/10"
                                disabled={Boolean(removingId)}
                                onClick={() => removeRecord(item)}
                              >
                                {removingId === item.id ? t('action.removing') : t('action.confirmRemove')}
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2 justify-end">
                              <button type="button" className="cl-btn-ghost" onClick={() => startEdit(item)}>
                                {t('amend.amend')}
                              </button>
                              <button
                                type="button"
                                className="cl-btn-ghost text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
                                disabled={Boolean(removingId) || Boolean(editingId)}
                                onClick={() => {
                                  setConfirmingId(item.id);
                                  setError('');
                                  setMessage('');
                                }}
                              >
                                {t('common.remove')}
                              </button>
                            </div>
                          )
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
