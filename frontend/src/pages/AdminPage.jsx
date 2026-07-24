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
        `Imported ${response.summary?.completionsCreated || 0} new and ${response.summary?.completionsUpdated || 0} updated completions.`,
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
          `Certificates: ${totalSucceeded} uploaded, ${totalFailed} failed, ${remaining} remaining.`,
        );
        if (!continueUntilDone || remaining === 0) break;
      }

      if (lastResult && (lastResult.remaining || 0) === 0 && totalProcessed === 0) {
        setMessage('All completed records already have SharePoint certificates.');
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
      setError('Choose an existing SharePoint folder first.');
      return;
    }

    const folderExists = folderOptions.some((folder) => folder.name === trainingFolderName);
    if (!folderExists) {
      setError(`Folder “${trainingFolderName}” is not in the SharePoint list. Pick one from the dropdown.`);
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
      setMessage(`Mapped ${profile.employeeName} → ${trainingFolderName}`);
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
      setError('Choose a Training course for this assessment quiz.');
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
        `Mapped “${quiz.title}” → “${course?.title || response.map?.courseTitle || 'course'}”.`
        + (merge.mergedEmployees
          ? ` Merged ${merge.mergedEmployees} employee record(s), removed ${merge.deleted || 0} duplicate(s).`
          : ''),
      );
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save assessment map.');
    } finally {
      setSavingQuizId('');
    }
  };

  if (loading) return <p className="text-cl-muted text-sm">Loading admin tools…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-cl-fg">Training admin</h2>
        <p className="text-sm text-cl-muted mt-1">
          Import the Training Matrix CSV, map SharePoint folders, generate certificates, and amend dates.
        </p>
      </div>

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">Amend dates</h3>
        <p className="text-sm text-cl-muted">
          Correct completion or expiry dates on training records when data was entered wrongly.
        </p>
        <Link to="/admin/amend" className="cl-btn-primary inline-flex">
          Open amend dates
        </Link>
      </section>

      <section className="cl-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-cl-fg">Assessment quiz → Training course</h3>
        <p className="text-sm text-cl-muted">
          Map Assessment quizzes to existing Training courses so a pass updates the matching
          matrix record (new date + certificate) instead of creating a duplicate course.
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
                  `Auto-mapped ${response.created?.length || 0} quiz(zes).`
                  + (response.skipped?.length ? ` Skipped ${response.skipped.length}.` : ''),
                );
                await load();
              } catch (err) {
                setError(err.message || 'Auto-map failed.');
              } finally {
                setSavingQuizId('');
              }
            }}
          >
            {savingQuizId === '__auto__' ? 'Mapping…' : 'Auto-map suggested quizzes'}
          </button>
        </div>
        {!quizzesAvailable && (
          <p className="text-sm text-amber-200">
            Could not load Assessment quizzes. Check ASSESSMENT_PORTAL_URL / provision secret, then refresh.
          </p>
        )}
        {!quizzes.length ? (
          <p className="text-sm text-cl-muted">No Assessment quizzes found yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-cl-muted border-b border-cl-border">
                  <th className="px-3 py-2 font-medium">Assessment quiz</th>
                  <th className="px-3 py-2 font-medium">Training course</th>
                  <th className="px-3 py-2 font-medium">Status</th>
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
                        {quiz.title || 'Untitled quiz'}
                        <div className="text-xs text-cl-muted font-normal">ID {quizId}</div>
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
                          <option value="">Select course…</option>
                          {courses.map((course) => (
                            <option key={course.id} value={course.id}>
                              {course.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-cl-muted whitespace-nowrap">
                        {saved?.courseId
                          ? `Mapped → ${saved.courseTitle || 'course'}`
                          : 'Not mapped'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          className="cl-btn-primary"
                          disabled={savingQuizId === quizId || !draftCourseId}
                          onClick={() => saveQuizCourseMap(quiz)}
                        >
                          {savingQuizId === quizId ? 'Saving…' : 'Save map'}
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
        <h3 className="text-sm font-semibold text-cl-fg">Import Training Matrix</h3>
        <p className="text-sm text-cl-muted">
          Import the Training Matrix CSV. Matches employees by name to Employee Portal users,
          creates courses, and imports completions (no certificates on import).
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
                  `Imported ${response.summary?.completionsCreated || 0} new and ${response.summary?.completionsUpdated || 0} updated completions.`,
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
            {importing ? 'Importing…' : 'Import bundled CSV'}
          </button>
        </div>

        {importResult?.summary && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {[
              ['Rows', importResult.summary.rows],
              ['Matched employees', importResult.summary.employeesMatched],
              ['Completions created', importResult.summary.completionsCreated],
              ['Completions updated', importResult.summary.completionsUpdated],
              ['Courses created', importResult.summary.coursesCreated],
              ['Unmatched', importResult.summary.employeesUnmatched],
              ['Ambiguous', importResult.summary.employeesAmbiguous],
              ['Skipped rows', importResult.summary.completionsSkipped],
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
            <p className="text-sm text-amber-200 mb-2">Unmatched employees (fix names in Employee Portal, then re-import)</p>
            <ul className="text-sm text-cl-muted space-y-1 max-h-40 overflow-y-auto">
              {importResult.unmatched.map((row) => (
                <li key={row.employeeName}>
                  {row.employeeName}
                  {row.department ? ` · ${row.department}` : ''}
                  {` · ${row.rowCount} rows`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {importResult?.ambiguous?.length > 0 && (
          <div className="pt-2">
            <p className="text-sm text-amber-200 mb-2">Ambiguous name matches</p>
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
        <h3 className="text-sm font-semibold text-cl-fg">Generate certificates</h3>
        <p className="text-sm text-cl-muted">
          Create PDF certificates for completed training records and store them in SharePoint as
          {' '}<code className="text-cl-fg">/Employee Name/Certificates/Course Name/Course Name.pdf</code>
          {' '}(uses the mapped folder when set). New completions do this automatically.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => runBackfillCertificates({ continueUntilDone: false })}
            disabled={backfilling || !sharePointConfigured}
            className="cl-btn-ghost disabled:opacity-50"
          >
            {backfilling ? 'Generating…' : 'Generate next batch (25)'}
          </button>
          <button
            type="button"
            onClick={() => runBackfillCertificates({ continueUntilDone: true })}
            disabled={backfilling || !sharePointConfigured}
            className="cl-btn-primary disabled:opacity-50"
          >
            {backfilling ? 'Generating…' : 'Generate all missing certificates'}
          </button>
        </div>
        {backfillResult && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {[
              ['Processed', backfillResult.processed],
              ['Uploaded', backfillResult.succeeded],
              ['Failed', backfillResult.failed],
              ['Remaining', backfillResult.remaining],
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
            <h3 className="text-sm font-semibold text-cl-fg">SharePoint folder mapping</h3>
            <p className="text-sm text-cl-muted mt-1">
              Choose an existing folder from Employee Training Documents for each employee.
              {!sharePointConfigured ? ' · SharePoint credentials not configured' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="cl-input text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All employees</option>
              <option value="unconfirmed">Needs mapping</option>
              <option value="confirmed">Confirmed</option>
            </select>
            <p className="text-xs text-cl-muted">{folderOptions.length} folders loaded</p>
          </div>
        </div>

        {!sharePointConfigured && (
          <p className="text-sm text-amber-200">
            SharePoint is not configured, so folders cannot be listed yet.
          </p>
        )}

        {sharePointConfigured && folderOptions.length === 0 && (
          <p className="text-sm text-amber-200">
            No folders were returned from SharePoint. Check Graph access to the Training site library.
          </p>
        )}

        {!profiles.length ? (
          <p className="text-sm text-cl-muted">No employees to map yet. Run the matrix import first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cl-muted border-b border-cl-border">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">SharePoint folder</th>
                  <th className="py-2 font-medium">Action</th>
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
                          <div className="text-xs text-cl-muted">Matrix: {profile.matrixName}</div>
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
                          <option value="">Select a SharePoint folder…</option>
                          {suggestions.length > 0 && (
                            <optgroup label="Suggested matches">
                              {suggestions.map((folder) => (
                                <option key={`s-${folder.id || folder.name}`} value={folder.name}>
                                  {folder.name}
                                  {mappedFolderSet.has(normalizeLabel(folder.name)) ? ' (already mapped)' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="All existing folders">
                            {(suggestions.length ? otherFolders : folderOptions).map((folder) => (
                              <option key={folder.id || folder.name} value={folder.name}>
                                {folder.name}
                                {mappedFolderSet.has(normalizeLabel(folder.name)) ? ' (already mapped)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {profile.trainingFolderConfirmedAt && (
                          <p className="text-[11px] text-emerald-300/80 mt-1">
                            Confirmed as {profile.trainingFolderName}
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
                          {savingUid === profile.employeeUid ? 'Saving…' : 'Save mapping'}
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
              Folders in SharePoint not yet confirmed against a portal user ({unmappedFolders.length})
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
