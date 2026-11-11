export const TRAINING_PRIORITIES = ['low', 'medium', 'high'];
export const AD_HOC_COURSE = '__adhoc__';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export function courseGroupKey(request) {
  const courseId = String(request?.courseId || '').trim();
  if (courseId) return `course:${courseId}`;
  const title = String(request?.courseTitle || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `adhoc:${title}`;
}

export function sortOpenRequests(requests) {
  return (requests || [])
    .filter((request) => request?.status !== 'completed')
    .slice()
    .sort((a, b) => {
      const rank = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      if (rank !== 0) return rank;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

/** Completed requests, with everyone on the same course in one group. */
export function groupCompletedRequests(requests) {
  const groups = new Map();

  (requests || [])
    .filter((request) => request?.status === 'completed')
    .forEach((request) => {
      const people = Array.isArray(request.people) ? request.people : [];
      if (!people.length) return;

      const key = courseGroupKey(request);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          courseTitle: request.courseTitle || '',
          courseCode: request.courseCode || '',
          adHoc: request.adHoc === true,
          people: [],
        });
      }

      const group = groups.get(key);
      if (!group.courseCode && request.courseCode) group.courseCode = request.courseCode;
      people.forEach((person, index) => {
        group.people.push({
          key: `${request.id || key}:${person.employeeUid || index}:${index}`,
          employeeUid: person.employeeUid || '',
          employeeName: person.employeeName || '',
          employeeEmail: person.employeeEmail || '',
          department: person.department || '',
          priority: request.priority || 'medium',
          notes: request.notes || '',
          requestedByName: request.requestedByName || '',
          requestedByEmail: request.requestedByEmail || '',
          requestedByJobTitle: request.requestedByJobTitle || '',
          createdAt: request.createdAt || null,
          completedAt: request.completedAt || null,
          completedByName: request.completedByName || '',
          requestId: request.id || '',
          completionId: person.completionId || '',
          sharePointWebUrl: person.sharePointWebUrl || '',
          certificatePendingSharePoint: person.certificatePendingSharePoint === true,
        });
      });
    });

  const byName = (a, b) => String(a.employeeName || a.employeeEmail).localeCompare(
    String(b.employeeName || b.employeeEmail),
    undefined,
    { sensitivity: 'base' },
  );

  return [...groups.values()]
    .map((group) => ({
      ...group,
      people: group.people.slice().sort(byName),
    }))
    .sort((a, b) => String(a.courseTitle).localeCompare(String(b.courseTitle), undefined, {
      sensitivity: 'base',
    }));
}
