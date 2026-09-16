'use strict';

const { normalizeName } = require('./matrixImport');

const LEVEL_IN_TITLE = /\b(?:level|lvl|lv|l)\s*([123])\b/;

function parseCourseLevel(value) {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

function inferCourseLevel(title, explicit) {
  return parseCourseLevel(explicit) || parseCourseLevel(
    (normalizeName(title).match(LEVEL_IN_TITLE) || [])[1],
  ) || 1;
}

function deriveTierFamily(title, explicitFamily) {
  const explicit = normalizeName(explicitFamily);
  if (explicit) return explicit;
  return normalizeName(title)
    .replace(LEVEL_IN_TITLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCourseTierIndex(courses) {
  const byId = new Map();
  const byTitle = new Map();
  for (const course of courses || []) {
    if (!course) continue;
    const meta = {
      id: course.id || '',
      title: course.title || '',
      level: parseCourseLevel(course.level) || 1,
      family: deriveTierFamily(course.title, course.tierFamily),
    };
    if (meta.id) byId.set(meta.id, meta);
    const titleKey = normalizeName(meta.title);
    if (titleKey) byTitle.set(titleKey, meta);
  }
  return { byId, byTitle };
}

function resolveItemMeta(item, index) {
  const course = (item.courseId && index?.byId?.get(item.courseId))
    || index?.byTitle?.get(normalizeName(item.courseTitle || ''))
    || null;
  const title = course?.title || item.courseTitle || '';
  return {
    level: course ? course.level : (parseCourseLevel(item.courseLevel) || 1),
    family: course ? course.family : deriveTierFamily(title, item.tierFamily),
    title,
  };
}

function expiryRank(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function isSatisfied(status) {
  return status === 'completed' || status === 'expiring_soon';
}

function canCover(item) {
  if (!item || item.status === 'failed') return false;
  return Boolean(item.completedAt);
}

function applyCourseTierOverrides(completions, courseIndex, { now = Date.now(), computeStatus } = {}) {
  const items = Array.isArray(completions) ? completions : [];
  if (!items.length) return items;

  const annotated = items.map((item) => ({
    item,
    meta: resolveItemMeta(item, courseIndex),
  }));

  const byEmployeeFamily = new Map();
  for (const row of annotated) {
    const uid = row.item.employeeUid || '';
    const family = row.meta.family;
    if (!uid || !family) continue;
    const key = `${uid}::${family}`;
    if (!byEmployeeFamily.has(key)) byEmployeeFamily.set(key, []);
    byEmployeeFamily.get(key).push(row);
  }

  return annotated.map(({ item, meta }) => {
    const next = {
      ...item,
      courseLevel: meta.level,
      tierFamily: meta.family,
    };

    const uid = item.employeeUid || '';
    if (!uid || !meta.family) return next;

    const siblings = byEmployeeFamily.get(`${uid}::${meta.family}`) || [];
    const covers = siblings.filter((row) => (
      row.item.id !== item.id
      && row.meta.level > meta.level
      && canCover(row.item)
    ));
    if (!covers.length) return next;

    let best = covers[0];
    for (const row of covers.slice(1)) {
      if (expiryRank(row.item.expiresAt) > expiryRank(best.item.expiresAt)) {
        best = row;
      }
    }

    const covering = best.item;
    const coveringImprovesDate = expiryRank(covering.expiresAt) > expiryRank(item.expiresAt);
    const coveringSatisfiesLower = isSatisfied(covering.status) && !isSatisfied(item.status);
    if (!coveringImprovesDate && !coveringSatisfiesLower) return next;

    const expiresAt = covering.expiresAt || null;
    const completedAt = item.completedAt || covering.completedAt || null;
    const status = typeof computeStatus === 'function'
      ? computeStatus(
        expiresAt ? new Date(expiresAt) : null,
        completedAt ? new Date(completedAt) : null,
        now,
      )
      : covering.status;

    return {
      ...next,
      expiresAt,
      completedAt,
      status,
      nativeExpiresAt: item.expiresAt || null,
      nativeCompletedAt: item.completedAt || null,
      nativeStatus: item.status,
      coveredByCourseId: covering.courseId || '',
      coveredByCourseTitle: covering.courseTitle || best.meta.title,
      coveredByLevel: best.meta.level,
    };
  });
}

module.exports = {
  parseCourseLevel,
  inferCourseLevel,
  deriveTierFamily,
  buildCourseTierIndex,
  applyCourseTierOverrides,
};
