import { useEffect, useState } from 'react';
import { fetchDashboard } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { formatDate } from '../lib/training';

export default function DashboardPage() {
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

  if (loading) return <p className="text-cl-muted text-sm">Loading dashboard…</p>;
  if (error) return <p className="text-rose-300 text-sm">{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">Training dashboard</h2>
        <p className="text-sm text-cl-muted mt-1">
          Master view of courses and completions across Assessment and CPC.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Active courses', data.coursesActive],
          ['Completions', data.completionsTotal],
          ['Expiring (60d)', data.expiringSoon],
          ['Expired', data.expired],
        ].map(([label, value]) => (
          <div key={label} className="cl-card p-4">
            <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
            <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-cl-fg mb-3">Recent completions</h3>
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
