import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEmployees } from '../lib/api';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

function overallTone(status) {
  if (status === 'valid') return statusTone('completed');
  if (status === 'expired') return statusTone('expired');
  if (status === 'expiring') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'assigned') return statusTone('assigned');
  return statusTone('');
}

export default function EmployeesPage() {
  const { t, formatStatus } = useI18n();
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
          <h2 className="text-xl font-semibold text-cl-fg">{t('employees.title')}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {t('employees.subtitle')}
          </p>
        </div>
        <Link to="/matrix" className="cl-btn-ghost">
          {t('employees.openMatrix')}
        </Link>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            [t('employees.count'), totals.employees],
            [t('employees.withExpired'), totals.withExpired],
            [t('stats.expiringSoon'), totals.withExpiring],
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
          <span className="text-xs text-cl-muted">{t('common.search')}</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('employees.searchPlaceholder')}
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.department')}</span>
          <select className="cl-input w-full" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {departments.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.status')}</span>
          <select className="cl-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="valid">{t('status.valid')}</option>
            <option value="expiring">{t('status.expiringSoon')}</option>
            <option value="expired">{t('status.hasExpired')}</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="cl-btn-primary w-full" disabled={loading}>
            {loading ? t('common.loading') : t('common.applyFilters')}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-4 py-3 font-medium">{t('common.employee')}</th>
                <th className="px-4 py-3 font-medium">{t('common.department')}</th>
                <th className="px-4 py-3 font-medium">{t('status.valid')}</th>
                <th className="px-4 py-3 font-medium">{t('employees.expiring')}</th>
                <th className="px-4 py-3 font-medium">{t('employees.expired')}</th>
                <th className="px-4 py-3 font-medium">{t('employees.required')}</th>
                <th className="px-4 py-3 font-medium">{t('employees.overall')}</th>
              </tr>
            </thead>
            <tbody>
              {!employees.length && !loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-cl-muted">
                    {t('employees.empty')}
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
                        {employee.employeeName || t('common.unknown')}
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
                        {formatStatus(employee.overallStatus)}
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
