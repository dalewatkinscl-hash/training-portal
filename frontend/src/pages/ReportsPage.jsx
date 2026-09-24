import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCourseCompletionReport, fetchCourses } from '../lib/api';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

function ReportTable({
  rows,
  emptyLabel,
  showDates = true,
  formatDate,
  formatStatus,
  t,
}) {
  if (!rows.length) {
    return (
      <div className="cl-card p-8 text-center text-cl-muted text-sm">{emptyLabel}</div>
    );
  }

  return (
    <div className="cl-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
              <th className="px-4 py-3 font-medium">{t('common.employee')}</th>
              <th className="px-4 py-3 font-medium">{t('common.department')}</th>
              <th className="px-4 py-3 font-medium">{t('common.status')}</th>
              {showDates && <th className="px-4 py-3 font-medium">{t('common.completed')}</th>}
              {showDates && <th className="px-4 py-3 font-medium">{t('common.expires')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeUid} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  {row.employeeUid ? (
                    <Link
                      to={`/employees/${encodeURIComponent(row.employeeUid)}`}
                      className="font-medium text-cl-fg hover:text-cl-accent-bright"
                    >
                      {row.employeeName || t('common.unnamed')}
                    </Link>
                  ) : (
                    <span className="font-medium text-cl-fg">{row.employeeName || t('common.unnamed')}</span>
                  )}
                  {row.employeeEmail && (
                    <div className="text-xs text-cl-muted mt-0.5">{row.employeeEmail}</div>
                  )}
                  {row.coveredByCourseTitle && (
                    <div className="text-xs text-sky-300/90 mt-0.5">
                      {row.coveredByLevel
                        ? t('common.coveredByLevel', {
                            title: row.coveredByCourseTitle,
                            level: row.coveredByLevel,
                          })
                        : t('common.coveredBy', { title: row.coveredByCourseTitle })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-cl-muted whitespace-nowrap">{row.department || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`cl-badge ${statusTone(row.status === 'missing' ? '' : row.status)}`}>
                    {row.status === 'missing' ? t('reports.notTaken') : formatStatus(row.status)}
                  </span>
                </td>
                {showDates && (
                  <td className="px-4 py-3 text-cl-muted whitespace-nowrap">{formatDate(row.completedAt)}</td>
                )}
                {showDates && (
                  <td className="px-4 py-3 text-cl-muted whitespace-nowrap">{formatDate(row.expiresAt)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function employeeCellLabel(row, t) {
  const name = row.employeeName || t('common.unnamed');
  const parts = [name];
  if (row.employeeEmail) parts.push(row.employeeEmail);
  if (row.coveredByCourseTitle) {
    parts.push(
      row.coveredByLevel
        ? t('common.coveredByLevel', {
            title: row.coveredByCourseTitle,
            level: row.coveredByLevel,
          })
        : t('common.coveredBy', { title: row.coveredByCourseTitle }),
    );
  }
  return parts.join('\n');
}

export default function ReportsPage() {
  const { t, locale, formatDate, formatStatus } = useI18n();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [department, setDepartment] = useState('');
  const [q, setQ] = useState('');
  const [departments, setDepartments] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [totals, setTotals] = useState(null);
  const [course, setCourse] = useState(null);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [printBusy, setPrintBusy] = useState('');
  const [excelBusy, setExcelBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingCourses(true);
        const response = await fetchCourses();
        if (!response.ok) throw new Error(response.error || 'Failed to load courses.');
        if (cancelled) return;
        const list = (response.courses || [])
          .filter((item) => item.active !== false)
          .sort((a, b) =>
            String(a.title || '').localeCompare(String(b.title || ''), locale, { sensitivity: 'base' }),
          );
        setCourses(list);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load courses.');
      } finally {
        if (!cancelled) setLoadingCourses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const loadReport = async (params = {}) => {
    const selectedCourseId = params.courseId ?? courseId;
    if (!selectedCourseId) {
      setCompleted([]);
      setOutstanding([]);
      setTotals(null);
      setCourse(null);
      return;
    }
    const response = await fetchCourseCompletionReport({
      courseId: selectedCourseId,
      department: params.department ?? department,
      q: params.q ?? q,
    });
    if (!response.ok) throw new Error(response.error || 'Failed to load report.');
    setCourse(response.course || null);
    setCompleted(response.completed || []);
    setOutstanding(response.outstanding || []);
    setDepartments(response.departments || []);
    setTotals(response.totals || null);
  };

  useEffect(() => {
    if (!courseId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        await loadReport({ courseId });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load report.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Initial load when course changes; filters applied via form submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const applyFilters = async (event) => {
    event?.preventDefault?.();
    if (!courseId) {
      setError(t('reports.selectCourseError'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await loadReport();
    } catch (err) {
      setError(err.message || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  };

  const selectedCourseLabel = useMemo(() => {
    if (course?.title) return course.title;
    return courses.find((item) => item.id === courseId)?.title || '';
  }, [course, courses, courseId]);

  const statusLabel = (status) => (
    status === 'missing' ? t('reports.notTaken') : formatStatus(status)
  );

  const buildSectionPdf = async (section) => {
    const rows = section === 'completed' ? completed : outstanding;
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const exportedAt = new Date();
    const sectionTitle = section === 'completed'
      ? t('reports.completedTitle', { count: rows.length })
      : t('reports.outstandingTitle', { count: rows.length });
    const activeFilters = [
      department && t('reports.pdfDepartment', { department }),
      q && t('reports.pdfSearch', { q }),
    ].filter(Boolean);

    doc.setFontSize(16);
    doc.text(t('reports.title'), 40, 36);
    doc.setFontSize(12);
    doc.setTextColor(40, 44, 52);
    doc.text(selectedCourseLabel || t('common.course'), 40, 56, { maxWidth: 740 });
    if (Number(course?.level) > 1) {
      doc.setFontSize(10);
      doc.setTextColor(90, 96, 110);
      doc.text(t('common.level', { level: course.level }), 40, 72);
    }
    doc.setFontSize(11);
    doc.setTextColor(40, 44, 52);
    doc.text(sectionTitle, 40, Number(course?.level) > 1 ? 90 : 76);
    doc.setFontSize(9);
    doc.setTextColor(90, 96, 110);
    let metaY = Number(course?.level) > 1 ? 106 : 92;
    doc.text(t('reports.pdfExported', { when: exportedAt.toLocaleString(locale) }), 40, metaY);
    metaY += 14;
    if (activeFilters.length) {
      doc.text(t('reports.pdfFilters', { filters: activeFilters.join(' | ') }), 40, metaY, { maxWidth: 740 });
      metaY += 14;
    }

    autoTable(doc, {
      startY: metaY + 8,
      head: [[
        t('common.employee'),
        t('common.department'),
        t('common.status'),
        t('common.completed'),
        t('common.expires'),
      ]],
      body: rows.map((row) => [
        employeeCellLabel(row, t),
        row.department || '—',
        statusLabel(row.status),
        formatDate(row.completedAt),
        formatDate(row.expiresAt),
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 5,
        overflow: 'linebreak',
        lineColor: [223, 229, 239],
        lineWidth: 0.5,
        valign: 'top',
      },
      headStyles: {
        fillColor: [31, 41, 55],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 220 },
        1: { cellWidth: 120 },
        2: { cellWidth: 100 },
        3: { cellWidth: 100 },
        4: { cellWidth: 100 },
      },
      margin: { left: 24, right: 24, bottom: 24 },
    });

    return { doc, exportedAt, rows };
  };

  const printSection = async (section) => {
    const rows = section === 'completed' ? completed : outstanding;
    if (!rows.length || printBusy || excelBusy) return;

    setPrintBusy(section);
    setError('');
    try {
      const { doc } = await buildSectionPdf(section);
      doc.autoPrint();
      const blobUrl = doc.output('bloburl');
      const printWindow = window.open(blobUrl, '_blank');
      if (!printWindow) {
        throw new Error(t('reports.popupBlocked'));
      }
    } catch (err) {
      setError(err.message || t('reports.printFailed'));
    } finally {
      setPrintBusy('');
    }
  };

  const exportSectionExcel = async (section) => {
    const rows = section === 'completed' ? completed : outstanding;
    if (!rows.length || printBusy || excelBusy) return;

    setExcelBusy(section);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const sectionLabel = section === 'completed'
        ? t('reports.completedCount')
        : t('reports.outstandingCount');
      const sheetRows = rows.map((row) => ({
        [t('common.employee')]: row.employeeName || t('common.unnamed'),
        [t('common.email')]: row.employeeEmail || '',
        [t('common.department')]: row.department || '',
        [t('common.status')]: statusLabel(row.status),
        [t('common.completed')]: formatDate(row.completedAt),
        [t('common.expires')]: formatDate(row.expiresAt),
        [t('reports.excelCoveredBy')]: row.coveredByCourseTitle
          ? (row.coveredByLevel
            ? t('common.coveredByLevel', {
                title: row.coveredByCourseTitle,
                level: row.coveredByLevel,
              })
            : t('common.coveredBy', { title: row.coveredByCourseTitle }))
          : '',
        [t('common.course')]: selectedCourseLabel || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(
        sheetRows.length
          ? sheetRows
          : [{
              [t('common.employee')]: '',
              [t('common.email')]: '',
              [t('common.department')]: '',
              [t('common.status')]: '',
              [t('common.completed')]: '',
              [t('common.expires')]: '',
              [t('reports.excelCoveredBy')]: '',
              [t('common.course')]: selectedCourseLabel || '',
            }],
      );
      worksheet['!cols'] = [
        { wch: 28 },
        { wch: 32 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 36 },
        { wch: 32 },
      ];

      const workbook = XLSX.utils.book_new();
      const sheetName = sectionLabel.slice(0, 31) || 'Report';
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      const safeCourse = String(selectedCourseLabel || 'course')
        .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40) || 'course';
      const fileDate = new Date().toISOString().slice(0, 10);
      const sectionSlug = section === 'completed' ? 'completed' : 'not-completed';
      XLSX.writeFile(workbook, `${safeCourse}-${sectionSlug}-${fileDate}.xlsx`);
    } catch (err) {
      setError(err.message || t('reports.excelFailed'));
    } finally {
      setExcelBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('reports.title')}</h2>
        <p className="text-sm text-cl-muted mt-1">{t('reports.subtitle')}</p>
      </div>

      <form onSubmit={applyFilters} className="cl-card p-4 grid md:grid-cols-4 gap-3">
        <label className="text-sm space-y-1.5 md:col-span-2">
          <span className="text-xs text-cl-muted">{t('common.course')}</span>
          <select
            className="cl-input w-full"
            value={courseId}
            disabled={loadingCourses}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">{t('reports.selectCourse')}</option>
            {courses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {item.code ? ` (${item.code})` : ''}
                {Number(item.level) > 1 ? ` · ${t('common.level', { level: item.level })}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.department')}</span>
          <select
            className="cl-input w-full"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={!courseId}
          >
            <option value="">{t('common.all')}</option>
            {departments.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.search')}</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('reports.searchPlaceholder')}
            disabled={!courseId}
          />
        </label>
        <div className="md:col-span-4 flex justify-end">
          <button type="submit" className="cl-btn-primary" disabled={loading || !courseId}>
            {loading ? t('common.loading') : t('reports.run')}
          </button>
        </div>
      </form>

      {error && <p className="text-rose-300 text-sm">{error}</p>}

      {!courseId && !loading && (
        <div className="cl-card p-8 text-center text-cl-muted text-sm">{t('reports.pickCourse')}</div>
      )}

      {courseId && totals && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-cl-fg">{selectedCourseLabel}</h3>
              {Number(course?.level) > 1 && (
                <p className="text-xs text-cl-muted mt-1">{t('common.level', { level: course.level })}</p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                [t('reports.totalStaff'), totals.employees],
                [t('reports.completedCount'), totals.completed],
                [t('reports.outstandingCount'), totals.outstanding],
              ].map(([label, value]) => (
                <div key={label} className="cl-card px-4 py-3 min-w-[7rem]">
                  <div className="text-[10px] uppercase tracking-wider text-cl-muted mb-1">{label}</div>
                  <div className="text-xl font-semibold text-cl-fg">{value ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-cl-fg">
                  {t('reports.completedTitle', { count: completed.length })}
                </h3>
                <p className="text-xs text-cl-muted mt-1">{t('reports.completedBody')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="cl-btn-ghost"
                  onClick={() => exportSectionExcel('completed')}
                  disabled={loading || Boolean(printBusy) || Boolean(excelBusy) || !completed.length}
                >
                  {excelBusy === 'completed' ? t('reports.exportingExcel') : t('reports.exportExcel')}
                </button>
                <button
                  type="button"
                  className="cl-btn-ghost"
                  onClick={() => printSection('completed')}
                  disabled={loading || Boolean(printBusy) || Boolean(excelBusy) || !completed.length}
                >
                  {printBusy === 'completed' ? t('reports.preparingPrint') : t('reports.printSection')}
                </button>
              </div>
            </div>
            {loading ? (
              <p className="text-cl-muted text-sm">{t('common.loading')}</p>
            ) : (
              <ReportTable
                rows={completed}
                emptyLabel={t('reports.completedEmpty')}
                formatDate={formatDate}
                formatStatus={formatStatus}
                t={t}
              />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-cl-fg">
                  {t('reports.outstandingTitle', { count: outstanding.length })}
                </h3>
                <p className="text-xs text-cl-muted mt-1">{t('reports.outstandingBody')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="cl-btn-ghost"
                  onClick={() => exportSectionExcel('outstanding')}
                  disabled={loading || Boolean(printBusy) || Boolean(excelBusy) || !outstanding.length}
                >
                  {excelBusy === 'outstanding' ? t('reports.exportingExcel') : t('reports.exportExcel')}
                </button>
                <button
                  type="button"
                  className="cl-btn-ghost"
                  onClick={() => printSection('outstanding')}
                  disabled={loading || Boolean(printBusy) || Boolean(excelBusy) || !outstanding.length}
                >
                  {printBusy === 'outstanding' ? t('reports.preparingPrint') : t('reports.printSection')}
                </button>
              </div>
            </div>
            {loading ? (
              <p className="text-cl-muted text-sm">{t('common.loading')}</p>
            ) : (
              <ReportTable
                rows={outstanding}
                emptyLabel={t('reports.outstandingEmpty')}
                formatDate={formatDate}
                formatStatus={formatStatus}
                t={t}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
