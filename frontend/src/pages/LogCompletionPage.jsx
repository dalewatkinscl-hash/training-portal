import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createCompletionsBatch, fetchCourses, fetchEmployees } from '../lib/api';

export default function LogCompletionPage() {
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
          'en',
          { sensitivity: 'base' },
        ),
      );
  }, [employees, q, department]);

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
      setError('Select a course from the catalogue.');
      return;
    }
    if (!selectedCount) {
      setError('Select at least one person.');
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
          <h2 className="text-xl font-semibold text-cl-fg">Log a course</h2>
          <p className="text-sm text-cl-muted mt-1">
            Set the course date, pick the course, tick everyone who attended, then submit once.
            Each person&apos;s record is updated and a certificate is issued.
          </p>
        </div>
        <Link to="/courses" className="cl-btn-ghost">
          Manage catalogue
        </Link>
      </div>

      <form onSubmit={onSubmit} className="cl-card p-5 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">Date of course</span>
            <input
              className="cl-input"
              type="date"
              required
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
            />
          </label>

          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">Course</span>
            <select
              className="cl-input"
              required
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Select from catalogue…</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.code ? ` (${course.code})` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-cl-muted">
              Need a new course?{' '}
              <Link to="/courses" className="text-cl-accent hover:underline">
                Add it to the catalogue
              </Link>
              .
            </p>
          </label>
        </div>

        {selectedCourse && (
          <p className="text-xs text-cl-muted">
            Validity:{' '}
            {selectedCourse.validityMonths
              ? `${selectedCourse.validityMonths} months`
              : 'no expiry'}
            {selectedCourse.category ? ` · ${selectedCourse.category}` : ''}
          </p>
        )}

        <label className="block text-sm space-y-1.5">
          <span className="text-cl-muted">Notes (optional)</span>
          <textarea
            className="cl-input min-h-[72px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Trainer, location, group…"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-cl-muted">
          <input
            type="checkbox"
            checked={createCertificate}
            onChange={(e) => setCreateCertificate(e.target.checked)}
          />
          Issue certificate for each person (upload to SharePoint)
        </label>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-cl-fg">Attendees</h3>
              <p className="text-xs text-cl-muted mt-0.5">
                {selectedCount} selected
                {filteredEmployees.length !== employees.length
                  ? ` · showing ${filteredEmployees.length} of ${employees.length}`
                  : ` · ${employees.length} people`}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="cl-btn-ghost text-xs" onClick={selectVisible}>
                Select visible
              </button>
              <button type="button" className="cl-btn-ghost text-xs" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-sm space-y-1.5">
              <span className="text-xs text-cl-muted">Search</span>
              <input
                className="cl-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, email, department…"
              />
            </label>
            <label className="text-sm space-y-1.5">
              <span className="text-xs text-cl-muted">Department</span>
              <select
                className="cl-input"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
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
              <p className="p-4 text-sm text-cl-muted">Loading people…</p>
            ) : filteredEmployees.length === 0 ? (
              <p className="p-4 text-sm text-cl-muted">No people match these filters.</p>
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
                            {person.employeeName || 'Unnamed'}
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
              {result.course?.title || 'Course'} logged for {result.totals?.requested || 0} people
              {result.totals?.failed
                ? ` (${result.totals.failed} failed)`
                : ''}.
            </p>
            <p className="text-xs text-cl-muted">
              {result.totals?.created || 0} new · {result.totals?.updated || 0} updated
              {createCertificate
                ? ` · ${result.totals?.certificates || 0} certificates processed`
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
            ? `Saving ${selectedCount}…`
            : selectedCount === 0
              ? 'Select attendees'
              : selectedCount === 1
                ? 'Submit for 1 person'
                : `Submit for ${selectedCount} people`}
        </button>
      </form>
    </div>
  );
}
