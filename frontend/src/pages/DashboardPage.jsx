import { useEffect, useState } from 'react';
import { fetchDashboard } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { useI18n } from '../i18n/LanguageProvider';

export default function DashboardPage() {
  const { t, formatDate } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchDashboard();
        if (!response.ok) throw new Error(response.error || 'Failed to load dashboard.');
        if (!cancelled) setData(response);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-cl-muted text-sm">{t('dashboard.loading')}</p>;
  if (error) return <p className="text-rose-300 text-sm">{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('dashboard.title')}</h2>
        <p className="text-sm text-cl-muted mt-1">
          {t('dashboard.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [t('dashboard.activeCourses'), data.coursesActive],
          [t('dashboard.completions'), data.completionsTotal],
          [t('stats.expiring30d'), data.expiringSoon],
          [t('stats.expired'), data.expired],
        ].map(([label, value]) => (
          <div key={label} className="cl-card p-4">
            <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
            <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-cl-fg mb-3">{t('dashboard.recent')}</h3>
        <RecordsTable
          completions={(data.recent || []).map((item) => ({
            ...item,
            employeeName: `${item.employeeName || ''} · ${formatDate(item.completedAt)}`,
          }))}
        />
      </div>
    </div>
  );
}
