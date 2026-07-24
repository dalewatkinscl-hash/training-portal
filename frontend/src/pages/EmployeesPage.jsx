import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEmployees } from '../lib/api';
import { statusTone } from '../lib/training';

function overallTone(status) {
  if (status === 'valid') return statusTone('completed');
  if (status === 'expired') return statusTone('expired');
  if (status === 'expiring') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'assigned') return statusTone('assigned');
  return statusTone('');
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [totals, setTotals] = useState(null);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (params = {}) => {
    const response = await fetchEmployees(params);
    if (!response.ok) throw new Error(response.error || 'Failed to load employees.');
    setEmployees(response.employees || []);
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
        if (!cancelled) setError(err.message || 'Failed to load employees.');
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
      await load({ q, department, status });
    } catch (err) {
      setError(err.message || 'Failed to load employees.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-cl-fg">Employees</h2>
          <p className="text-sm text-cl-muted mt-1">
            Browse everyone with training records. Open a person to see their full history.
          </p>
        </div>
        <Link to="/matrix" className="cl-btn-ghost">
          Open matrix view
        </Link>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['Employees', totals.employees],
            ['With expired', totals.withExpired],
            ['Expiring soon', totals.withExpiring],
          ].map(([label, value]) => (
            <div key={label} className="cl-card p-4">
              <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
              <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={applyFilters} className="cl-card p-4 grid md:grid-cols-4 gap-3">
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Search</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, department…"
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
          <span className="text-xs text-cl-muted">Status</span>
          <select className="cl-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Has expired</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="cl-btn-primary w-full" disabled={loading}>
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Valid</th>
                <th className="px-4 py-3 font-medium">Expiring</th>
                <th className="px-4 py-3 font-medium">Expired</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {!employees.length && !loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">
                    No employees found. Import the Training Matrix from Admin first.
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <tr key={employee.employeeUid} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <Link
                        to={`/employees/${encodeURIComponent(employee.employeeUid)}`}
                        className="font-medium text-cl-fg hover:text-cl-accent-bright"
                      >
                        {employee.employeeName || 'Unknown'}
                      </Link>
                      <div className="text-xs text-cl-muted mt-0.5">{employee.employeeEmail || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-cl-muted">{employee.department || '—'}</td>
                    <td className="px-4 py-3 text-cl-fg">{employee.summary?.valid ?? 0}</td>
                    <td className="px-4 py-3 text-amber-200">{employee.summary?.expiringSoon ?? 0}</td>
                    <td className="px-4 py-3 text-rose-300">{employee.summary?.expired ?? 0}</td>
                    <td className="px-4 py-3 text-cl-muted">{employee.summary?.assigned ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`cl-badge ${overallTone(employee.overallStatus)}`}>
                        {employee.overallStatus}
                      </span>
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
