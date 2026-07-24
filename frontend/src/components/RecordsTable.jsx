import { formatDate, formatStatus, statusTone } from '../lib/training';

export default function RecordsTable({ completions, emptyLabel = 'No training records yet.' }) {
  if (!completions?.length) {
    return (
      <div className="cl-card p-8 text-center text-cl-muted text-sm">{emptyLabel}</div>
    );
  }

  const showAction = completions.some((item) => item.assessmentUrl);

  return (
    <div className="cl-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Completed</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Certificate</th>
              {showAction && <th className="px-4 py-3 font-medium">Action</th>}
            </tr>
          </thead>
          <tbody>
            {completions.map((item) => (
              <tr key={item.id} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="font-medium text-cl-fg">{item.courseTitle}</div>
                  {item.courseCode && (
                    <div className="text-xs text-cl-muted mt-0.5">{item.courseCode}</div>
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
                <td className="px-4 py-3 text-cl-muted capitalize">{item.source}</td>
                <td className="px-4 py-3">
                  {item.sharePointWebUrl ? (
                    <a
                      href={item.sharePointWebUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cl-accent hover:text-cl-accent-bright"
                    >
                      Open
                    </a>
                  ) : item.certificateFileName ? (
                    <span className="text-xs text-amber-200/80">Pending SharePoint</span>
                  ) : (
                    <span className="text-cl-muted">—</span>
                  )}
                </td>
                {showAction && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {item.assessmentUrl ? (
                      <a
                        href={item.assessmentUrl}
                        className="cl-btn-primary inline-flex text-xs px-3 py-1.5"
                      >
                        Take assessment
                      </a>
                    ) : (
                      <span className="text-cl-muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
