import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deleteCompletion, fetchEmployee } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

export default function EmployeeDetailPage({ canRemoveCourses = false }) {
  const { t } = useI18n();
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removingId, setRemovingId] = useState('');

  const load = async () => {
    const response = await fetchEmployee(uid);
    if (!response.ok) throw new Error(response.error || 'Failed to load employee.');
    setData(response);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        setMessage('');
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

  const handleRemove = async (item) => {
    setRemovingId(item.id);
    setError('');
    setMessage('');
    try {
      const response = await deleteCompletion(item.id);
      if (!response.ok) throw new Error(response.error || 'Failed to remove course.');
      setMessage(t('employee.removed', { title: item.courseTitle || t('common.course') }));
      await load();
    } catch (err) {
      setError(err.message || 'Failed to remove course.');
    } finally {
      setRemovingId('');
    }
  };

  if (loading) return <p className="text-cl-muted text-sm">{t('employee.loading')}</p>;
  if (error && !data) return <p className="text-rose-300 text-sm">{error}</p>;

  const employee = data?.employee || {};
  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/employees" className="text-xs text-cl-muted hover:text-cl-fg">
            {t('employee.allEmployees')}
          </Link>
          <h2 className="text-xl font-semibold text-cl-fg mt-2">{employee.employeeName || t('employee.fallbackName')}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {[employee.employeeEmail, employee.department, employee.trainingFolderName]
              .filter(Boolean)
              .join(' · ') || t('employee.trainingRecord')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/log?employeeUid=${encodeURIComponent(employee.employeeUid || uid)}&employeeName=${encodeURIComponent(employee.employeeName || '')}&employeeEmail=${encodeURIComponent(employee.employeeEmail || '')}`}
            className="cl-btn-primary"
          >
            {t('nav.logCourse')}
          </Link>
          <Link
            to={`/log?mode=assign&employeeUid=${encodeURIComponent(employee.employeeUid || uid)}&employeeName=${encodeURIComponent(employee.employeeName || '')}&employeeEmail=${encodeURIComponent(employee.employeeEmail || '')}`}
            className="cl-btn-ghost"
          >
            {t('employee.assignCourse')}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          [t('stats.total'), summary.total],
          [t('stats.valid'), summary.valid],
          [t('stats.required'), summary.assigned],
          [t('stats.expiring30d'), summary.expiringSoon],
          [t('stats.expired'), summary.expired],
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
          {t('employee.openSharePoint')}
        </a>
      )}

      <div>
        <h3 className="text-sm font-semibold text-cl-fg mb-1">{t('employee.recordsTitle')}</h3>
        {canRemoveCourses && (
          <p className="text-xs text-cl-muted mb-3">
            {t('employee.removeHint')}
          </p>
        )}
        {error && <p className="text-sm text-rose-300 mb-3">{error}</p>}
        {message && <p className="text-sm text-emerald-300 mb-3">{message}</p>}
        <RecordsTable
          completions={data?.completions || []}
          canRemove={canRemoveCourses}
          removingId={removingId}
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
}
