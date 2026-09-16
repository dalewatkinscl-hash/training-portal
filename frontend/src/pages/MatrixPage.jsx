import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrainingMatrix } from '../lib/api';
import { statusTone } from '../lib/training';
import { useI18n } from '../i18n/LanguageProvider';

export default function MatrixPage() {
  const { t, locale, formatDate, formatStatus, formatSource, formatCourseType } = useI18n();
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [courseNames, setCourseNames] = useState([]);
  const [totals, setTotals] = useState(null);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
  const [status, setStatus] = useState('');
  const [courseType, setCourseType] = useState('');
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState('');
  const [error, setError] = useState('');

  const load = async (params = {}) => {
    const response = await fetchTrainingMatrix(params);
    if (!response.ok) throw new Error(response.error || 'Failed to load matrix.');
    setRows(response.rows || []);
    setDepartments(response.departments || []);
    setCourseNames(response.courseNames || []);
    setTotals(response.totals || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load matrix.');
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
      await load({ q, department, course, status, courseType });
    } catch (err) {
      setError(err.message || 'Failed to load matrix.');
    } finally {
      setLoading(false);
    }
  };

  const buildMatrixPdf = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const exportedAt = new Date();
    const activeFilters = [
      q && t('matrix.pdfSearch', { q }),
      department && t('matrix.pdfDepartment', { department }),
      course && t('matrix.pdfCourse', { course }),
      status && t('matrix.pdfStatus', { status: formatStatus(status) }),
      courseType && t('matrix.pdfType', { type: formatCourseType(courseType) }),
    ].filter(Boolean);

    doc.setFontSize(16);
    doc.text(t('matrix.title'), 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(90, 96, 110);
    doc.text(t('matrix.pdfExported', { when: exportedAt.toLocaleString(locale) }), 40, 58);
    doc.text(t('matrix.pdfRows', { count: rows.length }), 40, 74);
    if (activeFilters.length) {
      doc.text(t('matrix.pdfFilters', { filters: activeFilters.join(' | ') }), 40, 90, { maxWidth: 740 });
    }

    autoTable(doc, {
      startY: activeFilters.length ? 108 : 92,
      head: [[
        t('common.employee'),
        t('common.department'),
        t('common.course'),
        t('common.type'),
        t('matrix.validMonths'),
        t('common.completed'),
        t('common.due'),
        t('common.status'),
        t('common.source'),
      ]],
      body: rows.map((row) => [
        row.employeeName || '-',
        row.department || '-',
        row.coveredByCourseTitle
          ? t('matrix.pdfCoveredBy', { course: row.courseName || '-', title: row.coveredByCourseTitle })
          : (row.courseName || '-'),
        formatCourseType(row.courseType),
        row.validityMonths == null ? '-' : String(row.validityMonths),
        formatDate(row.completedAt),
        formatDate(row.dueDate),
        formatStatus(row.status),
        formatSource(row.source),
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 5,
        overflow: 'linebreak',
        lineColor: [223, 229, 239],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [31, 41, 55],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      margin: { left: 24, right: 24, bottom: 24 },
    });

    return { doc, exportedAt };
  };

  const runPdfAction = async (action) => {
    if (!rows.length || pdfBusy) return;

    setPdfBusy(action);
    setError('');

    try {
      const { doc, exportedAt } = await buildMatrixPdf();

      if (action === 'print') {
        doc.autoPrint();
        const blobUrl = doc.output('bloburl');
        const printWindow = window.open(blobUrl, '_blank');
        if (!printWindow) {
          throw new Error(t('matrix.popupBlocked'));
        }
      } else {
        const fileDate = exportedAt.toISOString().slice(0, 10);
        doc.save(`training-matrix-${fileDate}.pdf`);
      }
    } catch (err) {
      setError(err.message || (action === 'print' ? 'Failed to print PDF.' : 'Failed to export PDF.'));
    } finally {
      setPdfBusy('');
    }
  };

  return (
    <div className="space-y-6 max-w-none">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-cl-fg">{t('matrix.title')}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {t('matrix.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={() => runPdfAction('export')}
            disabled={loading || Boolean(pdfBusy) || !rows.length}
          >
            {pdfBusy === 'export' ? t('matrix.exportingPdf') : t('matrix.exportPdf')}
          </button>
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={() => runPdfAction('print')}
            disabled={loading || Boolean(pdfBusy) || !rows.length}
          >
            {pdfBusy === 'print' ? t('matrix.preparingPrint') : t('matrix.printPdf')}
          </button>
          <Link to="/employees" className="cl-btn-ghost">
            {t('matrix.employeeDirectory')}
          </Link>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            [t('matrix.rows'), totals.rows],
            [t('employees.count'), totals.employees],
            [t('stats.valid'), totals.valid],
            [t('stats.expiringSoon'), totals.expiringSoon],
            [t('stats.expired'), totals.expired],
          ].map(([label, value]) => (
            <div key={label} className="cl-card p-4">
              <div className="text-xs uppercase tracking-wider text-cl-muted mb-2">{label}</div>
              <div className="text-2xl font-semibold text-cl-fg">{value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={applyFilters} className="cl-card p-4 grid md:grid-cols-3 xl:grid-cols-6 gap-3">
        <label className="text-sm space-y-1.5 xl:col-span-2">
          <span className="text-xs text-cl-muted">{t('common.search')}</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('matrix.searchPlaceholder')}
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
          <span className="text-xs text-cl-muted">{t('common.course')}</span>
          <select className="cl-input w-full" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {courseNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.status')}</span>
          <select className="cl-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="completed">{t('status.valid')}</option>
            <option value="expiring_soon">{t('status.expiringSoon')}</option>
            <option value="expired">{t('status.expired')}</option>
            <option value="assigned">{t('status.required')}</option>
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">{t('common.type')}</span>
          <select className="cl-input w-full" value={courseType} onChange={(e) => setCourseType(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="mandatory">{t('courseType.mandatory')}</option>
            <option value="additional">{t('courseType.additional')}</option>
          </select>
        </label>
        <div className="flex items-end md:col-span-3 xl:col-span-6">
          <button type="submit" className="cl-btn-primary" disabled={loading}>
            {loading ? t('common.loading') : t('common.applyFilters')}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">{t('common.employee')}</th>
                <th className="px-3 py-3 font-medium">{t('common.department')}</th>
                <th className="px-3 py-3 font-medium">{t('common.course')}</th>
                <th className="px-3 py-3 font-medium">{t('common.type')}</th>
                <th className="px-3 py-3 font-medium">{t('matrix.validMonths')}</th>
                <th className="px-3 py-3 font-medium">{t('common.completed')}</th>
                <th className="px-3 py-3 font-medium">{t('common.due')}</th>
                <th className="px-3 py-3 font-medium">{t('common.status')}</th>
                <th className="px-3 py-3 font-medium">{t('common.source')}</th>
                <th className="px-3 py-3 font-medium">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-cl-muted">
                    {t('matrix.empty')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-cl-border/60 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.employeeUid ? (
                        <Link
                          to={`/employees/${encodeURIComponent(row.employeeUid)}`}
                          className="text-cl-fg hover:text-cl-accent-bright font-medium"
                        >
                          {row.employeeName || '—'}
                        </Link>
                      ) : (
                        <span className="text-cl-fg">{row.employeeName || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{row.department || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-fg min-w-[180px]">
                      {row.courseName || '—'}
                      {row.courseLevel > 1 && (
                        <div className="text-xs text-cl-muted">{t('common.level', { level: row.courseLevel })}</div>
                      )}
                      {row.coveredByCourseTitle && (
                        <div className="text-xs text-sky-300/90">{t('common.coveredBy', { title: row.coveredByCourseTitle })}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatCourseType(row.courseType)}</td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">
                      {row.validityMonths == null ? '—' : row.validityMonths}
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatDate(row.completedAt)}</td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatDate(row.dueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`cl-badge ${statusTone(row.status)}`}>
                        {formatStatus(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">{formatSource(row.source)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.conductAssessmentUrl ? (
                        <a href={row.conductAssessmentUrl} className="cl-btn-primary inline-flex text-xs px-3 py-1.5">
                          {t('action.conductAssessment')}
                        </a>
                      ) : row.assessmentUrl ? (
                        <a href={row.assessmentUrl} className="cl-btn-primary inline-flex text-xs px-3 py-1.5">
                          {t('action.takeAssessment')}
                        </a>
                      ) : row.trainerLed ? (
                        <span className="text-xs text-cl-muted">{t('action.trainerLed')}</span>
                      ) : (
                        <span className="text-cl-muted">—</span>
                      )}
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
