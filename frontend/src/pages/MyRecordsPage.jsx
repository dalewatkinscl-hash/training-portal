import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, GraduationCap } from 'lucide-react';
import { fetchMyRecords } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { formatDate, formatStatus, statusTone } from '../lib/training';

function Stat({ icon: Icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'text-cl-fg',
    good: 'text-emerald-300',
    warn: 'text-amber-200',
    bad: 'text-rose-300',
  };
  return (
    <div className="cl-card p-4">
      <div className="flex items-center gap-2 text-cl-muted text-xs uppercase tracking-wider mb-2">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function MyRecordsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await fetchMyRecords();
        if (!response.ok) throw new Error(response.error || 'Failed to load records.');
        if (!cancelled) setData(response);
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

  const renewals = useMemo(
    () => (data?.completions || []).filter((item) => item.assessmentUrl),
    [data],
  );
  const conductRenewals = useMemo(
    () => (data?.completions || []).filter((item) => item.conductAssessmentUrl),
    [data],
  );
  const trainerLedRenewals = useMemo(
    () => (data?.completions || []).filter(
      (item) => item.trainerLed && !item.assessmentUrl && !item.conductAssessmentUrl,
    ),
    [data],
  );

  if (loading) {
    return <p className="text-cl-muted text-sm">Loading your training profile…</p>;
  }

  if (error) {
    return <p className="text-rose-300 text-sm">{error}</p>;
  }

  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">My training records</h2>
        <p className="text-sm text-cl-muted mt-1">
          Your completions, expiries, and certificates from Assessment, CPC, and manual training.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={GraduationCap} label="Total" value={summary.total ?? 0} />
        <Stat icon={CheckCircle2} label="Valid" value={summary.valid ?? 0} tone="good" />
        <Stat icon={Clock3} label="Expiring (30d)" value={summary.expiringSoon ?? 0} tone="warn" />
        <Stat icon={AlertTriangle} label="Expired" value={summary.expired ?? 0} tone="bad" />
      </div>

      {conductRenewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">Conduct trainer-led assessments</h3>
            <p className="text-sm text-cl-muted mt-1">
              These courses are expired or expiring soon and can be renewed by conducting the linked assessment.
            </p>
          </div>
          <ul className="space-y-2">
            {conductRenewals.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cl-border bg-black/20 px-3 py-3"
              >
                <div>
                  <div className="font-medium text-cl-fg">{item.courseTitle}</div>
                  <div className="text-xs text-cl-muted mt-0.5 flex flex-wrap gap-2 items-center">
                    <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                    <span>Due {formatDate(item.expiresAt)}</span>
                    {item.assessmentQuizTitle && (
                      <span>Assessment: {item.assessmentQuizTitle}</span>
                    )}
                  </div>
                </div>
                <a href={item.conductAssessmentUrl} className="cl-btn-primary">
                  Conduct assessment
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trainerLedRenewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">Trainer-led renewals</h3>
            <p className="text-sm text-cl-muted mt-1">
              These courses are expired or expiring soon and must be renewed with a trainer.
            </p>
          </div>
          <ul className="space-y-2">
            {trainerLedRenewals.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cl-border bg-black/20 px-3 py-3"
              >
                <div>
                  <div className="font-medium text-cl-fg">{item.courseTitle}</div>
                  <div className="text-xs text-cl-muted mt-0.5 flex flex-wrap gap-2 items-center">
                    <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                    <span>Due {formatDate(item.expiresAt)}</span>
                    {item.assessmentQuizTitle && (
                      <span>Assessment: {item.assessmentQuizTitle}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-cl-muted">Ask your trainer to conduct this</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">Renew via assessment</h3>
            <p className="text-sm text-cl-muted mt-1">
              These courses are expired or expiring soon. Take the linked assessment to update your record —
              no separate assignment needed.
            </p>
          </div>
          <ul className="space-y-2">
            {renewals.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cl-border bg-black/20 px-3 py-3"
              >
                <div>
                  <div className="font-medium text-cl-fg">{item.courseTitle}</div>
                  <div className="text-xs text-cl-muted mt-0.5 flex flex-wrap gap-2 items-center">
                    <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                    <span>Due {formatDate(item.expiresAt)}</span>
                    {item.assessmentQuizTitle && (
                      <span>Assessment: {item.assessmentQuizTitle}</span>
                    )}
                  </div>
                </div>
                <a href={item.assessmentUrl} className="cl-btn-primary">
                  Take assessment
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecordsTable completions={data?.completions || []} />
    </div>
  );
}
