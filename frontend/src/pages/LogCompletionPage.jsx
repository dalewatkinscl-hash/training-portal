import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createCompletionsBatch, fetchCourses, fetchEmployees } from '../lib/api';
import { useI18n } from '../i18n/LanguageProvider';

export default function LogCompletionPage() {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const [courses, setCourses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [createCertificate, setCreateCertificate] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      const response = await fetchCourses();
      if (response.ok) {
        setCourses((response.courses || []).filter((course) => course.active !== false));
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPeople(true);
      try {
        const response = await fetchEmployees();
        if (!response.ok) throw new Error(response.error || 'Failed to load employees.');
        if (cancelled) return;
        setEmployees(response.employees || []);
        setDepartments(response.departments || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load employees.');
      } finally {
        if (!cancelled) setLoadingPeople(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefill one person when opened from an employee profile.
  useEffect(() => {
    const uid = searchParams.get('employeeUid');
    if (!uid) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(uid);
      return next;
    });
  }, [searchParams]);

  const filteredEmployees = useMemo(() => {
    const query = q.trim().toLowerCase();
    const dept = department.trim().toLowerCase();
    return employees
      .filter((person) => {
        if (dept && String(person.department || '').toLowerCase() !== dept) return false;
        if (!query) return true;
        const haystack = [
          person.employeeName,
          person.employeeEmail,
          person.department,
          person.matrixName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) =>
        String(a.employeeName || a.employeeEmail || '').localeCompare(
          String(b.employeeName || b.employeeEmail || ''),
          locale,
          { sensitivity: 'base' },
        ),
      );
  }, [employees, q, department, locale]);

  const selectedCourse = courses.find((course) => course.id === courseId) || null;
  const selectedCount = selected.size;

  const togglePerson = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredEmployees.forEach((person) => next.add(person.employeeUid));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!courseId) {
      setError(t('log.selectCourseError'));
      return;
    }
    if (!selectedCount) {
      setError(t('log.selectPersonError'));
      return;
    }

    setSaving(true);
    setError('');
    setResult(null);

    try {
      const people = employees
        .filter((person) => selected.has(person.employeeUid))
        .map((person) => ({
          employeeUid: person.employeeUid,
          employeeName: person.employeeName || '',
          employeeEmail: person.employeeEmail || '',
        }));

      const response = await createCompletionsBatch({
        courseId,
        completedAt,
        notes,
        createCertificate,
        source: 'manual',
        employees: people,
      });

      if (!response.ok && !response.results) {
        throw new Error(response.error || 'Failed to log course.');
      }

      setResult(response);
      if ((response.totals?.failed || 0) === 0) {
        setSelected(new Set());
        setNotes('');
      }
    } catch (err) {
      setError(err.message || 'Failed to log course.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-cl-fg">{t('log.title')}</h2>
          <p className="text-sm text-cl-muted mt-1">
            {t('log.subtitle')}
          </p>
        </div>
        <Link to="/courses" className="cl-btn-ghost">
          {t('log.manageCatalogue')}
        </Link>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">{t('log.dateOfCourse')}</span>
            <input
              className="cl-input"
              type="date"
              required
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
            />
          </label>

          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">{t('common.course')}</span>
            <select
              className="cl-input"
              required
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">{t('log.selectCourse')}</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.code ? ` (${course.code})` : ''}
                  {Number(course.level) > 1 ? ` · ${t('common.level', { level: course.level })}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-cl-muted">
              {t('log.needNewCourse')}{' '}
              <Link to="/courses" className="text-cl-accent hover:underline">
                {t('log.addToCatalogue')}
              </Link>
              .
            </p>
          </label>
        </div>

        {selectedCourse && (
          <p className="text-xs text-cl-muted">
            {t('log.validity')}{' '}
            {selectedCourse.validityMonths
              ? t('courses.validityMonths', { n: selectedCourse.validityMonths })
              : t('courses.noExpiry')}
            {selectedCourse.category ? ` · ${selectedCourse.category}` : ''}
            {Number(selectedCourse.level) > 1 ? ` · ${t('common.level', { level: selectedCourse.level })}` : ''}
          </p>
        )}

        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">{t('log.notes')}</span>
          <textarea
            className="cl-input min-h-[72px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('log.notesPlaceholder')}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-cl-muted">
          <input
            type="checkbox"
            checked={createCertificate}
            onChange={(e) => setCreateCertificate(e.target.checked)}
          />
          {t('log.issueCertificate')}
        </label>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-cl-fg">{t('log.attendees')}</h3>
              <p className="text-xs text-cl-muted mt-0.5">
                {t('log.selected', { count: selectedCount })}
                {filteredEmployees.length !== employees.length
                  ? t('log.showing', { shown: filteredEmployees.length, total: employees.length })
                  : t('log.peopleCount', { count: employees.length })}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="cl-btn-ghost text-xs" onClick={selectVisible}>
                {t('log.selectVisible')}
              </button>
              <button type="button" className="cl-btn-ghost text-xs" onClick={clearSelection}>
                {t('log.clear')}
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-sm space-y-1.5">
              <span className="text-xs text-cl-muted">{t('common.search')}</span>
              <input
                className="cl-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('employees.searchPlaceholder')}
              />
            </label>
            <label className="text-sm space-y-1.5">
              <span className="text-xs text-cl-muted">{t('common.department')}</span>
              <select
                className="cl-input"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">{t('log.allDepartments')}</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="border border-cl-border rounded-xl max-h-[28rem] overflow-y-auto">
            {loadingPeople ? (
              <p className="p-4 text-sm text-cl-muted">{t('log.loadingPeople')}</p>
            ) : filteredEmployees.length === 0 ? (
              <p className="p-4 text-sm text-cl-muted">{t('log.noPeople')}</p>
            ) : (
              <ul className="divide-y divide-cl-border/60">
                {filteredEmployees.map((person) => {
                  const checked = selected.has(person.employeeUid);
                  return (
                    <li key={person.employeeUid}>
                      <label
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                          checked ? 'bg-cl-accent/10' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-indigo-500"
                          checked={checked}
                          onChange={() => togglePerson(person.employeeUid)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-cl-fg truncate">
                            {person.employeeName || t('common.unnamed')}
                          </span>
                          <span className="block text-xs text-cl-muted truncate">
                            {[person.department, person.employeeEmail].filter(Boolean).join(' · ')
                              || person.employeeUid}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {error && <p className="text-rose-300 text-sm">{error}</p>}

        {result && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
            <p className="text-sm text-emerald-200 font-medium">
              {t('log.logged', { course: result.course?.title || t('common.course'), count: result.totals?.requested || 0 })}
              {result.totals?.failed
                ? t('log.failedCount', { count: result.totals.failed })
                : ''}
              .
            </p>
            <p className="text-xs text-cl-muted">
              {t('log.summary', { created: result.totals?.created || 0, updated: result.totals?.updated || 0 })}
              {createCertificate
                ? t('log.certsProcessed', { count: result.totals?.certificates || 0 })
                : ''}
            </p>
            {(result.results || []).some((row) => !row.ok) && (
              <ul className="text-xs text-rose-300 space-y-1 pt-1">
                {result.results
                  .filter((row) => !row.ok)
                  .map((row) => (
                    <li key={row.employeeUid}>
                      {row.employeeName || row.employeeUid}: {row.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="submit"
          className="cl-btn-primary"
          disabled={saving || !courseId || selectedCount === 0}
        >
          {saving
            ? t('log.savingCount', { count: selectedCount })
            : selectedCount === 0
              ? t('log.selectAttendees')
              : selectedCount === 1
                ? t('log.submitOne')
                : t('log.submitMany', { count: selectedCount })}
        </button>
      </form>
    </div>
  );
}
