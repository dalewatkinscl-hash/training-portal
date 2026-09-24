async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};
  return { ok: response.ok, status: response.status, ...data, raw: response };
}

export function fetchSession() {
  return api('/api/session');
}

export function fetchMyRecords() {
  return api('/api/me/records');
}

export function fetchCourses(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ''),
  ).toString();
  return api(`/api/courses${query ? `?${query}` : ''}`);
}

export function createCourse(body) {
  return api('/api/courses', { method: 'POST', body: JSON.stringify(body) });
}

export function updateCourse(id, body) {
  return api(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function fetchCompletions(params = {}) {
  const query = new URLSearchParams(params).toString();
  return api(`/api/completions${query ? `?${query}` : ''}`);
}

export function createCompletion(body) {
  return api('/api/completions', { method: 'POST', body: JSON.stringify(body) });
}

export function createCompletionsBatch(body) {
  return api('/api/completions/batch', { method: 'POST', body: JSON.stringify(body) });
}

export function updateCompletion(id, body) {
  return api(`/api/completions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteCompletion(id) {
  return api(`/api/completions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchRequiredTraining(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ''),
  ).toString();
  return api(`/api/required-training${query ? `?${query}` : ''}`);
}

export function reissueCertificate(id, body = {}) {
  return api(`/api/completions/${id}/certificate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchDashboard() {
  return api('/api/dashboard');
}

export function fetchEmployees(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ''),
  ).toString();
  return api(`/api/employees${query ? `?${query}` : ''}`);
}

export function fetchEmployee(uid) {
  return api(`/api/employees/${encodeURIComponent(uid)}`);
}

export function fetchTrainingMatrix(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ''),
  ).toString();
  return api(`/api/matrix${query ? `?${query}` : ''}`);
}

export function importTrainingMatrix(csvText) {
  return api('/api/admin/import-matrix', {
    method: 'POST',
    body: JSON.stringify(csvText ? { csvText } : {}),
  });
}

export function fetchTrainingMappings() {
  return api('/api/admin/mappings');
}

export function confirmTrainingMapping(body) {
  return api('/api/admin/mappings/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function backfillCertificates(body = {}) {
  return api('/api/admin/backfill-certificates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchAssessmentMaps() {
  return api('/api/admin/assessment-maps');
}

export function saveAssessmentMap(body) {
  return api('/api/admin/assessment-maps', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function autoMapAssessmentCourses(body = {}) {
  return api('/api/admin/assessment-maps/auto-map', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteAssessmentMap(quizId) {
  return api(`/api/admin/assessment-maps/${encodeURIComponent(quizId)}`, {
    method: 'DELETE',
  });
}

export function fetchFolderSuggestions(name) {
  const query = new URLSearchParams({ name }).toString();
  return api(`/api/admin/folder-suggestions?${query}`);
}

export function fetchCourseCompletionReport(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ''),
  ).toString();
  return api(`/api/reports/course-completion${query ? `?${query}` : ''}`);
}
