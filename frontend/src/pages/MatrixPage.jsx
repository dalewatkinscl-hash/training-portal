import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrainingMatrix } from '../lib/api';
import { formatDate, formatStatus, statusTone } from '../lib/training';

const TABLE_COLUMNS = [
  'Employee',
  'Department',
  'Course',
  'Type',
  'Valid (months)',
  'Completed',
  'Due',
  'Status',
  'Source',
];

export default function MatrixPage() {
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
      q && `Search: ${q}`,
      department && `Department: ${department}`,
      course && `Course: ${course}`,
      status && `Status: ${formatStatus(status)}`,
      courseType && `Type: ${courseType}`,
    ].filter(Boolean);

    doc.setFontSize(16);
    doc.text('Training matrix', 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(90, 96, 110);
    doc.text(`Exported ${exportedAt.toLocaleString('en-GB')}`, 40, 58);
    doc.text(`Rows: ${rows.length}`, 40, 74);
    if (activeFilters.length) {
      doc.text(`Filters: ${activeFilters.join(' | ')}`, 40, 90, { maxWidth: 740 });
    }

    autoTable(doc, {
      startY: activeFilters.length ? 108 : 92,
      head: [TABLE_COLUMNS],
      body: rows.map((row) => [
        row.employeeName || '-',
        row.department || '-',
        row.courseName || '-',
        row.courseType || '-',
        row.validityMonths == null ? '-' : String(row.validityMonths),
        formatDate(row.completedAt),
        formatDate(row.dueDate),
        formatStatus(row.status),
        row.source || '-',
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
          throw new Error('Pop-up blocked. Allow pop-ups for this site to print the PDF.');
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
          <h2 className="text-xl font-semibold text-cl-fg">Training matrix</h2>
          <p className="text-sm text-cl-muted mt-1">
            Flat view of all training records — same shape as the old SharePoint list.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={() => runPdfAction('export')}
            disabled={loading || Boolean(pdfBusy) || !rows.length}
          >
            {pdfBusy === 'export' ? 'Exporting PDF…' : 'Export PDF'}
          </button>
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={() => runPdfAction('print')}
            disabled={loading || Boolean(pdfBusy) || !rows.length}
          >
            {pdfBusy === 'print' ? 'Preparing print…' : 'Print PDF'}
          </button>
          <Link to="/employees" className="cl-btn-ghost">
            Employee directory
          </Link>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['Rows', totals.rows],
            ['Employees', totals.employees],
            ['Valid', totals.valid],
            ['Expiring soon', totals.expiringSoon],
            ['Expired', totals.expired],
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
          <span className="text-xs text-cl-muted">Search</span>
          <input
            className="cl-input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Employee or course…"
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Department</span>
          <select className="cl-input w-full" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All</option>
            {departments.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Course</span>
          <select className="cl-input w-full" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All</option>
            {courseNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Status</span>
          <select className="cl-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Valid</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="assigned">Required</option>
          </select>
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-xs text-cl-muted">Type</span>
          <select className="cl-input w-full" value={courseType} onChange={(e) => setCourseType(e.target.value)}>
            <option value="">All</option>
            <option value="mandatory">Mandatory</option>
            <option value="additional">Additional</option>
          </select>
        </label>
        <div className="flex items-end md:col-span-3 xl:col-span-6">
          <button type="submit" className="cl-btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Department</th>
                <th className="px-3 py-3 font-medium">Course</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Valid (months)</th>
                <th className="px-3 py-3 font-medium">Completed</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-cl-muted">
                    No training rows found.
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
                    <td className="px-3 py-2.5 text-cl-fg min-w-[180px]">{row.courseName || '—'}</td>
                    <td className="px-3 py-2.5 text-cl-muted capitalize whitespace-nowrap">{row.courseType || '—'}</td>
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
                    <td className="px-3 py-2.5 text-cl-muted capitalize whitespace-nowrap">{row.source || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.conductAssessmentUrl ? (
                        <a href={row.conductAssessmentUrl} className="cl-btn-primary inline-flex text-xs px-3 py-1.5">
                          Conduct assessment
                        </a>
                      ) : row.assessmentUrl ? (
                        <a href={row.assessmentUrl} className="cl-btn-primary inline-flex text-xs px-3 py-1.5">
                          Take assessment
                        </a>
                      ) : row.trainerLed ? (
                        <span className="text-xs text-cl-muted">Trainer-led</span>
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
