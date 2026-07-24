import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchEmployee } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { statusTone } from '../lib/training';

export default function EmployeeDetailPage() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await fetchEmployee(uid);
        if (!response.ok) throw new Error(response.error || 'Failed to load employee.');
        if (!cancelled) setData(response);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load employee.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (loading) return <p className="text-cl-muted text-sm">Loading employee records…</p>;
  if (error) return <p className="text-rose-300 text-sm">{error}</p>;

  const employee = data?.employee || {};
  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/employees" className="text-xs text-cl-muted hover:text-cl-fg">
            ← All employees
          </Link>
          <h2 className="text-xl font-semibold text-cl-fg mt-2">{employee.employeeName || 'Employee'}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {[employee.employeeEmail, employee.department, employee.trainingFolderName]
              .filter(Boolean)
              .join(' · ') || 'Training record'}
          </p>
        </div>
        <Link
          to={`/log?employeeUid=${encodeURIComponent(employee.employeeUid || uid)}&employeeName=${encodeURIComponent(employee.employeeName || '')}&employeeEmail=${encodeURIComponent(employee.employeeEmail || '')}`}
          className="cl-btn-primary"
        >
          Log completion
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Total', summary.total],
          ['Valid', summary.valid],
          ['Expiring (60d)', summary.expiringSoon],
          ['Expired', summary.expired],
        ].map(([label, value]) => (
          <div key={label} className="cl-card p-4">
            <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
            <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
          </div>
        ))}
      </div>

      {employee.trainingFolderWebUrl && (
        <a
          href={employee.trainingFolderWebUrl}
          target="_blank"
          rel="noreferrer"
          className={`cl-badge ${statusTone('completed')}`}
        >
          Open SharePoint folder
        </a>
      )}

      <div>
        <h3 className="text-sm font-semibold text-cl-fg mb-3">Training records</h3>
        <RecordsTable completions={data?.completions || []} />
      </div>
    </div>
  );
}
