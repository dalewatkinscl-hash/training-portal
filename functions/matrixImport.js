'use strict';

/**
 * Parse and normalize the SharePoint Training Matrix CSV export.
 */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }

  return rows;
}

function parseUkDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugCourseCode(title) {
  return String(title || 'course')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'COURSE';
}

function parseTrainingMatrixCsv(text) {
  const rows = parseCsv(String(text || ''));
  if (!rows.length) {
    return { headers: [], records: [], employees: [], courses: [] };
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const indexOf = (label) => headers.findIndex((h) => h.toLowerCase() === label.toLowerCase());

  const col = {
    employeeName: indexOf('Employee Name'),
    department: indexOf('Department'),
    courseName: indexOf('Course Name'),
    courseType: indexOf('Course Type'),
    validityMonths: indexOf('Course Valid in Months'),
    completedDate: indexOf('Completed Date'),
    dueDate: indexOf('Due Date'),
    status: indexOf('Status'),
    employeeStatus: indexOf('Employee Status'),
    assessmentType: indexOf('Understanding Assessment Type'),
    assessedBy: indexOf('Understanding Assessed By'),
  };

  const records = [];
  const employeeMap = new Map();
  const courseMap = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i];
    const get = (key) => (col[key] >= 0 ? String(cols[col[key]] || '').trim() : '');

    const employeeName = get('employeeName');
    const courseName = get('courseName');
    if (!employeeName || !courseName) continue;

    const validityRaw = get('validityMonths');
    const validityMonths = validityRaw === '' ? null : Number(validityRaw);
    const completedAt = parseUkDate(get('completedDate'));
    const expiresAt = parseUkDate(get('dueDate'));
    const courseType = get('courseType') || 'Mandatory';
    const status = get('status') || '';
    const department = get('department') || '';

    const courseKey = normalizeName(courseName);
    if (!courseMap.has(courseKey)) {
      courseMap.set(courseKey, {
        title: courseName,
        code: slugCourseCode(courseName),
        category: courseType.toLowerCase() === 'additional' ? 'additional' : 'mandatory',
        validityMonths: Number.isFinite(validityMonths) ? validityMonths : null,
      });
    } else if (Number.isFinite(validityMonths) && courseMap.get(courseKey).validityMonths == null) {
      courseMap.get(courseKey).validityMonths = validityMonths;
    }

    const employeeKey = normalizeName(employeeName);
    if (!employeeMap.has(employeeKey)) {
      employeeMap.set(employeeKey, {
        employeeName,
        department,
        employeeStatus: get('employeeStatus') || '',
        rowCount: 0,
      });
    }
    employeeMap.get(employeeKey).rowCount += 1;

    const externalId = [
      employeeKey,
      courseKey,
      completedAt ? completedAt.toISOString().slice(0, 10) : 'none',
      expiresAt ? expiresAt.toISOString().slice(0, 10) : 'none',
      status.toLowerCase() || 'blank',
    ].join('|');

    records.push({
      employeeName,
      employeeKey,
      department,
      courseName,
      courseKey,
      courseType,
      validityMonths: Number.isFinite(validityMonths) ? validityMonths : null,
      completedAt,
      expiresAt,
      status,
      assessmentType: get('assessmentType') || '',
      assessedBy: get('assessedBy') || '',
      sourceExternalId: externalId,
    });
  }

  return {
    headers,
    records,
    employees: [...employeeMap.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    courses: [...courseMap.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function matchEmployeesToUsers(matrixEmployees, portalUsers) {
  const usersByName = new Map();
  for (const user of portalUsers) {
    const key = normalizeName(user.fullName || '');
    if (!key) continue;
    if (!usersByName.has(key)) usersByName.set(key, []);
    usersByName.get(key).push(user);
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const employee of matrixEmployees) {
    const key = normalizeName(employee.employeeName);
    const exact = usersByName.get(key) || [];
    if (exact.length === 1) {
      matched.push({ ...employee, user: exact[0], matchType: 'exact' });
      continue;
    }
    if (exact.length > 1) {
      ambiguous.push({ ...employee, candidates: exact, matchType: 'ambiguous' });
      continue;
    }

    // Fuzzy: same first token + last token
    const parts = key.split(' ');
    const candidates = portalUsers.filter((user) => {
      const uname = normalizeName(user.fullName || '');
      const uparts = uname.split(' ');
      if (parts.length < 2 || uparts.length < 2) return false;
      return parts[0] === uparts[0] && parts[parts.length - 1] === uparts[uparts.length - 1];
    });

    if (candidates.length === 1) {
      matched.push({ ...employee, user: candidates[0], matchType: 'fuzzy' });
    } else if (candidates.length > 1) {
      ambiguous.push({ ...employee, candidates, matchType: 'ambiguous' });
    } else {
      unmatched.push({ ...employee, matchType: 'unmatched' });
    }
  }

  return { matched, unmatched, ambiguous };
}

module.exports = {
  matchEmployeesToUsers,
  normalizeName,
  parseTrainingMatrixCsv,
  slugCourseCode,
};
