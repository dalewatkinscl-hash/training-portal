import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, GraduationCap } from 'lucide-react';
import { fetchMyRecords } from '../lib/api';
import RecordsTable from '../components/RecordsTable';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

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
  const { t, formatDate, formatStatus } = useI18n();
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
    return <p className="text-cl-muted text-sm">{t('myRecords.loading')}</p>;
  }

  if (error) {
    return <p className="text-rose-300 text-sm">{error}</p>;
  }

  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('myRecords.title')}</h2>
        <p className="text-sm text-cl-muted mt-1">
          {t('myRecords.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={GraduationCap} label={t('stats.total')} value={summary.total ?? 0} />
        <Stat icon={CheckCircle2} label={t('stats.valid')} value={summary.valid ?? 0} tone="good" />
        <Stat icon={Clock3} label={t('stats.expiring30d')} value={summary.expiringSoon ?? 0} tone="warn" />
        <Stat icon={AlertTriangle} label={t('stats.expired')} value={summary.expired ?? 0} tone="bad" />
      </div>

      {conductRenewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">{t('myRecords.conductTitle')}</h3>
            <p className="text-sm text-cl-muted mt-1">
              {t('myRecords.conductBody')}
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
                    <span>{t('myRecords.dueOn', { date: formatDate(item.expiresAt) })}</span>
                    {item.assessmentQuizTitle && (
                      <span>{t('myRecords.assessment', { title: item.assessmentQuizTitle })}</span>
                    )}
                  </div>
                </div>
                <a href={item.conductAssessmentUrl} className="cl-btn-primary">
                  {t('action.conductAssessment')}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trainerLedRenewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">{t('myRecords.trainerLedTitle')}</h3>
            <p className="text-sm text-cl-muted mt-1">
              {t('myRecords.trainerLedBody')}
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
                    <span>{t('myRecords.dueOn', { date: formatDate(item.expiresAt) })}</span>
                    {item.assessmentQuizTitle && (
                      <span>{t('myRecords.assessment', { title: item.assessmentQuizTitle })}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-cl-muted">{t('myRecords.askTrainer')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renewals.length > 0 && (
        <section className="cl-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">{t('myRecords.renewTitle')}</h3>
            <p className="text-sm text-cl-muted mt-1">
              {t('myRecords.renewBody')}
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
                    <span>{t('myRecords.dueOn', { date: formatDate(item.expiresAt) })}</span>
                    {item.assessmentQuizTitle && (
                      <span>{t('myRecords.assessment', { title: item.assessmentQuizTitle })}</span>
                    )}
                  </div>
                </div>
                <a href={item.assessmentUrl} className="cl-btn-primary">
                  {t('action.takeAssessment')}
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
