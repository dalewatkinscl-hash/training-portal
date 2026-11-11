import { useEffect, useMemo, useState } from 'react';
import {
  completeTrainingRequest,
  createTrainingRequest,
  deleteTrainingRequest,
  fetchCourses,
  fetchTrainingRequestStaff,
  fetchTrainingRequests,
} from '../lib/api';
import {
  AD_HOC_COURSE,
  TRAINING_PRIORITIES,
  groupCompletedRequests,
  sortOpenRequests,
} from '../lib/trainingRequests';
import { useI18n } from '../i18n/LanguageProvider';

const PRIORITY_LABEL = {
  low: 'requests.priorityLow',
  medium: 'requests.priorityMedium',
  high: 'requests.priorityHigh',
};

function priorityClass(value, current) {
  const selected = value === current;
  if (!selected) return 'border-cl-border text-cl-muted hover:text-cl-fg hover:bg-white/[0.04]';
  if (value === 'high') return 'border-rose-400/60 bg-rose-500/15 text-rose-100';
  if (value === 'low') return 'border-sky-400/60 bg-sky-500/15 text-sky-100';
  return 'border-amber-400/60 bg-amber-500/15 text-amber-100';
}

function priorityBadge(priority) {
  if (priority === 'high') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  if (priority === 'low') return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
}

function staffName(person) {
  return person?.employeeName || person?.employeeEmail || '—';
}

function peopleLabel(count, t) {
  if (count === 1) return t('requests.personCount');
  return t('requests.peopleCount', { count });
}

function requesterText(item, t) {
  const name = item.requestedByName || item.requestedByEmail || '—';
  if (item.requestedByJobTitle) {
    return t('requests.requestedByTitle', { name, title: item.requestedByJobTitle });
  }
  return t('requests.requestedBy', { name });
}

export default function TrainingRequestPage() {
  const { t, formatDate, locale } = useI18n();
  const [tab, setTab] = useState('new');
  const [courses, setCourses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [requests, setRequests] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [adHocTitle, setAdHocTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [staffQuery, setStaffQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState('');
  const [removingId, setRemovingId] = useState('');
  const [confirmingId, setConfirmingId] = useState('');
  const [removeKey, setRemoveKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadRequests = async () => {
    const response = await fetchTrainingRequests();
    if (!response.ok) throw new Error(response.error || 'Failed to load training requests.');
    setRequests(response.requests || []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [courseResponse, staffResponse, requestResponse] = await Promise.all([
          fetchCourses(),
          fetchTrainingRequestStaff(),
          fetchTrainingRequests(),
        ]);
        if (cancelled) return;
        if (courseResponse.ok) {
          setCourses((courseResponse.courses || []).filter((course) => course.active !== false));
        } else {
          setError(courseResponse.error || 'Failed to load courses.');
        }
        if (!staffResponse.ok) throw new Error(staffResponse.error || 'Failed to load staff.');
        if (!requestResponse.ok) throw new Error(requestResponse.error || 'Failed to load training requests.');
        setStaff(staffResponse.staff || []);
        setRequests(requestResponse.requests || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load training requests.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogue = useMemo(() => (
    [...courses].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), locale, {
      sensitivity: 'base',
    }))
  ), [courses, locale]);

  const departments = useMemo(() => (
    [...new Set(staff.map((person) => person.department).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }))
  ), [staff, locale]);

  const filteredStaff = useMemo(() => {
    const query = staffQuery.trim().toLowerCase();
    const dept = department.trim().toLowerCase();
    return staff
      .filter((person) => {
        if (dept && String(person.department || '').toLowerCase() !== dept) return false;
        if (!query) return true;
        const haystack = [person.employeeName, person.employeeEmail, person.department]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => staffName(a).localeCompare(staffName(b), locale, { sensitivity: 'base' }));
  }, [staff, staffQuery, department, locale]);

  const openRequests = useMemo(() => sortOpenRequests(requests), [requests]);
  const completedGroups = useMemo(() => groupCompletedRequests(requests), [requests]);
  const completedPeople = completedGroups.reduce((sum, group) => sum + group.people.length, 0);
  const selectedCourse = catalogue.find((course) => course.id === courseId) || null;
  const adHoc = courseId === AD_HOC_COURSE;

  const selectTab = (next) => {
    setTab(next);
    setError('');
    setMessage('');
    setConfirmingId('');
    setRemoveKey('');
  };

  const onRemove = async (id, employeeUid = '') => {
    setRemovingId(id);
    setError('');
    setMessage('');
    try {
      const response = await deleteTrainingRequest(id, employeeUid);
      if (!response.ok) throw new Error(response.error || 'Failed to remove the training request.');
      setRemoveKey('');
      setMessage(t('requests.removed'));
      await loadRequests();
    } catch (err) {
      setError(err.message || 'Failed to remove the training request.');
    } finally {
      setRemovingId('');
    }
  };

  const togglePerson = (uid) => {
    setError('');
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
      filteredStaff.forEach((person) => next.add(person.employeeUid));
      return next;
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!courseId) {
      setError(t('requests.selectCourseError'));
      return;
    }
    if (adHoc && !adHocTitle.trim()) {
      setError(t('requests.adHocRequired'));
      return;
    }
    if (!selected.size) {
      setError(t('requests.selectStaffError'));
      return;
    }

    setSaving(true);
    try {
      const response = await createTrainingRequest({
        courseId: adHoc ? '' : courseId,
        adHocTitle: adHoc ? adHocTitle.trim() : '',
        priority,
        notes,
        employeeUids: [...selected],
      });
      if (!response.ok) throw new Error(response.error || 'Failed to send the training request.');
      setCourseId('');
      setAdHocTitle('');
      setNotes('');
      setPriority('medium');
      setSelected(new Set());
      setMessage(t('requests.saved'));
      setTab('open');
      await loadRequests();
    } catch (err) {
      setError(err.message || 'Failed to send the training request.');
    } finally {
      setSaving(false);
    }
  };

  const onComplete = async (id) => {
    setCompletingId(id);
    setError('');
    setMessage('');
    try {
      const response = await completeTrainingRequest(id);
      if (!response.ok) {
        await loadRequests();
        throw new Error(response.error || 'Failed to complete the request.');
      }
      setConfirmingId('');
      setMessage(t('requests.markedComplete'));
      setTab('completed');
      await loadRequests();
    } catch (err) {
      setError(err.message || 'Failed to complete the request.');
    } finally {
      setCompletingId('');
    }
  };

  const tabClass = (id) => (
    `px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
      tab === id
        ? 'bg-cl-accent/20 text-[#c7cbf5] border-cl-accent/40'
        : 'text-cl-muted hover:text-cl-fg hover:bg-white/[0.04] border-transparent'
    }`
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('requests.title')}</h2>
        <p className="text-sm text-cl-muted mt-1 max-w-3xl">{t('requests.subtitle')}</p>
      </div>

      <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t('requests.title')}>
        <button type="button" role="tab" aria-selected={tab === 'new'} className={tabClass('new')} onClick={() => selectTab('new')}>
          {t('requests.tabNew')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'open'} className={tabClass('open')} onClick={() => selectTab('open')}>
          {t('requests.tabOpen')}
          {openRequests.length > 0 && (
            <span className="ml-2 inline-flex min-w-[1.25rem] justify-center rounded-full bg-cl-accent/25 px-1.5 text-xs text-[#c7cbf5]">
              {openRequests.length}
            </span>
          )}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'completed'} className={tabClass('completed')} onClick={() => selectTab('completed')}>
          {t('requests.tabCompleted')}
        </button>
      </div>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      {message && <p className="text-sm text-emerald-300" role="status">{message}</p>}

      {loading ? (
        <p className="text-sm text-cl-muted">{t('requests.loading')}</p>
      ) : tab === 'new' ? (
        <form onSubmit={onSubmit} className="cl-card p-5 space-y-5">
          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">{t('requests.fieldCourse')}</span>
            <select
              className="cl-input"
              value={courseId}
              onChange={(event) => {
                setCourseId(event.target.value);
                setError('');
              }}
            >
              <option value="">{t('requests.selectCourse')}</option>
              {catalogue.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.code ? ` (${course.code})` : ''}
                </option>
              ))}
              <option value={AD_HOC_COURSE}>{t('requests.adHocOption')}</option>
            </select>
          </label>

          {selectedCourse && (
            <p className="text-xs text-cl-muted -mt-3">
              {[selectedCourse.code, selectedCourse.category].filter(Boolean).join(' · ')}
            </p>
          )}

          {adHoc && (
            <label className="block text-sm space-y-1.5">
              <span className="text-cl-muted">{t('requests.adHocTitle')}</span>
              <input
                className="cl-input"
                value={adHocTitle}
                onChange={(event) => setAdHocTitle(event.target.value)}
                placeholder={t('requests.adHocPlaceholder')}
                maxLength={180}
                required
              />
            </label>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-cl-fg">{t('requests.fieldStaff')}</h3>
                <p className="text-xs text-cl-muted mt-0.5">
                  {t('requests.staffHint')}
                  {' '}
                  {t('requests.staffSelected', { count: selected.size })}
                  {filteredStaff.length !== staff.length
                    ? ` · ${t('requests.showing', { shown: filteredStaff.length, total: staff.length })}`
                    : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="cl-btn-ghost text-xs" onClick={selectVisible}>
                  {t('requests.selectVisible')}
                </button>
                <button type="button" className="cl-btn-ghost text-xs" onClick={() => setSelected(new Set())}>
                  {t('requests.clear')}
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm space-y-1.5">
                <span className="text-xs text-cl-muted">{t('common.search')}</span>
                <input
                  className="cl-input"
                  value={staffQuery}
                  onChange={(event) => setStaffQuery(event.target.value)}
                  placeholder={t('requests.staffSearch')}
                />
              </label>
              <label className="text-sm space-y-1.5">
                <span className="text-xs text-cl-muted">{t('common.department')}</span>
                <select
                  className="cl-input"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                >
                  <option value="">{t('common.all')}</option>
                  {departments.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="border border-cl-border rounded-xl max-h-72 overflow-y-auto">
              {staff.length === 0 ? (
                <p className="p-4 text-sm text-cl-muted">{t('requests.noStaff')}</p>
              ) : filteredStaff.length === 0 ? (
                <p className="p-4 text-sm text-cl-muted">{t('requests.noStaffMatch')}</p>
              ) : (
                <ul className="divide-y divide-cl-border/60">
                  {filteredStaff.map((person) => {
                    const checked = selected.has(person.employeeUid);
                    return (
                      <li key={person.employeeUid}>
                        <label
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                            checked ? 'bg-cl-accent/10' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-indigo-500"
                            checked={checked}
                            onChange={() => togglePerson(person.employeeUid)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-cl-fg truncate">{staffName(person)}</span>
                            <span className="block text-xs text-cl-muted truncate">
                              {[person.employeeEmail, person.department].filter(Boolean).join(' · ') || '—'}
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

          <fieldset className="space-y-2">
            <legend className="text-sm text-cl-muted">{t('requests.fieldPriority')}</legend>
            <div role="tablist" aria-label={t('requests.fieldPriority')} className="grid grid-cols-3 gap-2">
              {TRAINING_PRIORITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={priority === value}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${priorityClass(value, priority)}`}
                  onClick={() => {
                    setPriority(value);
                    setError('');
                  }}
                >
                  {t(PRIORITY_LABEL[value])}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm space-y-1.5">
            <span className="text-cl-muted">{t('requests.notes')}</span>
            <textarea
              className="cl-input min-h-[80px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('requests.notesPlaceholder')}
              maxLength={2000}
            />
          </label>

          <button type="submit" className="cl-btn-primary" disabled={saving}>
            {saving
              ? t('requests.submitting')
              : selected.size
                ? t('requests.submitFor', { count: selected.size })
                : t('requests.submit')}
          </button>
        </form>
      ) : tab === 'open' ? (
        <div className="space-y-3">
          {openRequests.length === 0 ? (
            <div className="cl-card p-8 text-center text-sm text-cl-muted">{t('requests.emptyOpen')}</div>
          ) : openRequests.map((request) => {
            const confirming = confirmingId === request.id;
            const completing = completingId === request.id;
            const removing = removingId === request.id;
            const confirmingRemove = removeKey === request.id;
            return (
              <article key={request.id} className="cl-card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-cl-fg break-words">{request.courseTitle}</h3>
                    <p className="text-xs text-cl-muted mt-1">
                      {[
                        request.courseCode,
                        request.adHoc ? t('requests.notInCatalogue') : '',
                        peopleLabel(request.people?.length || 0, t),
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`cl-badge ${priorityBadge(request.priority)}`}>
                    {t(PRIORITY_LABEL[request.priority] || PRIORITY_LABEL.medium)}
                  </span>
                </div>

                <ul className="space-y-1">
                  {(request.people || []).map((person, index) => (
                    <li key={`${person.employeeUid || 'person'}-${index}`} className="text-sm text-cl-fg">
                      {staffName(person)}
                      {(person.department || person.employeeEmail) && (
                        <span className="text-cl-muted">
                          {' · '}
                          {[person.department, person.employeeEmail].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <p className="text-xs text-cl-muted">
                  {requesterText(request, t)}
                  {request.createdAt ? ` · ${t('requests.requestedOn', { date: formatDate(request.createdAt) })}` : ''}
                </p>
                {request.notes && (
                  <p className="text-sm text-cl-fg whitespace-pre-wrap break-words">{request.notes}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs"
                        disabled={completing}
                        onClick={() => setConfirmingId('')}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="cl-btn-primary text-xs px-3 py-2"
                        disabled={completing}
                        onClick={() => onComplete(request.id)}
                      >
                        {completing ? t('requests.markingComplete') : t('requests.confirmComplete')}
                      </button>
                    </>
                  ) : confirmingRemove ? (
                    <>
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs"
                        disabled={removing}
                        onClick={() => setRemoveKey('')}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs text-rose-300 border-rose-400/40 hover:bg-rose-500/10"
                        disabled={removing}
                        onClick={() => onRemove(request.id)}
                      >
                        {removing ? t('action.removing') : t('action.confirmRemove')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs"
                        disabled={Boolean(completingId || removingId)}
                        onClick={() => {
                          setRemoveKey('');
                          setConfirmingId(request.id);
                        }}
                      >
                        {t('requests.markComplete')}
                      </button>
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
                        disabled={Boolean(completingId || removingId)}
                        onClick={() => {
                          setConfirmingId('');
                          setRemoveKey(request.id);
                        }}
                      >
                        {t('common.remove')}
                      </button>
                    </>
                  )}
                  {!confirmingRemove && (
                    <span className="text-xs text-cl-muted">{t('requests.markCompleteHint')}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {completedGroups.length > 0 && (
            <p className="text-sm text-cl-muted">
              {t('requests.completedSummary', {
                people: peopleLabel(completedPeople, t),
                courses: completedGroups.length === 1
                  ? t('requests.courseCount')
                  : t('requests.coursesCount', { count: completedGroups.length }),
              })}
            </p>
          )}
          {completedGroups.length === 0 ? (
            <div className="cl-card p-8 text-center text-sm text-cl-muted">{t('requests.emptyCompleted')}</div>
          ) : completedGroups.map((group) => (
            <section key={group.key} className="cl-card overflow-hidden">
              <header className="px-4 py-3 border-b border-cl-border flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-cl-fg break-words">{group.courseTitle}</h3>
                  <p className="text-xs text-cl-muted mt-0.5">
                    {[
                      group.courseCode,
                      group.adHoc ? t('requests.notInCatalogue') : '',
                      peopleLabel(group.people.length, t),
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </header>
              <ul className="divide-y divide-cl-border/60">
                {group.people.map((person) => {
                  const rowKey = person.key;
                  const confirmingRemove = removeKey === rowKey;
                  return (
                  <li key={rowKey} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-cl-fg">{staffName(person)}</p>
                        <p className="text-xs text-cl-muted mt-0.5">
                          {[person.department, person.employeeEmail].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`cl-badge ${priorityBadge(person.priority)}`}>
                          {t(PRIORITY_LABEL[person.priority] || PRIORITY_LABEL.medium)}
                        </span>
                        {confirmingRemove ? (
                          <>
                            <button
                              type="button"
                              className="cl-btn-ghost text-xs"
                              disabled={removingId === person.requestId}
                              onClick={() => setRemoveKey('')}
                            >
                              {t('common.cancel')}
                            </button>
                            <button
                              type="button"
                              className="cl-btn-ghost text-xs text-rose-300 border-rose-400/40 hover:bg-rose-500/10"
                              disabled={removingId === person.requestId}
                              onClick={() => onRemove(person.requestId, person.employeeUid)}
                            >
                              {removingId === person.requestId ? t('action.removing') : t('action.confirmRemove')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="cl-btn-ghost text-xs text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
                            disabled={Boolean(removingId)}
                            onClick={() => setRemoveKey(rowKey)}
                          >
                            {t('common.remove')}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-cl-muted mt-2">
                      {requesterText(person, t)}
                      {person.createdAt ? ` · ${t('requests.requestedOn', { date: formatDate(person.createdAt) })}` : ''}
                      {person.completedAt ? ` · ${t('requests.completedOn', { date: formatDate(person.completedAt) })}` : ''}
                      {person.completedByName ? ` · ${t('requests.completedBy', { name: person.completedByName })}` : ''}
                    </p>
                    {person.notes && (
                      <p className="text-sm text-cl-fg mt-2 whitespace-pre-wrap break-words">{person.notes}</p>
                    )}
                    {person.sharePointWebUrl ? (
                      <a
                        href={person.sharePointWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-sm text-cl-accent hover:text-cl-accent-bright mt-2"
                      >
                        {t('common.certificate')}
                      </a>
                    ) : person.certificatePendingSharePoint ? (
                      <p className="text-xs text-amber-200/80 mt-2">{t('table.pendingSharePoint')}</p>
                    ) : !person.completionId ? (
                      <button
                        type="button"
                        className="cl-btn-ghost text-xs mt-2"
                        disabled={completingId === person.requestId}
                        onClick={() => onComplete(person.requestId)}
                      >
                        {completingId === person.requestId ? t('requests.markingComplete') : t('requests.issueCertificate')}
                      </button>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
