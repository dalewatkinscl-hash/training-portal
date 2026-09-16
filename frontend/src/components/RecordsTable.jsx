import { useEffect, useState } from 'react';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

export default function RecordsTable({
  completions,
  emptyLabel,
  canRemove = false,
  removingId = '',
  onRemove,
}) {
  const { t, formatDate, formatStatus, formatSource } = useI18n();
  const [confirmingId, setConfirmingId] = useState('');

  useEffect(() => {
    if (confirmingId && !completions?.some((item) => item.id === confirmingId)) {
      setConfirmingId('');
    }
  }, [completions, confirmingId]);

  if (!completions?.length) {
    return (
      <div className="cl-card p-8 text-center text-cl-muted text-sm">{emptyLabel || t('records.empty')}</div>
    );
  }

  const showAction = completions.some((item) => item.assessmentUrl || item.conductAssessmentUrl || item.trainerLed);

  return (
    <div className="cl-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
              <th className="px-4 py-3 font-medium">{t('common.course')}</th>
              <th className="px-4 py-3 font-medium">{t('common.completed')}</th>
              <th className="px-4 py-3 font-medium">{t('common.expires')}</th>
              <th className="px-4 py-3 font-medium">{t('common.status')}</th>
              <th className="px-4 py-3 font-medium">{t('common.source')}</th>
              <th className="px-4 py-3 font-medium">{t('common.certificate')}</th>
              {showAction && <th className="px-4 py-3 font-medium">{t('common.action')}</th>}
              {canRemove && <th className="px-4 py-3 font-medium text-right">{t('common.remove')}</th>}
            </tr>
          </thead>
          <tbody>
            {completions.map((item) => {
              const confirming = confirmingId === item.id;
              const removing = removingId === item.id;
              return (
                <tr key={item.id} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-cl-fg">{item.courseTitle}</div>
                    {item.courseCode && (
                      <div className="text-xs text-cl-muted mt-0.5">{item.courseCode}</div>
                    )}
                    {item.courseLevel > 1 && (
                      <div className="text-xs text-cl-muted mt-0.5">{t('common.level', { level: item.courseLevel })}</div>
                    )}
                    {item.coveredByCourseTitle && (
                      <div className="text-xs text-sky-300/90 mt-0.5">
                        {item.coveredByLevel
                          ? t('common.coveredByLevel', { title: item.coveredByCourseTitle, level: item.coveredByLevel })
                          : t('common.coveredBy', { title: item.coveredByCourseTitle })}
                      </div>
                    )}
                    {item.employeeName && (
                      <div className="text-xs text-cl-muted mt-0.5">{item.employeeName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-cl-muted whitespace-nowrap">{formatDate(item.completedAt)}</td>
                  <td className="px-4 py-3 text-cl-muted whitespace-nowrap">{formatDate(item.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`cl-badge ${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-cl-muted">{formatSource(item.source)}</td>
                  <td className="px-4 py-3">
                    {item.sharePointWebUrl ? (
                      <a
                        href={item.sharePointWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cl-accent hover:text-cl-accent-bright"
                      >
                        {t('common.open')}
                      </a>
                    ) : item.certificateFileName ? (
                      <span className="text-xs text-amber-200/80">{t('table.pendingSharePoint')}</span>
                    ) : (
                      <span className="text-cl-muted">—</span>
                    )}
                  </td>
                  {showAction && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.conductAssessmentUrl ? (
                        <a
                          href={item.conductAssessmentUrl}
                          className="cl-btn-primary inline-flex text-xs px-3 py-1.5"
                        >
                          {t('action.conductAssessment')}
                        </a>
                      ) : item.assessmentUrl ? (
                        <a
                          href={item.assessmentUrl}
                          className="cl-btn-primary inline-flex text-xs px-3 py-1.5"
                        >
                          {t('action.takeAssessment')}
                        </a>
                      ) : item.trainerLed ? (
                        <span className="text-xs text-cl-muted">{t('action.trainerLed')}</span>
                      ) : (
                        <span className="text-cl-muted">—</span>
                      )}
                    </td>
                  )}
                  {canRemove && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {confirming ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            className="cl-btn-ghost text-xs"
                            disabled={removing}
                            onClick={() => setConfirmingId('')}
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            type="button"
                            className="cl-btn-ghost text-xs text-rose-300 border-rose-400/40 hover:bg-rose-500/10"
                            disabled={removing}
                            onClick={() => onRemove?.(item)}
                          >
                            {removing ? t('action.removing') : t('action.confirmRemove')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="cl-btn-ghost text-xs text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
                          disabled={Boolean(removingId)}
                          onClick={() => setConfirmingId(item.id)}
                        >
                          {t('common.remove')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
