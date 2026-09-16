import { Fragment, useEffect, useState } from 'react';
import { createCourse, fetchCourses, updateCourse } from '../lib/api';
import { useI18n } from '../i18n/LanguageProvider';

const emptyForm = {
  code: '',
  title: '',
  category: 'general',
  description: '',
  validityMonths: '12',
  level: '1',
  tierFamily: '',
  active: true,
};

function courseToForm(course) {
  return {
    code: course.code || '',
    title: course.title || '',
    category: course.category || 'general',
    description: course.description || '',
    validityMonths: course.validityMonths == null ? '' : String(course.validityMonths),
    level: String(course.level || '1'),
    tierFamily: course.tierFamily || '',
    active: course.active !== false,
  };
}

function CourseFields({ form, setForm, idPrefix }) {
  const { t } = useI18n();
  const field = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldTitle')}</span>
        <input
          id={`${idPrefix}-title`}
          className="cl-input"
          required
          value={form.title}
          onChange={field('title')}
        />
      </label>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldCode')}</span>
        <input
          className="cl-input"
          value={form.code}
          onChange={field('code')}
          placeholder={t('courses.codePlaceholder')}
        />
      </label>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldCategory')}</span>
        <input
          className="cl-input"
          value={form.category}
          onChange={field('category')}
        />
      </label>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldValidity')}</span>
        <input
          className="cl-input"
          type="number"
          min="0"
          value={form.validityMonths}
          onChange={field('validityMonths')}
          placeholder={t('courses.validityPlaceholder')}
        />
      </label>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldLevel')}</span>
        <select className="cl-input" value={form.level} onChange={field('level')}>
          <option value="1">{t('common.level', { level: 1 })}</option>
          <option value="2">{t('common.level', { level: 2 })}</option>
          <option value="3">{t('common.level', { level: 3 })}</option>
        </select>
      </label>
      <label className="text-sm space-y-1.5">
        <span className="text-cl-muted">{t('courses.fieldTier')}</span>
        <input
          className="cl-input"
          value={form.tierFamily}
          onChange={field('tierFamily')}
          placeholder={t('courses.tierPlaceholder')}
        />
      </label>
      <p className="text-xs text-cl-muted md:col-span-2">
        {t('courses.tierHelp')}
      </p>
      <label className="text-sm space-y-1.5 md:col-span-2">
        <span className="text-cl-muted">{t('courses.fieldDescription')}</span>
        <textarea
          className="cl-input min-h-[80px]"
          value={form.description}
          onChange={field('description')}
        />
      </label>
    </>
  );
}

export default function CoursesPage() {
  const { t } = useI18n();
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const response = await fetchCourses({ active: '0' });
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

  const payloadFrom = (values) => ({
    ...values,
    validityMonths: values.validityMonths === '' ? null : Number(values.validityMonths),
    level: Number(values.level) || 1,
    tierFamily: String(values.tierFamily || '').trim(),
  });

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await createCourse(payloadFrom(form));
      if (!response.ok) throw new Error(response.error || 'Failed to create course.');
      setForm(emptyForm);
      setMessage(t('courses.added'));
      await load();
    } catch (err) {
      setError(err.message || 'Failed to create course.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (course) => {
    setEditingId(course.id);
    setEditForm(courseToForm(course));
    setError('');
    setMessage('');
  };

  const cancelEdit = () => {
    setEditingId('');
    setEditForm(emptyForm);
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await updateCourse(editingId, payloadFrom(editForm));
      if (!response.ok) throw new Error(response.error || 'Failed to update course.');
      setMessage(t('courses.updated', { title: editForm.title || t('common.course') }));
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message || 'Failed to update course.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (course) => {
    setError('');
    setMessage('');
    const response = await updateCourse(course.id, { active: !course.active });
    if (!response.ok) {
      setError(response.error || 'Failed to update course.');
      return;
    }
    if (editingId === course.id) {
      setEditForm((prev) => ({ ...prev, active: !course.active }));
    }
    await load();
  };

  if (loading) return <p className="text-cl-muted text-sm">{t('courses.loading')}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('courses.title')}</h2>
        <p className="text-sm text-cl-muted mt-1">
          {t('courses.subtitle')}
        </p>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold text-cl-fg">{t('courses.addTitle')}</h3>
        </div>
        <CourseFields form={form} setForm={setForm} idPrefix="add" />
        {error && !editingId && <p className="text-rose-300 text-sm md:col-span-2">{error}</p>}
        {message && !editingId && <p className="text-emerald-300 text-sm md:col-span-2">{message}</p>}
        <div className="md:col-span-2">
          <button type="submit" className="cl-btn-primary" disabled={saving || Boolean(editingId)}>
            {saving && !editingId ? t('common.saving') : t('courses.add')}
          </button>
        </div>
      </form>

      <div className="cl-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
              <th className="px-4 py-3">{t('common.course')}</th>
              <th className="px-4 py-3">{t('courses.fieldCategory')}</th>
              <th className="px-4 py-3">{t('courses.fieldLevel')}</th>
              <th className="px-4 py-3">{t('courses.fieldValidity')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              <th className="px-4 py-3 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => {
              const editing = editingId === course.id;
              return (
                <Fragment key={course.id}>
                  <tr className={`border-b border-cl-border/60 last:border-0 ${editing ? 'bg-white/[0.03]' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-cl-fg">{course.title}</div>
                      <div className="text-xs text-cl-muted">{course.code || t('courses.noCode')}</div>
                    </td>
                    <td className="px-4 py-3 text-cl-muted capitalize">{course.category}</td>
                    <td className="px-4 py-3 text-cl-muted whitespace-nowrap">
                      {t('common.level', { level: course.level || 1 })}
                      {course.tierFamily ? (
                        <div className="text-xs text-cl-muted/80">{course.tierFamily}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-cl-muted">
                      {course.validityMonths ? t('courses.validityMonths', { n: course.validityMonths }) : t('courses.noExpiry')}
                    </td>
                    <td className="px-4 py-3 text-cl-muted">{course.active ? t('courses.active') : t('courses.inactive')}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button type="button" className="cl-btn-ghost" onClick={() => toggleActive(course)}>
                          {course.active ? t('courses.deactivate') : t('courses.activate')}
                        </button>
                        <button
                          type="button"
                          className="cl-btn-ghost"
                          disabled={saving && editing}
                          onClick={() => (editing ? cancelEdit() : startEdit(course))}
                        >
                          {editing ? t('common.close') : t('common.edit')}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editing && (
                    <tr className="border-b border-cl-border/60 last:border-0">
                      <td colSpan={6} className="px-4 py-4 bg-white/[0.02]">
                        <form onSubmit={saveEdit} className="grid md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <h3 className="text-sm font-semibold text-cl-fg">{t('courses.editTitle', { title: course.title })}</h3>
                            <p className="text-xs text-cl-muted mt-1">
                              {t('courses.editHint')}
                            </p>
                          </div>
                          <CourseFields form={editForm} setForm={setEditForm} idPrefix={`edit-${course.id}`} />
                          <label className="text-sm flex items-center gap-2 md:col-span-2">
                            <input
                              type="checkbox"
                              checked={editForm.active}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, active: e.target.checked }))}
                            />
                            <span className="text-cl-muted">{t('courses.activeInCatalogue')}</span>
                          </label>
                          {error && <p className="text-rose-300 text-sm md:col-span-2">{error}</p>}
                          {message && <p className="text-emerald-300 text-sm md:col-span-2">{message}</p>}
                          <div className="md:col-span-2 flex gap-2">
                            <button type="submit" className="cl-btn-primary" disabled={saving}>
                              {saving ? t('common.saving') : t('courses.saveChanges')}
                            </button>
                            <button type="button" className="cl-btn-ghost" disabled={saving} onClick={cancelEdit}>
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
