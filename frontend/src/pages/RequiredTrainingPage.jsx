import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRequiredTraining, reissueCertificate } from '../lib/api';
import { formatDate, formatStatus, statusTone } from '../lib/training';

export default function RequiredTrainingPage() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [totals, setTotals] = useState(null);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = async (params = {}) => {
    const response = await fetchRequiredTraining(params);
    if (!response.ok) throw new Error(response.error || 'Failed to load required training.');
    setRows(response.rows || []);
    setDepartments(response.departments || []);
    setTotals(response.totals || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load required training.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFilters = async (event) => {
    event?.preventDefault?.();
    setLoading(true);
    setError('');
    try {
      await load({ q, department });
    } catch (err) {
      setError(err.message || 'Failed to load required training.');
    } finally {
      setLoading(false);
    }
  };

  const onReissue = async (id) => {
    setBusyId(id);
    setError('');
    try {
      const response = await reissueCertificate(id);
      if (!response.ok) throw new Error(response.error || 'Failed to reissue certificate.');
      await load({ q, department });
    } catch (err) {
      setError(err.message || 'Failed to reissue certificate.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">Required training</h2>
        <p className="text-sm text-cl-muted mt-1">
          Expired training first (most overdue at the top), then everything due in the next 30 days.
        </p>
      </div>

      {totals && (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          {[
            ['Total', totals.total],
            ['Expired', totals.expired],
            ['Expiring soon', totals.expiringSoon],
            ['Failed', totals.failed],
          ].map(([label, value]) => (
            <div key={label} className="cl-card p-4">
              <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
              <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={applyFilters} className="cl-card p-4 grid md:grid-cols-4 gap-3">
        <label className="text-sm space-y-1.5 md:col-span-2">
          <span className="text-xs text-cl-muted">Search</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Employee, course, email…"
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Department</span>
          <select className="cl-input w-full" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All</option>
            {departments.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="cl-btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </form>

      {error && <p className="text-rose-300 text-sm">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">Due / expired</th>
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Department</th>
                <th className="px-3 py-3 font-medium">Course</th>
                <th className="px-3 py-3 font-medium">Completed</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Certificate</th>
                <th className="px-3 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-cl-muted">Loading…</td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-cl-muted">
                    No expired or soon-due training found.
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <tr key={item.id} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                    <td className={`px-3 py-2.5 whitespace-nowrap font-medium ${
                      item.status === 'expired' ? 'text-rose-300' : 'text-amber-200'
                    }`}>
                      {formatDate(item.expiresAt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {item.employeeUid ? (
                        <Link
                          to={`/employees/${encodeURIComponent(item.employeeUid)}`}
                          className="text-cl-fg hover:text-cl-accent-bright font-medium"
                        >
                          {item.employeeName || '—'}
                        </Link>
                      ) : (
                        <span className="text-cl-fg">{item.employeeName || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{item.department || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-fg">{item.courseTitle || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatDate(item.completedAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.sharePointWebUrl ? (
                        <a href={item.sharePointWebUrl} target="_blank" rel="noreferrer" className="text-cl-accent">
                          Open
                        </a>
                      ) : (
                        <span className="text-cl-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-2">
                      {item.conductAssessmentUrl && (
                        <a
                          href={item.conductAssessmentUrl}
                          className="cl-btn-primary inline-flex text-xs px-3 py-1.5"
                        >
                          Conduct assessment
                        </a>
                      )}
                      <button
                        type="button"
                        className="cl-btn-ghost"
                        disabled={busyId === item.id}
                        onClick={() => onReissue(item.id)}
                      >
                        {busyId === item.id ? 'Working…' : 'Reissue'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
