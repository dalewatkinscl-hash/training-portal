import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  backfillCertificates,
  confirmTrainingMapping,
  fetchAssessmentMaps,
  fetchTrainingMappings,
  importTrainingMatrix,
  saveAssessmentMap,
  autoMapAssessmentCourses,
} from '../lib/api';
import { useI18n } from '../i18n/LanguageProvider';

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreFolderMatch(employeeName, folderName) {
  const left = normalizeLabel(employeeName);
  const right = normalizeLabel(folderName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (right.startsWith(left) || left.startsWith(right)) return 80;
  const leftParts = left.split(' ');
  const rightParts = right.split(' ');
  const overlap = leftParts.filter((part) => rightParts.includes(part)).length;
  if (overlap === 0) return 0;
  return Math.round((overlap / Math.max(leftParts.length, rightParts.length)) * 70);
}

function bestFolderForProfile(profile, folders) {
  const current = profile.trainingFolderName || '';
  if (current && folders.some((folder) => folder.name === current)) {
    return current;
  }

  const ranked = folders
    .map((folder) => ({
      name: folder.name,
      score: scoreFolderMatch(profile.employeeName || profile.matrixName || '', folder.name),
    }))
    .filter((folder) => folder.score >= 70)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return ranked[0]?.name || '';
}

export default function AdminPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingUid, setSavingUid] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [backfillResult, setBackfillResult] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [unmappedFolders, setUnmappedFolders] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [sharePointConfigured, setSharePointConfigured] = useState(false);
  const [filter, setFilter] = useState('all');
  const [quizzes, setQuizzes] = useState([]);
  const [courses, setCourses] = useState([]);
  const [assessmentMaps, setAssessmentMaps] = useState({});
  const [mapDrafts, setMapDrafts] = useState({});
  const [savingQuizId, setSavingQuizId] = useState('');
  const [quizzesAvailable, setQuizzesAvailable] = useState(true);

  const load = async () => {
    const [mappingResponse, assessmentResponse] = await Promise.all([
      fetchTrainingMappings(),
      fetchAssessmentMaps(),
    ]);
    if (!mappingResponse.ok) throw new Error(mappingResponse.error || 'Failed to load mappings.');
    const nextProfiles = mappingResponse.profiles || [];
    const nextFolders = mappingResponse.folders || [];
    setProfiles(nextProfiles);
    setFolders(nextFolders);
    setUnmappedFolders(mappingResponse.unmappedFolders || []);
    setSharePointConfigured(Boolean(mappingResponse.sharePointConfigured));

    const nextDrafts = {};
    nextProfiles.forEach((profile) => {
      nextDrafts[profile.employeeUid] = bestFolderForProfile(profile, nextFolders);
    });
    setDrafts(nextDrafts);

    if (assessmentResponse.ok) {
      const nextQuizzes = assessmentResponse.quizzes || [];
      const nextCourses = assessmentResponse.courses || [];
      const mapsByQuiz = {};
      (assessmentResponse.maps || []).forEach((map) => {
        mapsByQuiz[String(map.quizId)] = map;
      });
      setQuizzes(nextQuizzes);
      setCourses(nextCourses);
      setAssessmentMaps(mapsByQuiz);
      setQuizzesAvailable(assessmentResponse.quizzesAvailable !== false);
      const nextMapDrafts = {};
      nextQuizzes.forEach((quiz) => {
        const existing = mapsByQuiz[String(quiz.id)];
        if (existing?.courseId) {
          nextMapDrafts[String(quiz.id)] = existing.courseId;
          return;
        }
        // Suggest Phishing Awareness for Phishing Assessment, etc.
        const suggested = nextCourses.find((course) => {
          const quizLabel = normalizeLabel(quiz.title);
          const courseLabel = normalizeLabel(course.title);
          return courseLabel && quizLabel
            && (courseLabel.includes(quizLabel) || quizLabel.includes(courseLabel)
              || quizLabel.split(' ').some((part) => part.length > 4 && courseLabel.includes(part)));
        });
        nextMapDrafts[String(quiz.id)] = suggested?.id || '';
      });
      setMapDrafts(nextMapDrafts);
    } else {
      setQuizzesAvailable(false);
      console.warn('Failed to load assessment maps', assessmentResponse.error);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load admin data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const folderOptions = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  const mappedFolderSet = useMemo(() => {
    const set = new Set();
    profiles.forEach((profile) => {
      if (profile.trainingFolderConfirmedAt && profile.trainingFolderName) {
        set.add(normalizeLabel(profile.trainingFolderName));
      }
    });
    return set;
  }, [profiles]);

  const visibleProfiles = useMemo(() => {
    if (filter === 'unconfirmed') {
      return profiles.filter((profile) => !profile.trainingFolderConfirmedAt);
    }
    if (filter === 'confirmed') {
      return profiles.filter((profile) => profile.trainingFolderConfirmedAt);
    }
    return profiles;
  }, [filter, profiles]);

  const runImport = async () => {
    setImporting(true);
    setError('');
    setMessage('');
    setImportResult(null);
    try {
      const response = await importTrainingMatrix();
      if (!response.ok) throw new Error(response.error || 'Import failed.');
      setImportResult(response);
      setMessage(
        t('admin.importSummary', {
          created: response.summary?.completionsCreated || 0,
          updated: response.summary?.completionsUpdated || 0,
        }),
      );
      await load();
    } catch (err) {
      setError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const runBackfillCertificates = async ({ continueUntilDone = false } = {}) => {
    setBackfilling(true);
    setError('');
    setMessage('');
    try {
      let remaining = 1;
      let totalProcessed = 0;
      let totalSucceeded = 0;
      let totalFailed = 0;
      let lastResult = null;

      while (remaining > 0) {
        const response = await backfillCertificates({ limit: 25 });
        if (!response.ok) throw new Error(response.error || 'Certificate backfill failed.');
        lastResult = response;
        totalProcessed += response.processed || 0;
        totalSucceeded += response.succeeded || 0;
        totalFailed += response.failed || 0;
        remaining = response.remaining || 0;
        setBackfillResult({
          ...response,
          processed: totalProcessed,
          succeeded: totalSucceeded,
          failed: totalFailed,
        });
        setMessage(
          t('admin.certsProgress', {
            succeeded: totalSucceeded,
            failed: totalFailed,
            remaining,
          }),
        );
        if (!continueUntilDone || remaining === 0) break;
      }

      if (lastResult && (lastResult.remaining || 0) === 0 && totalProcessed === 0) {
        setMessage(t('admin.certsAlready'));
      }
    } catch (err) {
      setError(err.message || 'Certificate backfill failed.');
    } finally {
      setBackfilling(false);
    }
  };

  const confirmMapping = async (profile) => {
    const trainingFolderName = String(drafts[profile.employeeUid] || '').trim();
    if (!trainingFolderName) {
      setError(t('admin.chooseFolder'));
      return;
    }

    const folderExists = folderOptions.some((folder) => folder.name === trainingFolderName);
    if (!folderExists) {
      setError(t('admin.folderMissing', { name: trainingFolderName }));
      return;
    }

    setSavingUid(profile.employeeUid);
    setError('');
    try {
      const response = await confirmTrainingMapping({
        employeeUid: profile.employeeUid,
        employeeName: profile.employeeName,
        employeeEmail: profile.employeeEmail,
        trainingFolderName,
        createIfMissing: false,
      });
      if (!response.ok) throw new Error(response.error || 'Failed to save mapping.');
      setMessage(t('admin.mappedEmployee', { name: profile.employeeName, folder: trainingFolderName }));
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save mapping.');
    } finally {
      setSavingUid('');
    }
  };

  const saveQuizCourseMap = async (quiz) => {
    const courseId = String(mapDrafts[String(quiz.id)] || '').trim();
    if (!courseId) {
      setError(t('admin.chooseCourseForQuiz'));
      return;
    }
    setSavingQuizId(String(quiz.id));
    setError('');
    setMessage('');
    try {
      const response = await saveAssessmentMap({
        quizId: String(quiz.id),
        quizTitle: quiz.title || '',
        courseId,
        mergeDuplicates: true,
      });
      if (!response.ok) throw new Error(response.error || 'Failed to save assessment map.');
      const course = courses.find((row) => row.id === courseId);
      const merge = response.merge || {};
      setMessage(
        t('admin.mappedQuiz', { quiz: quiz.title, course: course?.title || response.map?.courseTitle || t('common.course') })
        + (merge.mergedEmployees
          ? t('admin.mergedRecords', { employees: merge.mergedEmployees, deleted: merge.deleted || 0 })
          : ''),
      );
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save assessment map.');
    } finally {
      setSavingQuizId('');
    }
  };

  if (loading) return <p className="text-cl-muted text-sm">{t('admin.loading')}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">{t('admin.title')}</h2>
        <p className="text-sm text-cl-muted mt-1">
          {t('admin.subtitle')}
        </p>
      </div>

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">{t('admin.amendTitle')}</h3>
        <p className="text-sm text-cl-muted">
          {t('admin.amendBody')}
        </p>
        <Link to="/admin/amend" className="cl-btn-primary inline-flex">
          {t('admin.openAmend')}
        </Link>
      </section>

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">{t('admin.quizMapTitle')}</h3>
        <p className="text-sm text-cl-muted">
          {t('admin.quizMapBody')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="cl-btn-ghost"
            disabled={savingQuizId === '__auto__'}
            onClick={async () => {
              setSavingQuizId('__auto__');
              setError('');
              setMessage('');
                  try {
                const response = await autoMapAssessmentCourses();
                if (!response.ok) throw new Error(response.error || 'Auto-map failed.');
                setMessage(
                  t('admin.autoMapped', { created: response.created?.length || 0 })
                  + (response.skipped?.length ? t('admin.skipped', { count: response.skipped.length }) : ''),
                );
                await load();
              } catch (err) {
                setError(err.message || 'Auto-map failed.');
              } finally {
                setSavingQuizId('');
              }
            }}
          >
            {savingQuizId === '__auto__' ? t('admin.mapping') : t('admin.autoMap')}
          </button>
        </div>
        {!quizzesAvailable && (
          <p className="text-sm text-amber-200">
            {t('admin.quizzesUnavailable')}
          </p>
        )}
        {!quizzes.length ? (
          <p className="text-sm text-cl-muted">{t('admin.noQuizzes')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                  <th className="px-3 py-2 font-medium">{t('admin.assessmentQuiz')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.trainingCourse')}</th>
                  <th className="px-3 py-2 font-medium">{t('common.status')}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {quizzes.map((quiz) => {
                  const quizId = String(quiz.id);
                  const saved = assessmentMaps[quizId];
                  const draftCourseId = mapDrafts[quizId] || '';
                  return (
                    <tr key={quizId} className="border-b border-cl-border/60 last:border-0">
                      <td className="px-3 py-2.5 text-cl-fg font-medium">
                        {quiz.title || t('admin.untitledQuiz')}
                        <div className="text-xs text-cl-muted font-normal">{t('admin.quizId', { id: quizId })}</div>
                      </td>
                      <td className="px-3 py-2.5 min-w-[240px]">
                        <select
                          className="cl-input w-full"
                          value={draftCourseId}
                          onChange={(e) => setMapDrafts((prev) => ({
                            ...prev,
                            [quizId]: e.target.value,
                          }))}
                        >
                          <option value="">{t('admin.selectCourse')}</option>
                          {courses.map((course) => (
                            <option key={course.id} value={course.id}>
                              {course.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">
                        {saved?.courseId
                          ? t('admin.mappedTo', { title: saved.courseTitle || t('common.course') })
                          : t('admin.notMapped')}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          className="cl-btn-primary"
                          disabled={savingQuizId === quizId || !draftCourseId}
                          onClick={() => saveQuizCourseMap(quiz)}
                        >
                          {savingQuizId === quizId ? t('common.saving') : t('admin.saveMap')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error && (
        <div className="cl-card border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="cl-card border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">{t('admin.importTitle')}</h3>
        <p className="text-sm text-cl-muted">
          {t('admin.importBody')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-sm text-cl-muted file:mr-3 file:rounded-lg file:border-0 file:bg-cl-accent/20 file:px-3 file:py-1.5 file:text-sm file:text-[#c7cbf5]"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImporting(true);
              setError('');
              setMessage('');
              setImportResult(null);
              try {
                const csvText = await file.text();
                const response = await importTrainingMatrix(csvText);
                if (!response.ok) throw new Error(response.error || 'Import failed.');
                setImportResult(response);
                setMessage(
                  t('admin.importSummary', {
                    created: response.summary?.completionsCreated || 0,
                    updated: response.summary?.completionsUpdated || 0,
                  }),
                );
                await load();
              } catch (err) {
                setError(err.message || 'Import failed.');
              } finally {
                setImporting(false);
                event.target.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={runImport}
            disabled={importing}
            className="cl-btn-primary disabled:opacity-50"
          >
            {importing ? t('admin.importing') : t('admin.importBundled')}
          </button>
        </div>

        {importResult?.summary && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {[
              [t('admin.statRows'), importResult.summary.rows],
              [t('admin.statMatched'), importResult.summary.employeesMatched],
              [t('admin.statCreated'), importResult.summary.completionsCreated],
              [t('admin.statUpdated'), importResult.summary.completionsUpdated],
              [t('admin.statCourses'), importResult.summary.coursesCreated],
              [t('admin.statUnmatched'), importResult.summary.employeesUnmatched],
              [t('admin.statAmbiguous'), importResult.summary.employeesAmbiguous],
              [t('admin.statSkipped'), importResult.summary.completionsSkipped],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-cl-border bg-black/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-cl-muted">{label}</p>
                <p className="text-lg text-cl-fg font-semibold">{value ?? 0}</p>
              </div>
            ))}
          </div>
        )}

        {importResult?.unmatched?.length > 0 && (
          <div className="pt-2">
            <p className="text-sm text-amber-200 mb-2">{t('admin.unmatchedTitle')}</p>
            <ul className="text-sm text-cl-muted space-y-1 max-h-40 overflow-y-auto">
              {importResult.unmatched.map((row) => (
                <li key={row.employeeName}>
                  {row.employeeName}
                  {row.department ? ` · ${row.department}` : ''}
                  {` · ${t('admin.rowCount', { count: row.rowCount })}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {importResult?.ambiguous?.length > 0 && (
          <div className="pt-2">
            <p className="text-sm text-amber-200 mb-2">{t('admin.ambiguousTitle')}</p>
            <ul className="text-sm text-cl-muted space-y-2 max-h-40 overflow-y-auto">
              {importResult.ambiguous.map((row) => (
                <li key={row.employeeName}>
                  <span className="text-cl-fg">{row.employeeName}</span>
                  {' → '}
                  {(row.candidates || []).map((c) => c.fullName).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">{t('admin.certsTitle')}</h3>
        <p className="text-sm text-cl-muted">
          {t('admin.certsBody')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => runBackfillCertificates({ continueUntilDone: false })}
            disabled={backfilling || !sharePointConfigured}
            className="cl-btn-ghost disabled:opacity-50"
          >
            {backfilling ? t('admin.generating') : t('admin.generateBatch')}
          </button>
          <button
            type="button"
            onClick={() => runBackfillCertificates({ continueUntilDone: true })}
            disabled={backfilling || !sharePointConfigured}
            className="cl-btn-primary disabled:opacity-50"
          >
            {backfilling ? t('admin.generating') : t('admin.generateAll')}
          </button>
        </div>
        {backfillResult && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {[
              [t('admin.processed'), backfillResult.processed],
              [t('admin.uploaded'), backfillResult.succeeded],
              [t('admin.failed'), backfillResult.failed],
              [t('admin.remaining'), backfillResult.remaining],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-cl-border bg-black/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-cl-muted">{label}</p>
                <p className="text-lg text-cl-fg font-semibold">{value ?? 0}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cl-card p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-cl-fg">{t('admin.mappingTitle')}</h3>
            <p className="text-sm text-cl-muted mt-1">
              {t('admin.mappingBody')}
              {!sharePointConfigured ? t('admin.spNotConfiguredShort') : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="cl-input text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{t('admin.allEmployees')}</option>
              <option value="unconfirmed">{t('admin.needsMapping')}</option>
              <option value="confirmed">{t('admin.confirmed')}</option>
            </select>
            <p className="text-xs text-cl-muted">{t('admin.foldersLoaded', { count: folderOptions.length })}</p>
          </div>
        </div>

        {!sharePointConfigured && (
          <p className="text-sm text-amber-200">
            {t('admin.spNotConfigured')}
          </p>
        )}

        {sharePointConfigured && folderOptions.length === 0 && (
          <p className="text-sm text-amber-200">
            {t('admin.noFolders')}
          </p>
        )}

        {!profiles.length ? (
          <p className="text-sm text-cl-muted">{t('admin.noEmployeesMap')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cl-muted border-b border-cl-border">
                  <th className="py-2 pr-3 font-medium">{t('common.employee')}</th>
                  <th className="py-2 pr-3 font-medium">{t('admin.email')}</th>
                  <th className="py-2 pr-3 font-medium">{t('admin.spFolder')}</th>
                  <th className="py-2 font-medium">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleProfiles.map((profile) => {
                  const selected = drafts[profile.employeeUid] || '';
                  const suggestions = folderOptions
                    .map((folder) => ({
                      ...folder,
                      score: scoreFolderMatch(profile.employeeName || profile.matrixName || '', folder.name),
                    }))
                    .filter((folder) => folder.score >= 50)
                    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
                    .slice(0, 5);
                  const suggestionNames = new Set(suggestions.map((folder) => folder.name));
                  const otherFolders = folderOptions.filter((folder) => !suggestionNames.has(folder.name));

                  return (
                    <tr key={profile.employeeUid} className="border-b border-cl-border/60 align-top">
                      <td className="py-3 pr-3 text-cl-fg">
                        <div>{profile.employeeName || '—'}</div>
                        {profile.matrixName && profile.matrixName !== profile.employeeName && (
                          <div className="text-xs text-cl-muted">{t('admin.matrixName', { name: profile.matrixName })}</div>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-cl-muted">{profile.employeeEmail || '—'}</td>
                      <td className="py-3 pr-3 min-w-[260px]">
                        <select
                          className="cl-input w-full"
                          value={selected}
                          onChange={(e) => setDrafts((prev) => ({
                            ...prev,
                            [profile.employeeUid]: e.target.value,
                          }))}
                        >
                          <option value="">{t('admin.selectFolder')}</option>
                          {suggestions.length > 0 && (
                            <optgroup label={t('admin.suggestedMatches')}>
                              {suggestions.map((folder) => (
                                <option key={`s-${folder.id || folder.name}`} value={folder.name}>
                                  {folder.name}
                                  {mappedFolderSet.has(normalizeLabel(folder.name)) ? t('admin.alreadyMapped') : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label={t('admin.allFolders')}>
                            {(suggestions.length ? otherFolders : folderOptions).map((folder) => (
                              <option key={folder.id || folder.name} value={folder.name}>
                                {folder.name}
                                {mappedFolderSet.has(normalizeLabel(folder.name)) ? t('admin.alreadyMapped') : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {profile.trainingFolderConfirmedAt && (
                          <p className="text-[11px] text-emerald-300/80 mt-1">
                            {t('admin.confirmedAs', { name: profile.trainingFolderName })}
                          </p>
                        )}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          className="cl-btn-ghost"
                          disabled={savingUid === profile.employeeUid || !selected}
                          onClick={() => confirmMapping(profile)}
                        >
                          {savingUid === profile.employeeUid ? t('common.saving') : t('admin.saveMapping')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {unmappedFolders.length > 0 && (
          <div>
            <p className="text-sm text-cl-muted mb-2">
              {t('admin.unmappedFolders', { count: unmappedFolders.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              {unmappedFolders.slice(0, 60).map((folder) => (
                <span
                  key={folder.id || folder.name}
                  className="px-2 py-1 rounded-md border border-cl-border text-xs text-cl-muted"
                >
                  {folder.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
