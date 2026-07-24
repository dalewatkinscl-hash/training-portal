import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createCompletion, fetchCourses } from '../lib/api';

const emptyForm = {
  employeeUid: '',
  employeeName: '',
  employeeEmail: '',
  courseId: '',
  completedAt: new Date().toISOString().slice(0, 10),
  notes: '',
  createCertificate: true,
};

export default function LogCompletionPage() {
  const [searchParams] = useSearchParams();
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const uid = searchParams.get('employeeUid') || '';
    const name = searchParams.get('employeeName') || '';
    const email = searchParams.get('employeeEmail') || '';
    if (uid || name || email) {
      setForm((prev) => ({
        ...prev,
        employeeUid: uid || prev.employeeUid,
        employeeName: name || prev.employeeName,
        employeeEmail: email || prev.employeeEmail,
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      const response = await fetchCourses();
      if (response.ok) setCourses((response.courses || []).filter((course) => course.active));
    })();
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const selected = courses.find((course) => course.id === form.courseId);
      const response = await createCompletion({
        employeeUid: form.employeeUid.trim(),
        employeeName: form.employeeName.trim(),
        employeeEmail: form.employeeEmail.trim(),
        courseId: form.courseId,
        courseTitle: selected?.title,
        courseCode: selected?.code,
        completedAt: form.completedAt,
        notes: form.notes,
        createCertificate: form.createCertificate,
        source: 'manual',
      });
      if (!response.ok) throw new Error(response.error || 'Failed to log completion.');
      setMessage(
        response.completion?.sharePointWebUrl
          ? 'Completion saved and certificate uploaded to SharePoint.'
          : 'Completion saved. Certificate generated (SharePoint upload pending if Graph secrets are not set).',
      );
      setForm((prev) => ({
        ...emptyForm,
        completedAt: prev.completedAt,
      }));
    } catch (err) {
      setError(err.message || 'Failed to log completion.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">Log completion</h2>
        <p className="text-sm text-cl-muted mt-1">
          Manually record a completion, issue a certificate, and store it under
          {' '}<span className="text-cl-fg">Employee/Certificates/Course Name/Course Name.pdf</span>.
        </p>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 space-y-4">
        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">Employee UID (from Employee Portal)</span>
          <input
            className="cl-input"
            required
            value={form.employeeUid}
            onChange={(e) => setForm((prev) => ({ ...prev, employeeUid: e.target.value }))}
            placeholder="Firebase / portal uid"
          />
        </label>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">Employee name</span>
            <input
              className="cl-input"
              required
              value={form.employeeName}
              onChange={(e) => setForm((prev) => ({ ...prev, employeeName: e.target.value }))}
            />
          </label>
          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">Employee email</span>
            <input
              className="cl-input"
              type="email"
              value={form.employeeEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, employeeEmail: e.target.value }))}
            />
          </label>
        </div>
        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">Course</span>
          <select
            className="cl-input"
            required
            value={form.courseId}
            onChange={(e) => setForm((prev) => ({ ...prev, courseId: e.target.value }))}
          >
            <option value="">Select a course…</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
                {course.code ? ` (${course.code})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">Completed on</span>
          <input
            className="cl-input"
            type="date"
            required
            value={form.completedAt}
            onChange={(e) => setForm((prev) => ({ ...prev, completedAt: e.target.value }))}
          />
        </label>
        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">Notes</span>
          <textarea
            className="cl-input min-h-[80px]"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-cl-muted">
          <input
            type="checkbox"
            checked={form.createCertificate}
            onChange={(e) => setForm((prev) => ({ ...prev, createCertificate: e.target.checked }))}
          />
          Create certificate and upload to SharePoint Certificates folder
        </label>

        {error && <p className="text-rose-300 text-sm">{error}</p>}
        {message && <p className="text-emerald-300 text-sm">{message}</p>}

        <button type="submit" className="cl-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save completion'}
        </button>
      </form>
    </div>
  );
}
