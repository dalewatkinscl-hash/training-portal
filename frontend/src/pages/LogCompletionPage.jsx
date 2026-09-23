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
  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'assign' ? 'assign' : 'complete'));
  const [courseId, setCourseId] = useState('');
  const [selectedCourseIds, setSelectedCourseIds] = useState(() => new Set());
  const [courseQ, setCourseQ] = useState('');
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
    if (searchParams.get('mode') === 'assign') setMode('assign');
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

  const filteredCourses = useMemo(() => {
    const query = courseQ.trim().toLowerCase();
    const list = [...courses].sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), locale, { sensitivity: 'base' }),
    );
    if (!query) return list;
    return list.filter((course) => {
      const haystack = [course.title, course.code, course.category].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [courses, courseQ, locale]);

  const assignMode = mode === 'assign';
  const selectedCount = selected.size;
  const selectedCourseCount = assignMode ? selectedCourseIds.size : (courseId ? 1 : 0);
  const selectedCourses = assignMode
    ? courses.filter((course) => selectedCourseIds.has(course.id))
    : courses.filter((course) => course.id === courseId);
  const selectedCourse = selectedCourses[0] || null;
  const linkedAssessmentCount = selectedCourses.filter((course) => course.assessmentQuizId).length;
  const assignmentTotal = selectedCount * selectedCourseCount;

  const togglePerson = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleCourse = (id) => {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisiblePeople = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredEmployees.forEach((person) => next.add(person.employeeUid));
      return next;
    });
  };

  const selectVisibleCourses = () => {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      filteredCourses.forEach((course) => next.add(course.id));
      return next;
    });
  };

  const clearPeople = () => setSelected(new Set());
  const clearCourses = () => setSelectedCourseIds(new Set());

  const onSubmit = async (event) => {
    event.preventDefault();
    if (assignMode) {
      if (!selectedCourseIds.size) {
        setError(t('log.selectCourseError'));
        return;
      }
    } else if (!courseId) {
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
        ...(assignMode
          ? { courseIds: [...selectedCourseIds] }
          : { courseId }),
        completedAt: assignMode ? null : completedAt,
        notes,
        createCertificate: assignMode ? false : createCertificate,
        assign: assignMode,
        source: 'manual',
        employees: people,
      });

      if (!response.ok && !response.results) {
        throw new Error(response.error || (assignMode ? 'Failed to assign course.' : 'Failed to log course.'));
      }

      setResult(response);
      if ((response.totals?.failed || 0) === 0) {
        setSelected(new Set());
        setSelectedCourseIds(new Set());
        setNotes('');
      }
    } catch (err) {
      setError(err.message || (assignMode ? 'Failed to assign course.' : 'Failed to log course.'));
    } finally {
      setSaving(false);
    }
  };

  const courseLabel = (() => {
    if ((result?.courses || []).length > 1) {
      return t('log.courseCount', { count: result.courses.length });
    }
    return result?.course?.title || result?.courses?.[0]?.title || t('common.course');
  })();

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-cl-fg">
            {assignMode ? t('log.assignTitle') : t('log.title')}
          </h2>
          <p className="text-sm text-cl-muted mt-1">
            {assignMode ? t('log.assignSubtitle') : t('log.subtitle')}
          </p>
        </div>
        <Link to="/courses" className="cl-btn-ghost">
          {t('log.manageCatalogue')}
        </Link>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 space-y-5">
        <fieldset className="grid sm:grid-cols-2 gap-3">
          <legend className="sr-only">{t('log.modeLegend')}</legend>
          <label
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${
              !assignMode ? 'border-cl-accent/50 bg-cl-accent/10' : 'border-cl-border hover:bg-white/[0.03]'
            }`}
          >
            <input
              type="radio"
              name="add-course-mode"
              className="mt-1 accent-indigo-500"
              checked={!assignMode}
              onChange={() => setMode('complete')}
            />
            <span>
              <span className="block text-sm font-medium text-cl-fg">{t('log.modeComplete')}</span>
              <span className="block text-xs text-cl-muted mt-0.5">{t('log.modeCompleteHint')}</span>
            </span>
          </label>
          <label
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${
              assignMode ? 'border-cl-accent/50 bg-cl-accent/10' : 'border-cl-border hover:bg-white/[0.03]'
            }`}
          >
            <input
              type="radio"
              name="add-course-mode"
              className="mt-1 accent-indigo-500"
              checked={assignMode}
              onChange={() => setMode('assign')}
            />
            <span>
              <span className="block text-sm font-medium text-cl-fg">{t('log.modeAssign')}</span>
              <span className="block text-xs text-cl-muted mt-0.5">{t('log.modeAssignHint')}</span>
            </span>
          </label>
        </fieldset>

        {!assignMode && (
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
        )}

        {assignMode && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-cl-fg">{t('log.courses')}</h3>
                <p className="text-xs text-cl-muted mt-0.5">
                  {t('log.coursesSelected', { count: selectedCourseCount })}
                  {filteredCourses.length !== courses.length
                    ? t('log.showing', { shown: filteredCourses.length, total: courses.length })
                    : t('log.coursesCount', { count: courses.length })}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="cl-btn-ghost text-xs" onClick={selectVisibleCourses}>
                  {t('log.selectVisible')}
                </button>
                <button type="button" className="cl-btn-ghost text-xs" onClick={clearCourses}>
                  {t('log.clear')}
                </button>
              </div>
            </div>

            <label className="text-sm space-y-1.5 block">
              <span className="text-xs text-cl-muted">{t('common.search')}</span>
              <input
                className="cl-input"
                value={courseQ}
                onChange={(e) => setCourseQ(e.target.value)}
                placeholder={t('log.courseSearchPlaceholder')}
              />
            </label>

            <div className="border border-cl-border rounded-xl max-h-[20rem] overflow-y-auto">
              {filteredCourses.length === 0 ? (
                <p className="p-4 text-sm text-cl-muted">{t('log.noCourses')}</p>
              ) : (
                <ul className="divide-y divide-cl-border/60">
                  {filteredCourses.map((course) => {
                    const checked = selectedCourseIds.has(course.id);
                    return (
                      <li key={course.id}>
                        <label
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                            checked ? 'bg-cl-accent/10' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-indigo-500"
                            checked={checked}
                            onChange={() => toggleCourse(course.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-cl-fg truncate">
                              {course.title}
                              {Number(course.level) > 1 ? ` · ${t('common.level', { level: course.level })}` : ''}
                            </span>
                            <span className="block text-xs text-cl-muted truncate">
                              {[
                                course.code,
                                course.category,
                                course.assessmentQuizId
                                  ? t('log.linkedAssessmentShort')
                                  : t('log.noLinkedAssessmentShort'),
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="text-xs text-cl-muted">
              {t('log.needNewCourse')}{' '}
              <Link to="/courses" className="text-cl-accent hover:underline">
                {t('log.addToCatalogue')}
              </Link>
              .
            </p>
          </div>
        )}

        {!assignMode && selectedCourse && (
          <p className="text-xs text-cl-muted">
            {t('log.validity')}{' '}
            {selectedCourse.validityMonths
              ? t('courses.validityMonths', { n: selectedCourse.validityMonths })
              : t('courses.noExpiry')}
            {selectedCourse.category ? ` · ${selectedCourse.category}` : ''}
            {Number(selectedCourse.level) > 1 ? ` · ${t('common.level', { level: selectedCourse.level })}` : ''}
            {selectedCourse.assessmentQuizId
              ? ` · ${t('log.linkedAssessment', { title: selectedCourse.assessmentQuizTitle || t('source.assessment') })}`
              : ` · ${t('log.noLinkedAssessment')}`}
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

        {!assignMode && (
          <label className="flex items-center gap-2 text-sm text-cl-muted">
            <input
              type="checkbox"
              checked={createCertificate}
              onChange={(e) => setCreateCertificate(e.target.checked)}
            />
            {t('log.issueCertificate')}
          </label>
        )}
        {assignMode && selectedCourseCount > 0 && (
          <p className="text-xs text-cl-muted">
            {linkedAssessmentCount > 0
              ? t('log.assignCertMappedMulti', {
                  mapped: linkedAssessmentCount,
                  total: selectedCourseCount,
                })
              : t('log.assignCertManual')}
          </p>
        )}

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
              <button type="button" className="cl-btn-ghost text-xs" onClick={selectVisiblePeople}>
                {t('log.selectVisible')}
              </button>
              <button type="button" className="cl-btn-ghost text-xs" onClick={clearPeople}>
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
              {assignMode
                ? t('log.assignedMulti', {
                    courses: result.totals?.courses || result.courses?.length || 1,
                    people: result.totals?.people || selectedCount,
                    count: result.totals?.requested || 0,
                  })
                : t('log.logged', { course: courseLabel, count: result.totals?.requested || 0 })}
              {result.totals?.failed
                ? t('log.failedCount', { count: result.totals.failed })
                : ''}
              .
            </p>
            <p className="text-xs text-cl-muted">
              {t('log.summary', { created: result.totals?.created || 0, updated: result.totals?.updated || 0 })}
              {result.totals?.alreadyHeld
                ? t('log.alreadyHeld', { count: result.totals.alreadyHeld })
                : ''}
              {!assignMode && createCertificate
                ? t('log.certsProcessed', { count: result.totals?.certificates || 0 })
                : ''}
            </p>
            {(result.results || []).some((row) => !row.ok) && (
              <ul className="text-xs text-rose-300 space-y-1 pt-1">
                {result.results
                  .filter((row) => !row.ok)
                  .map((row) => (
                    <li key={`${row.employeeUid}-${row.courseId || row.courseTitle || ''}`}>
                      {row.employeeName || row.employeeUid}
                      {row.courseTitle ? ` · ${row.courseTitle}` : ''}
                      : {row.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="submit"
          className="cl-btn-primary"
          disabled={saving || selectedCourseCount === 0 || selectedCount === 0}
        >
          {saving
            ? t('log.savingCount', { count: assignmentTotal || selectedCount })
            : selectedCourseCount === 0
              ? t('log.selectCourses')
              : selectedCount === 0
                ? t('log.selectAttendees')
                : assignMode
                  ? selectedCourseCount === 1 && selectedCount === 1
                    ? t('log.assignOne')
                    : t('log.assignMatrix', { courses: selectedCourseCount, people: selectedCount })
                  : selectedCount === 1
                    ? t('log.submitOne')
                    : t('log.submitMany', { count: selectedCount })}
        </button>
      </form>
    </div>
  );
}
