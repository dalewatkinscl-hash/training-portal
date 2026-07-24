import { useEffect, useState } from 'react';
import { createCourse, fetchCourses, updateCourse } from '../lib/api';

const emptyForm = {
  code: '',
  title: '',
  category: 'general',
  description: '',
  validityMonths: '12',
  active: true,
};

export default function CoursesPage() {
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const response = await fetchCourses();
    if (!response.ok) throw new Error(response.error || 'Failed to load courses.');
    setCourses(response.courses || []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load courses.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await createCourse({
        ...form,
        validityMonths: form.validityMonths === '' ? null : Number(form.validityMonths),
      });
      if (!response.ok) throw new Error(response.error || 'Failed to create course.');
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to create course.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (course) => {
    const response = await updateCourse(course.id, { active: !course.active });
    if (!response.ok) {
      setError(response.error || 'Failed to update course.');
      return;
    }
    await load();
  };

  if (loading) return <p className="text-cl-muted text-sm">Loading courses…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">Course catalogue</h2>
        <p className="text-sm text-cl-muted mt-1">
          Define courses once. Assessment and CPC completions map into these records.
        </p>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 grid md:grid-cols-2 gap-4">
        <label className="text-sm space-y-1.5">
          <span className="text-cl-muted">Title</span>
          <input
            className="cl-input"
            required
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-cl-muted">Code</span>
          <input
            className="cl-input"
            value={form.code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
            placeholder="e.g. DG-01"
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-cl-muted">Category</span>
          <input
            className="cl-input"
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
          />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-cl-muted">Validity (months)</span>
          <input
            className="cl-input"
            type="number"
            min="0"
            value={form.validityMonths}
            onChange={(e) => setForm((prev) => ({ ...prev, validityMonths: e.target.value }))}
            placeholder="Blank = no expiry"
          />
        </label>
        <label className="text-sm space-y-1.5 md:col-span-2">
          <span className="text-cl-muted">Description</span>
          <textarea
            className="cl-input min-h-[80px]"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </label>
        {error && <p className="text-rose-300 text-sm md:col-span-2">{error}</p>}
        <div className="md:col-span-2">
          <button type="submit" className="cl-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add course'}
          </button>
        </div>
      </form>

      <div className="cl-card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Validity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id} className="border-b border-cl-border/60 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-cl-fg">{course.title}</div>
                  <div className="text-xs text-cl-muted">{course.code || 'No code'}</div>
                </td>
                <td className="px-4 py-3 text-cl-muted capitalize">{course.category}</td>
                <td className="px-4 py-3 text-cl-muted">
                  {course.validityMonths ? `${course.validityMonths} months` : 'No expiry'}
                </td>
                <td className="px-4 py-3 text-cl-muted">{course.active ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="cl-btn-ghost" onClick={() => toggleActive(course)}>
                    {course.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
