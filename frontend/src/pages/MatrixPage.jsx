import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrainingMatrix } from '../lib/api';
import { formatDate, formatStatus, statusTone } from '../lib/training';

export default function MatrixPage() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [courseNames, setCourseNames] = useState([]);
  const [totals, setTotals] = useState(null);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
  const [status, setStatus] = useState('');
  const [courseType, setCourseType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (params = {}) => {
    const response = await fetchTrainingMatrix(params);
    if (!response.ok) throw new Error(response.error || 'Failed to load matrix.');
    setRows(response.rows || []);
    setDepartments(response.departments || []);
    setCourseNames(response.courseNames || []);
    setTotals(response.totals || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load matrix.');
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
      await load({ q, department, course, status, courseType });
    } catch (err) {
      setError(err.message || 'Failed to load matrix.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-none">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-cl-fg">Training matrix</h2>
          <p className="text-sm text-cl-muted mt-1">
            Flat view of all training records — same shape as the old SharePoint list.
          </p>
        </div>
        <Link to="/employees" className="cl-btn-ghost">
          Employee directory
        </Link>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['Rows', totals.rows],
            ['Employees', totals.employees],
            ['Valid', totals.valid],
            ['Expiring soon', totals.expiringSoon],
            ['Expired', totals.expired],
          ].map(([label, value]) => (
            <div key={label} className="cl-card p-4">
              <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
              <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={applyFilters} className="cl-card p-4 grid md:grid-cols-3 xl:grid-cols-6 gap-3">
        <label className="text-sm space-y-1.5 xl:col-span-2">
          <span className="text-xs text-cl-muted">Search</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Employee or course…"
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
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Course</span>
          <select className="cl-input w-full" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All</option>
            {courseNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Status</span>
          <select className="cl-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Valid</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="assigned">Required</option>
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Type</span>
          <select className="cl-input w-full" value={courseType} onChange={(e) => setCourseType(e.target.value)}>
            <option value="">All</option>
            <option value="mandatory">Mandatory</option>
            <option value="additional">Additional</option>
          </select>
        </label>
        <div className="flex items-end md:col-span-3 xl:col-span-6">
          <button type="submit" className="cl-btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Department</th>
                <th className="px-3 py-3 font-medium">Course</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Valid (months)</th>
                <th className="px-3 py-3 font-medium">Completed</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-cl-muted">
                    No training rows found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.employeeUid ? (
                        <Link
                          to={`/employees/${encodeURIComponent(row.employeeUid)}`}
                          className="text-cl-fg hover:text-cl-accent-bright font-medium"
                        >
                          {row.employeeName || '—'}
                        </Link>
                      ) : (
                        <span className="text-cl-fg">{row.employeeName || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{row.department || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-fg min-w-[180px]">{row.courseName || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-muted capitalize whitespace-nowrap">{row.courseType || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">
                      {row.validityMonths == null ? '—' : row.validityMonths}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatDate(row.completedAt)}</td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatDate(row.dueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`cl-badge ${statusTone(row.status)}`}>
                        {formatStatus(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted capitalize whitespace-nowrap">{row.source || '—'}</td>
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
