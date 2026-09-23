'use strict';

const cors = require('cors');
const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { buildTrainingCertificatePdf } = require('./certificates');
const {
  ensureEmployeeFolder,
  isSharePointConfigured,
  listEmployeeFolders,
  suggestEmployeeFolders,
  uploadTrainingCertificate,
  buildEmployeeFolderName,
} = require('./sharepoint');
const {
  matchEmployeesToUsers,
  normalizeName,
  parseTrainingMatrixCsv,
} = require('./matrixImport');
const {
  parseCourseLevel,
  buildCourseTierIndex,
  applyCourseTierOverrides,
} = require('./courseTiers');
const fs = require('fs');
const path = require('path');

initializeApp();
const db = getFirestore();

const PORTAL_KEY = 'training_app';
const MASTER_USER_MGMT_URL = 'https://employee.countrylion.co.uk';
/** learner is accepted as an alias of employee (Employee Portal / Assessment naming). */
const ROLE_LEVEL = { learner: 1, employee: 1, manager: 2, trainer: 2, admin: 3 };
const SOURCE_LABELS = {
  manual: 'Training portal',
  assessment: 'Assessment portal',
  cpc: 'CPC portal',
  matrix: 'Training Matrix import',
};

const ALLOWED_ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?countrylion\.co\.uk$/,
  /^https:\/\/training\.countrylion\.co\.uk$/,
  /^https:\/\/training-cl\.web\.app$/,
  /^https:\/\/training-cl\.firebaseapp\.com$/,
  'http://localhost:5173',
  'http://localhost:4173',
];

const corsMiddleware = cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-ingest-secret', 'x-provision-secret', 'Authorization'],
});

function getSharePointConfig() {
  return {
    tenantId: process.env.MS_GRAPH_TENANT_ID || '',
    clientId: process.env.MS_GRAPH_CLIENT_ID || '',
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET || '',
  };
}

function getIngestSecret() {
  return process.env.TRAINING_INGEST_SECRET || '';
}

function getProvisionSecret() {
  return process.env.TRAINING_PROVISION_SECRET || '';
}

function getAssessmentPortalUrl() {
  return process.env.ASSESSMENT_PORTAL_URL || 'https://assessments.countrylion.co.uk';
}

function getAssessmentProvisionSecret() {
  return process.env.ASSESSMENT_PROVISION_SECRET || process.env.TRAINING_PROVISION_SECRET || '';
}

function getEmployeePortalSyncSecret() {
  return process.env.EMPLOYEE_PORTAL_SYNC_SECRET || process.env.TRAINING_PROVISION_SECRET || '';
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex === -1) return accumulator;
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

async function verifySession(cookieHeader) {
  const response = await fetch(`${MASTER_USER_MGMT_URL}/api/verifyPortalSession?portal=${PORTAL_KEY}`, {
    method: 'GET',
    headers: {
      Cookie: cookieHeader || '',
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401 || response.status === 403) {
    return { status: response.status, user: null };
  }
  if (!response.ok) {
    throw new Error('Session verification failed');
  }

  const data = await response.json();
  return { status: 200, user: data.user || null };
}

function getRole(user) {
  const raw = user?.portalsAccess?.[PORTAL_KEY] || '';
  return normalizeTrainingRole(raw);
}

function normalizeTrainingRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'learner' || value === 'staff' || value === 'user') return 'employee';
  if (ROLE_LEVEL[value]) return value;
  return value;
}

function roleAtLeast(role, minRole) {
  return (ROLE_LEVEL[normalizeTrainingRole(role)] || 0) >= (ROLE_LEVEL[normalizeTrainingRole(minRole)] || 99);
}

function requireProvisionSecret(req, res) {
  const secret = getProvisionSecret();
  if (!secret || req.headers['x-provision-secret'] !== secret) {
    res.status(401).json({ error: 'Invalid provision secret.' });
    return false;
  }
  return true;
}

async function loadEmployeeProfile(employeeUid) {
  if (!employeeUid) return null;
  const snap = await db.collection('employee_profiles').doc(employeeUid).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function upsertEmployeeProfile(employeeUid, patch = {}) {
  const ref = db.collection('employee_profiles').doc(employeeUid);
  const existing = await ref.get();
  const payload = {
    ...patch,
    employeeUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
    // FieldValue.delete() is only valid with merge/update — drop on first create.
    Object.keys(payload).forEach((key) => {
      const value = payload[key];
      if (value && typeof value === 'object' && value._methodName === 'FieldValue.delete') {
        delete payload[key];
      }
    });
  }
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, ...snap.data() };
}

async function fetchPortalUsersForSync() {
  const secret = getEmployeePortalSyncSecret();
  if (!secret) {
    throw Object.assign(new Error('EMPLOYEE_PORTAL_SYNC_SECRET / TRAINING_PROVISION_SECRET is not configured.'), {
      status: 500,
    });
  }

  const response = await fetch(`${MASTER_USER_MGMT_URL}/api/getUsersForTrainingSync`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-provision-secret': secret,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'Failed to load employees from Employee Portal.'), {
      status: response.status || 500,
    });
  }

  return Array.isArray(data.users) ? data.users : [];
}

function portalUserUid(user) {
  return String(user?.uid || user?.id || '').trim();
}

function userHasTrainingAccess(user) {
  if (!user) return false;
  if (user.disabled === true || user.active === false || user.isActive === false) return false;
  if (Object.prototype.hasOwnProperty.call(user, 'trainingRole') && !String(user.trainingRole || '').trim()) {
    return false;
  }
  const access = user.portalsAccess || user.portals || user.portalAccess;
  if (access && typeof access === 'object') {
    const role = access[PORTAL_KEY] ?? access.training ?? access.trainingApp;
    return Boolean(String(role || '').trim());
  }
  if (user.trainingAccess === false || user.hasTrainingAccess === false) return false;
  return true;
}

async function loadAllowedEmployeeUids() {
  try {
    const users = await fetchPortalUsersForSync();
    if (!users.length) {
      throw Object.assign(new Error('Employee Portal returned no training users.'), { status: 502 });
    }
    const allowed = new Set();
    const allowedUsers = [];
    users.forEach((user) => {
      const uid = portalUserUid(user);
      if (uid && userHasTrainingAccess(user)) {
        allowed.add(uid);
        allowedUsers.push(user);
      }
    });
    if (!allowed.size) {
      throw Object.assign(new Error('Employee Portal returned no users with training access.'), { status: 502 });
    }
    return { source: 'portal', allowed, users: allowedUsers };
  } catch (error) {
    console.warn('portal access sync failed', error.message || error);
    return { source: 'profiles', allowed: null, users: [] };
  }
}

/**
 * Create local employee_profiles for anyone with training_app access who is missing one.
 * Fixes cases where provision failed (e.g. SharePoint) so trainers still see new staff.
 */
async function ensureProfilesForPortalUsers(allowedUsers = []) {
  if (!Array.isArray(allowedUsers) || !allowedUsers.length) return 0;
  const snap = await db.collection('employee_profiles').get();
  const existing = new Set(snap.docs.map((doc) => doc.id));
  const jobs = [];

  for (const user of allowedUsers) {
    const uid = portalUserUid(user);
    if (!uid || existing.has(uid)) continue;
    const fullName = String(user.fullName || '').trim();
    if (!fullName) continue;
    const role = normalizeTrainingRole(user.trainingRole || 'employee') || 'employee';
    jobs.push(upsertEmployeeProfile(uid, {
      employeeName: fullName,
      employeeEmail: String(user.email || '').trim(),
      role,
      accessEnabled: true,
      accessRevokedAt: FieldValue.delete(),
      trainingFolderName: buildEmployeeFolderName(fullName),
    }));
  }

  if (!jobs.length) return 0;
  await Promise.all(jobs);
  return jobs.length;
}

async function persistDirectoryAccessFlags(allowedUids, profilesSnap) {
  const jobs = [];
  profilesSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const allowed = allowedUids.has(doc.id);
    if (allowed && data.accessEnabled === false) {
      jobs.push(markEmployeeAccess(doc.id, true));
    } else if (!allowed && data.accessEnabled !== false) {
      jobs.push(markEmployeeAccess(doc.id, false));
    }
  });
  if (!jobs.length) return;
  await Promise.all(jobs);
}

async function loadDirectoryAccess(profilesSnap = null) {
  const access = await loadAllowedEmployeeUids();
  if (access.source === 'portal' && access.users?.length) {
    try {
      await ensureProfilesForPortalUsers(access.users);
    } catch (error) {
      console.warn('ensureProfilesForPortalUsers failed', error.message || error);
    }
  }

  const snap = profilesSnap
    || await db.collection('employee_profiles').get();

  if (access.source === 'portal' && access.allowed) {
    persistDirectoryAccessFlags(access.allowed, snap).catch((error) => {
      console.warn('access flag sync failed', error.message || error);
    });
  }
  return {
    profilesSnap: snap,
    allowedUids: access.allowed,
    accessSource: access.source,
  };
}

function hasDirectoryAccess(uid, allowedUids, profile) {
  const id = String(uid || profile?.employeeUid || '').trim();
  if (!id) return false;
  if (allowedUids) return allowedUids.has(id);
  if (profile?.accessEnabled === false) return false;
  return true;
}

async function markEmployeeAccess(uid, enabled, extra = {}) {
  if (!uid) return null;
  return upsertEmployeeProfile(uid, {
    accessEnabled: enabled,
    accessRevokedAt: enabled ? FieldValue.delete() : FieldValue.serverTimestamp(),
    ...extra,
  });
}

function serializeEmployeeProfile(docOrData) {
  const data = docOrData?.data ? docOrData.data() : docOrData;
  const id = docOrData?.id || data?.employeeUid || data?.id || '';
  return {
    id,
    employeeUid: data.employeeUid || id,
    employeeName: data.employeeName || '',
    employeeEmail: data.employeeEmail || '',
    department: data.department || '',
    trainingFolderName: data.trainingFolderName || '',
    trainingFolderWebUrl: data.trainingFolderWebUrl || '',
    trainingFolderConfirmedAt: data.trainingFolderConfirmedAt?.toDate?.()?.toISOString?.()
      || data.trainingFolderConfirmedAt
      || null,
    accessEnabled: data.accessEnabled !== false,
    accessRevokedAt: data.accessRevokedAt?.toDate?.()?.toISOString?.()
      || data.accessRevokedAt
      || null,
    matrixName: data.matrixName || '',
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
  };
}

function canTrain(role) {
  return roleAtLeast(role, 'trainer') || role === 'manager';
}

function canAdmin(role) {
  return roleAtLeast(role, 'admin');
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toTimestamp(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Timestamp.fromDate(parsed);
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function serializeCourse(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    code: data.code || '',
    title: data.title || '',
    category: data.category || 'general',
    description: data.description || '',
    validityMonths: data.validityMonths ?? null,
    level: parseCourseLevel(data.level) || 1,
    tierFamily: data.tierFamily || '',
    active: data.active !== false,
    sourceDefault: data.sourceDefault || 'manual',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

const EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000;

function computeExpiry(completedAt, validityMonths) {
  if (!completedAt || !validityMonths || validityMonths <= 0) return null;
  return addMonths(completedAt, Number(validityMonths));
}

function computeStatus(expiresAt, completedAt, now = Date.now()) {
  if (!completedAt) return 'assigned';
  if (expiresAt) {
    const expiresMs = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    if (Number.isFinite(expiresMs)) {
      if (expiresMs < now) return 'expired';
      if (expiresMs <= now + EXPIRING_SOON_MS) return 'expiring_soon';
    }
  }
  return 'completed';
}

function courseIndexFromSnap(snap) {
  return buildCourseTierIndex((snap?.docs || []).map(serializeCourse));
}

async function loadCourseTierIndex() {
  const snap = await db.collection('courses').get();
  return courseIndexFromSnap(snap);
}

function withCourseTiers(completions, courseIndex, now = Date.now()) {
  return applyCourseTierOverrides(completions, courseIndex, { now, computeStatus });
}

function serializeCompletion(doc) {
  const data = doc.data();
  const completedAt = toIso(data.completedAt);
  const expiresAt = toIso(data.expiresAt);
  const liveStatus = computeStatus(
    expiresAt ? new Date(expiresAt) : null,
    completedAt ? new Date(completedAt) : null,
  );
  return {
    id: doc.id,
    employeeUid: data.employeeUid || '',
    employeeName: data.employeeName || '',
    employeeEmail: data.employeeEmail || '',
    courseId: data.courseId || '',
    courseCode: data.courseCode || '',
    courseTitle: data.courseTitle || '',
    status: liveStatus || data.status || 'completed',
    completedAt,
    expiresAt,
    source: data.source || 'manual',
    sourceExternalId: data.sourceExternalId || '',
    score: data.score ?? null,
    notes: data.notes || '',
    quizId: data.quizId || '',
    certificateFileName: data.certificateFileName || '',
    sharePointWebUrl: data.sharePointWebUrl || '',
    sharePointItemId: data.sharePointItemId || '',
    sharePointFolderPath: data.sharePointFolderPath || '',
    loggedByUid: data.loggedByUid || '',
    loggedByName: data.loggedByName || '',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

async function requireUser(req, res, minRole = 'employee') {
  const session = await verifySession(req.headers.cookie || '');
  if (session.status !== 200 || !session.user) {
    res.status(session.status === 403 ? 403 : 401).json({ error: 'Not authenticated.' });
    return null;
  }
  const role = getRole(session.user);
  if (!roleAtLeast(role, minRole)) {
    res.status(403).json({ error: 'Insufficient permissions.' });
    return null;
  }
  return { user: session.user, role };
}

async function loadCourse(courseId) {
  if (!courseId) return null;
  const snap = await db.collection('courses').doc(courseId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function courseExclusionId(employeeUid, courseTitle) {
  const titleKey = normalizeName(courseTitle).replace(/\s+/g, '-');
  return `${String(employeeUid || '').trim()}__${titleKey}`.slice(0, 700);
}

async function saveCourseExclusion(completion, actor = {}) {
  const employeeUid = completion.employeeUid || '';
  const courseTitle = completion.courseTitle || '';
  if (!employeeUid || !courseTitle) return;
  await db.collection('course_exclusions').doc(courseExclusionId(employeeUid, courseTitle)).set({
    employeeUid,
    courseId: completion.courseId || '',
    courseTitle,
    employeeName: completion.employeeName || '',
    employeeEmail: completion.employeeEmail || '',
    removedByUid: actor.uid || '',
    removedByName: actor.fullName || actor.email || 'admin',
    removedAt: FieldValue.serverTimestamp(),
    sourceCompletionId: completion.id || '',
  });
}

async function clearCourseExclusion(employeeUid, courseTitle) {
  if (!employeeUid || !courseTitle) return;
  const ref = db.collection('course_exclusions').doc(courseExclusionId(employeeUid, courseTitle));
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}

async function findExistingIngest(source, sourceExternalId) {
  if (!source || !sourceExternalId) return null;
  const snap = await db
    .collection('completions')
    .where('source', '==', source)
    .where('sourceExternalId', '==', sourceExternalId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function findExistingCompletionForCourse(employeeUid, courseId) {
  if (!employeeUid || !courseId) return null;
  const snap = await db
    .collection('completions')
    .where('employeeUid', '==', employeeUid)
    .where('courseId', '==', courseId)
    .limit(20)
    .get();
  if (snap.empty) return null;
  const docs = [...snap.docs].sort((a, b) => {
    const aDate = a.data().completedAt?.toDate?.()?.getTime?.() || 0;
    const bDate = b.data().completedAt?.toDate?.()?.getTime?.() || 0;
    return bDate - aDate;
  });
  return docs[0];
}

async function findCompletionsByEmployeeAndTitle(employeeUid, courseTitle) {
  if (!employeeUid || !courseTitle) return [];
  const key = normalizeName(courseTitle);
  const snap = await db.collection('completions').where('employeeUid', '==', employeeUid).get();
  return snap.docs.filter((doc) => normalizeName(doc.data().courseTitle || '') === key);
}

function extractQuizId(payload = {}) {
  const explicit = String(payload.quizId || '').trim();
  if (explicit) return explicit;
  const code = String(payload.courseCode || '').trim();
  const match = /^ASSESS-(.+)$/i.exec(code);
  return match ? String(match[1]).trim() : '';
}

function isAssignOnlyPayload(payload = {}) {
  if (payload.assign === true) return true;
  const status = String(payload.status || '').trim().toLowerCase();
  return status === 'assigned' || status === 'required';
}

async function loadQuizIdForCourse(courseId, courseTitle) {
  if (!courseId && !courseTitle) return '';
  const mapsSnap = await db.collection('assessment_course_maps').get();
  const titleKey = normalizeName(courseTitle || '');
  let titleMatch = '';
  for (const doc of mapsSnap.docs) {
    const data = doc.data() || {};
    const quizId = String(data.quizId || doc.id || '').trim();
    if (!quizId) continue;
    if (courseId && String(data.courseId || '').trim() === String(courseId)) return quizId;
    const mappedTitle = normalizeName(data.courseTitle || '');
    const quizTitle = normalizeName(data.quizTitle || '');
    if (!titleMatch && titleKey && (
      mappedTitle === titleKey
      || quizTitle === titleKey
      || (mappedTitle && (titleKey.includes(mappedTitle) || mappedTitle.includes(titleKey)))
      || (quizTitle && (titleKey.includes(quizTitle) || quizTitle.includes(titleKey)))
    )) {
      titleMatch = quizId;
    }
  }
  return titleMatch;
}

function assessmentLinkFieldsFromMap(data = {}, quizId = '') {
  const id = String(quizId || data.quizId || '').trim();
  if (!id) return {};
  const trainerLed = data.trainerLed === true;
  const baseUrl = getAssessmentPortalUrl().replace(/\/$/, '');
  return {
    assessmentQuizId: id,
    assessmentQuizTitle: data.quizTitle || '',
    trainerLed,
    assessmentUrl: trainerLed ? null : `${baseUrl}/?quiz=${encodeURIComponent(id)}`,
    conductAssessmentUrl: trainerLed
      ? `${baseUrl}/?quiz=${encodeURIComponent(id)}&conduct=1`
      : null,
  };
}

async function loadAssessmentCourseMap(quizId) {
  if (!quizId) return null;
  const snap = await db.collection('assessment_course_maps').doc(String(quizId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadAssessmentLinksByCourseId() {
  let quizMetaById = new Map();
  try {
    const quizzes = await fetchAssessmentQuizzes();
    quizzes.forEach((quiz) => {
      quizMetaById.set(String(quiz.id), quiz);
    });
  } catch (error) {
    console.error('assessment quiz metadata fetch failed', error);
  }

  const mapsSnap = await db.collection('assessment_course_maps').get();
  const byCourseId = new Map();
  const byCourseTitle = new Map();
  const baseUrl = getAssessmentPortalUrl().replace(/\/$/, '');
  mapsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const courseId = String(data.courseId || '').trim();
    const quizId = String(data.quizId || doc.id || '').trim();
    if (!quizId) return;
    const meta = quizMetaById.get(quizId) || {};
    const trainerLed = meta.trainerLed === true || data.trainerLed === true;
    const link = {
      assessmentQuizId: quizId,
      assessmentQuizTitle: data.quizTitle || meta.title || '',
      assessmentCourseTitle: data.courseTitle || '',
      trainerLed,
      assessmentUrl: trainerLed ? null : `${baseUrl}/?quiz=${encodeURIComponent(quizId)}`,
      conductAssessmentUrl: trainerLed
        ? `${baseUrl}/?quiz=${encodeURIComponent(quizId)}&conduct=1`
        : null,
    };
    if (courseId) byCourseId.set(courseId, link);
    const titleKey = normalizeName(data.courseTitle || '');
    if (titleKey) byCourseTitle.set(titleKey, link);
    const quizTitleKey = normalizeName(data.quizTitle || meta.title || '');
    if (quizTitleKey) byCourseTitle.set(quizTitleKey, link);
  });
  return { byCourseId, byCourseTitle };
}

function resolveAssessmentLinkForCompletion(item, links) {
  if (!item) return null;
  if (item.courseId && links.byCourseId.has(item.courseId)) {
    return links.byCourseId.get(item.courseId);
  }
  const titleKey = normalizeName(item.courseTitle || '');
  if (titleKey && links.byCourseTitle.has(titleKey)) {
    return links.byCourseTitle.get(titleKey);
  }
  // Soft match: mapped course/quiz title contained in completion title or vice versa.
  if (titleKey) {
    for (const [key, link] of links.byCourseTitle.entries()) {
      if (!key) continue;
      if (titleKey.includes(key) || key.includes(titleKey)) return link;
    }
  }
  return null;
}

function withAssessmentLinks(completions, links, options = {}) {
  const { forTrainer = false, employeeUid = '' } = options;
  return (completions || []).map((item) => {
    const actionable = item.status === 'assigned'
      || item.status === 'expired'
      || item.status === 'expiring_soon'
      || item.status === 'failed';
    if (!actionable) return item;
    const link = resolveAssessmentLinkForCompletion(item, links);
    if (!link) return item;

    if (link.trainerLed) {
      const subjectUid = employeeUid || item.employeeUid || '';
      if (forTrainer && link.conductAssessmentUrl && subjectUid) {
        return {
          ...item,
          ...link,
          assessmentUrl: null,
          conductAssessmentUrl: `${link.conductAssessmentUrl}&employee=${encodeURIComponent(subjectUid)}`,
        };
      }
      return {
        ...item,
        trainerLed: true,
        assessmentQuizId: link.assessmentQuizId,
        assessmentQuizTitle: link.assessmentQuizTitle,
        assessmentUrl: null,
        conductAssessmentUrl: null,
      };
    }

    return {
      ...item,
      ...link,
    };
  });
}

async function resolveAssessmentCourse(payload = {}) {
  const quizId = extractQuizId(payload);
  const map = await loadAssessmentCourseMap(quizId);
  if (map?.courseId) {
    const course = await loadCourse(map.courseId);
    if (course) {
      return {
        quizId,
        courseId: course.id,
        courseTitle: course.title || map.courseTitle || payload.courseTitle || '',
        courseCode: course.code || payload.courseCode || '',
        validityMonths: course.validityMonths ?? payload.validityMonths ?? null,
        mapped: true,
        map,
      };
    }
  }
  return {
    quizId,
    courseId: payload.courseId || '',
    courseTitle: payload.courseTitle || '',
    courseCode: payload.courseCode || '',
    validityMonths: payload.validityMonths ?? null,
    mapped: false,
    map: null,
  };
}

async function fetchAssessmentQuizzes() {
  const secret = getAssessmentProvisionSecret();
  if (!secret) return [];
  const response = await fetch(`${getAssessmentPortalUrl()}/api/quizzes`, {
    headers: { 'x-provision-secret': secret },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Assessment quizzes lookup failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({}));
  return data.quizzes || [];
}

/**
 * When a quiz is mapped to a Training course, merge stray completions that used the
 * quiz title into the mapped course record (keeps newest dates, deletes duplicates).
 */
async function mergeAliasCompletionsIntoCourse({ quizTitle, courseId, courseTitle, actor = {} }) {
  if (!quizTitle || !courseId) {
    return { mergedEmployees: 0, deleted: 0, updated: 0 };
  }

  const aliasKey = normalizeName(quizTitle);
  const courseKey = normalizeName(courseTitle || '');
  if (!aliasKey || aliasKey === courseKey) {
    return { mergedEmployees: 0, deleted: 0, updated: 0 };
  }

  const snap = await db.collection('completions').get();
  const byEmployee = new Map();

  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const uid = data.employeeUid || '';
    if (!uid) return;
    const titleKey = normalizeName(data.courseTitle || '');
    const isAlias = titleKey === aliasKey;
    const isTarget = data.courseId === courseId || titleKey === courseKey;
    if (!isAlias && !isTarget) return;
    if (!byEmployee.has(uid)) byEmployee.set(uid, { alias: [], target: [] });
    const bucket = byEmployee.get(uid);
    if (isAlias && data.courseId !== courseId) bucket.alias.push(doc);
    if (isTarget) bucket.target.push(doc);
  });

  let mergedEmployees = 0;
  let deleted = 0;
  let updated = 0;

  for (const [employeeUid, group] of byEmployee.entries()) {
    if (!group.alias.length) continue;
    mergedEmployees += 1;

    const ranked = [...group.alias, ...group.target].sort((a, b) => {
      const aDate = a.data().completedAt?.toDate?.()?.getTime?.() || 0;
      const bDate = b.data().completedAt?.toDate?.()?.getTime?.() || 0;
      return bDate - aDate;
    });
    const winner = group.target[0] || ranked[0];
    const newest = ranked[0];
    const newestData = newest.data();
    const completedAt = newestData.completedAt?.toDate?.() || null;
    const expiresAt = newestData.expiresAt?.toDate?.() || null;
    const status = computeStatus(expiresAt, completedAt);

    await winner.ref.set({
      employeeUid,
      employeeName: newestData.employeeName || winner.data().employeeName || '',
      employeeEmail: newestData.employeeEmail || winner.data().employeeEmail || '',
      courseId,
      courseCode: newestData.courseCode || winner.data().courseCode || '',
      courseTitle: courseTitle || newestData.courseTitle || '',
      status,
      completedAt: newestData.completedAt || null,
      expiresAt: newestData.expiresAt || null,
      source: newestData.source || winner.data().source || 'assessment',
      sourceExternalId: newestData.sourceExternalId || winner.data().sourceExternalId || '',
      score: newestData.score ?? winner.data().score ?? null,
      notes: newestData.notes || winner.data().notes || '',
      mergedFromQuizTitle: quizTitle,
      mergedAt: FieldValue.serverTimestamp(),
      mergedByUid: actor.uid || 'system',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    updated += 1;

    const toDelete = [...group.alias, ...group.target].filter((doc) => doc.id !== winner.id);
    for (const doc of toDelete) {
      await doc.ref.delete();
      deleted += 1;
    }

    // Refresh certificate onto mapped course title.
    try {
      const profile = await loadEmployeeProfile(employeeUid);
      const meta = await maybeIssueCertificate({
        completionId: winner.id,
        employeeUid,
        employeeName: newestData.employeeName || profile?.employeeName || '',
        employeeEmail: newestData.employeeEmail || profile?.employeeEmail || '',
        courseId,
        courseTitle: courseTitle || 'Training',
        completedAt: completedAt || new Date(),
        expiresAt,
        source: newestData.source || 'assessment',
        trainingFolderName: profile?.trainingFolderName || '',
        isActive: true,
      });
      await winner.ref.update({
        ...meta,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('merge certificate refresh failed', winner.id, error);
    }
  }

  return { mergedEmployees, deleted, updated };
}

async function upsertCompletionRecord(payload, actor = {}) {
  let {
    employeeUid,
    employeeName,
    employeeEmail,
    courseId,
    courseCode,
    courseTitle,
    completedAt,
    expiresAt,
    validityMonths,
    source = 'manual',
    sourceExternalId = '',
    score = null,
    notes = '',
    createCertificate = true,
    sharePointFolderName = '',
    trainingFolderName = '',
    isActive = true,
    quizId = '',
  } = payload;

  if (source === 'assessment') {
    const resolved = await resolveAssessmentCourse({
      quizId,
      courseId,
      courseCode,
      courseTitle,
      validityMonths,
    });
    courseId = resolved.courseId || courseId;
    courseTitle = resolved.courseTitle || courseTitle;
    courseCode = resolved.courseCode || courseCode;
    if (resolved.mapped && resolved.validityMonths != null) {
      validityMonths = resolved.validityMonths;
    }
    quizId = resolved.quizId || quizId;
  }

  if (!employeeUid || (!courseTitle && !courseId)) {
    throw Object.assign(new Error('employeeUid and course are required.'), { status: 400 });
  }

  const course = courseId ? await loadCourse(courseId) : null;
  const resolvedTitle = courseTitle || course?.title || 'Training course';
  const resolvedCode = courseCode || course?.code || '';
  const resolvedValidity = validityMonths ?? course?.validityMonths ?? null;
  const resolvedCourseId = courseId || course?.id || '';
  const assignOnly = isAssignOnlyPayload(payload);

  let existing = await findExistingIngest(source, sourceExternalId);

  // Assessment / CPC / manual classroom logs: update the employee's existing course row.
  if (!existing && resolvedCourseId && (source === 'assessment' || source === 'cpc' || source === 'manual')) {
    existing = await findExistingCompletionForCourse(employeeUid, resolvedCourseId);
  }

  if (assignOnly && existing) {
    const existingCompleted = existing.data()?.completedAt;
    if (existingCompleted) {
      return { completion: serializeCompletion(existing), isNew: false, alreadyHeld: true };
    }
  }

  let completedDate = null;
  if (!assignOnly) {
    completedDate = completedAt ? new Date(completedAt) : new Date();
    if (Number.isNaN(completedDate.getTime())) {
      throw Object.assign(new Error('Invalid completedAt.'), { status: 400 });
    }
  }

  let expiryDate = null;
  if (expiresAt) {
    expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime())) {
      throw Object.assign(new Error('Invalid expiresAt.'), { status: 400 });
    }
  } else if (completedDate) {
    expiryDate = computeExpiry(completedDate, resolvedValidity);
  }

  const assessmentPassed = payload.passed;
  const status = assignOnly
    ? 'assigned'
    : (assessmentPassed === false ? 'failed' : computeStatus(expiryDate, completedDate));

  const profile = await loadEmployeeProfile(employeeUid);
  const resolvedFolderName = trainingFolderName
    || sharePointFolderName
    || profile?.trainingFolderName
    || '';

  const resolvedQuizId = quizId
    || extractQuizId(payload)
    || await loadQuizIdForCourse(resolvedCourseId, resolvedTitle);

  const shouldIssueCertificate = !assignOnly && status !== 'failed' && createCertificate !== false;

  const base = {
    employeeUid,
    employeeName: employeeName || profile?.employeeName || '',
    employeeEmail: employeeEmail || profile?.employeeEmail || '',
    courseId: resolvedCourseId,
    courseCode: resolvedCode,
    courseTitle: resolvedTitle,
    status,
    completedAt: completedDate ? Timestamp.fromDate(completedDate) : null,
    expiresAt: status === 'failed' ? null : (expiryDate ? Timestamp.fromDate(expiryDate) : null),
    source,
    sourceExternalId: sourceExternalId || '',
    score: assignOnly ? null : score,
    notes: notes || '',
    quizId: resolvedQuizId,
    loggedByUid: actor.uid || source,
    loggedByName: actor.fullName || actor.email || SOURCE_LABELS[source] || source,
    updatedAt: FieldValue.serverTimestamp(),
  };

  let ref;
  let isNew = false;
  if (existing) {
    ref = existing.ref;
    await ref.update(base);
  } else {
    isNew = true;
    ref = await db.collection('completions').add({
      ...base,
      createdAt: FieldValue.serverTimestamp(),
      certificateFileName: '',
      sharePointWebUrl: '',
      sharePointItemId: '',
      sharePointFolderPath: '',
    });
  }

  let certificateMeta = {};
  if (shouldIssueCertificate) {
    certificateMeta = await maybeIssueCertificate({
      completionId: ref.id,
      employeeUid,
      employeeName: employeeName || profile?.employeeName || '',
      employeeEmail: employeeEmail || profile?.employeeEmail || '',
      courseId: resolvedCourseId,
      courseTitle: resolvedTitle,
      courseLevel: parseCourseLevel(course?.level) || 1,
      completedAt: completedDate,
      expiresAt: expiryDate,
      source,
      trainingFolderName: resolvedFolderName,
      isActive,
    });
    if (Object.keys(certificateMeta).length) {
      await ref.update({
        ...certificateMeta,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // If assessment created a mapped course update, remove any leftover alias-titled duplicates.
  if (source === 'assessment' && resolvedCourseId && payload.courseTitle
    && normalizeName(payload.courseTitle) !== normalizeName(resolvedTitle)) {
    const aliases = await findCompletionsByEmployeeAndTitle(employeeUid, payload.courseTitle);
    for (const doc of aliases) {
      if (doc.id === ref.id) continue;
      if (doc.data().courseId === resolvedCourseId) continue;
      await doc.ref.delete();
    }
  }

  const snap = await ref.get();
  await clearCourseExclusion(employeeUid, resolvedTitle);

  if (assignOnly && resolvedQuizId) {
    await notifyAssessmentAssignment({
      employeeUid,
      employeeEmail: employeeEmail || profile?.employeeEmail || '',
      quizId: resolvedQuizId,
    });
  }

  return { completion: serializeCompletion(snap), isNew };
}

async function notifyAssessmentAssignment({ employeeUid, employeeEmail, quizId }) {
  const secret = getAssessmentProvisionSecret();
  if (!secret || !quizId || !employeeUid) return { ok: false, skipped: true };
  try {
    const response = await fetch(`${getAssessmentPortalUrl()}/api/assignFromTraining`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-provision-secret': secret,
      },
      body: JSON.stringify({
        employeeUid,
        employeeEmail: employeeEmail || '',
        quizIds: [quizId],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('Assessment assignment sync failed', response.status, data);
      return { ok: false, status: response.status, error: data.error || data };
    }
    return { ok: true, ...data };
  } catch (error) {
    console.warn('Assessment assignment sync failed', error);
    return { ok: false, error: error.message || 'Assessment assignment sync failed' };
  }
}

async function maybeIssueCertificate(options) {
  const {
    completionId,
    employeeName,
    courseTitle,
    courseId = '',
    courseLevel = null,
    completedAt,
    expiresAt,
    source,
    sharePointFolderName,
    trainingFolderName,
    isActive,
  } = options;

  let resolvedLevel = parseCourseLevel(courseLevel);
  if (!resolvedLevel && courseId) {
    const course = await loadCourse(courseId);
    resolvedLevel = parseCourseLevel(course?.level);
  }
  resolvedLevel = resolvedLevel || 1;

  const pdfBuffer = await buildTrainingCertificatePdf({
    employeeName,
    courseTitle,
    courseLevel: resolvedLevel,
    completedAt,
    expiresAt,
    certificateId: completionId,
    sourceLabel: SOURCE_LABELS[source] || source,
  });

  const safeCourse = String(courseTitle || 'Training')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Training';
  const fileName = `${safeCourse}.pdf`;

  const sharePointConfig = getSharePointConfig();
  if (!isSharePointConfigured(sharePointConfig)) {
    return {
      certificateFileName: fileName,
      sharePointWebUrl: '',
      sharePointItemId: '',
      sharePointFolderPath: '',
      certificatePendingSharePoint: true,
    };
  }

  try {
    const uploaded = await uploadTrainingCertificate(sharePointConfig, {
      fullName: employeeName,
      isActive,
      sharePointFolderName: trainingFolderName || sharePointFolderName || '',
      trainingFolderName: trainingFolderName || sharePointFolderName || '',
      courseTitle: safeCourse,
      fileName,
      fileBuffer: pdfBuffer,
      mimeType: 'application/pdf',
    });

    return {
      certificateFileName: uploaded.fileName,
      sharePointWebUrl: uploaded.sharePointWebUrl || '',
      sharePointItemId: uploaded.sharePointItemId || '',
      sharePointFolderPath: uploaded.folderPath || '',
      certificatePendingSharePoint: false,
    };
  } catch (error) {
    console.error('SharePoint certificate upload failed', error);
    return {
      certificateFileName: fileName,
      sharePointWebUrl: '',
      sharePointItemId: '',
      sharePointFolderPath: '',
      certificatePendingSharePoint: true,
      certificateError: error.message || 'SharePoint upload failed',
    };
  }
}

async function refreshExpiryStatuses() {
  const nowMs = Date.now();
  const snap = await db.collection('completions').limit(2000).get();
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  const commitBatch = async () => {
    if (!batchCount) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const doc of snap.docs) {
    const data = doc.data();
    const nextStatus = computeStatus(
      data.expiresAt?.toDate?.() || null,
      data.completedAt?.toDate?.() || null,
      nowMs,
    );
    if (!nextStatus || nextStatus === data.status) continue;
    batch.update(doc.ref, {
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    updated += 1;
    batchCount += 1;
    if (batchCount >= 400) await commitBatch();
  }

  await commitBatch();
  return updated;
}

const app = express();
app.use(corsMiddleware);
app.use(express.json({ limit: '8mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '8mb' }));

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  next();
});

app.get('/api/session', async (req, res) => {
  const auth = await requireUser(req, res, 'employee');
  if (!auth) return;
  res.json({
    user: auth.user,
    role: auth.role,
    portal: PORTAL_KEY,
    sharePointConfigured: isSharePointConfigured(getSharePointConfig()),
  });
});

app.post('/api/logout', async (_req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/courses', async (req, res) => {
  const auth = await requireUser(req, res, 'employee');
  if (!auth) return;

  const activeOnly = req.query.active !== '0';
  let query = db.collection('courses').orderBy('title');
  const snap = await query.get();
  let courses = snap.docs.map(serializeCourse);
  if (activeOnly) courses = courses.filter((course) => course.active);

  try {
    const mapsSnap = await db.collection('assessment_course_maps').get();
    const byCourseId = new Map();
    mapsSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const courseId = String(data.courseId || '').trim();
      if (!courseId) return;
      byCourseId.set(courseId, assessmentLinkFieldsFromMap(data, data.quizId || doc.id));
    });
    courses = courses.map((course) => {
      const link = byCourseId.get(course.id);
      return link ? { ...course, ...link } : course;
    });
  } catch (error) {
    console.error('course assessment maps failed', error);
  }

  res.json({ courses });
});

app.post('/api/courses', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  const title = String(req.body?.title || '').trim();
  if (!title) {
    res.status(400).json({ error: 'title is required.' });
    return;
  }

  const payload = {
    code: String(req.body?.code || '').trim(),
    title,
    category: String(req.body?.category || 'general').trim() || 'general',
    description: String(req.body?.description || '').trim(),
    validityMonths: req.body?.validityMonths === '' || req.body?.validityMonths == null
      ? null
      : Number(req.body.validityMonths),
    level: parseCourseLevel(req.body?.level) || 1,
    tierFamily: String(req.body?.tierFamily || '').trim(),
    active: req.body?.active !== false,
    sourceDefault: String(req.body?.sourceDefault || 'manual'),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdByUid: auth.user.uid,
  };

  if (payload.validityMonths != null && Number.isNaN(payload.validityMonths)) {
    res.status(400).json({ error: 'validityMonths must be a number.' });
    return;
  }
  if (req.body?.level !== undefined && req.body?.level !== null && req.body?.level !== '') {
    if (!parseCourseLevel(req.body.level)) {
      res.status(400).json({ error: 'level must be 1, 2, or 3.' });
      return;
    }
    payload.level = parseCourseLevel(req.body.level);
  }

  const ref = await db.collection('courses').add(payload);
  const snap = await ref.get();
  res.status(201).json({ course: serializeCourse(snap) });
});

app.patch('/api/courses/:id', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  const ref = db.collection('courses').doc(req.params.id);
  const existing = await ref.get();
  if (!existing.exists) {
    res.status(404).json({ error: 'Course not found.' });
    return;
  }

  const patch = { updatedAt: FieldValue.serverTimestamp() };
  for (const key of ['code', 'title', 'category', 'description', 'sourceDefault', 'tierFamily']) {
    if (req.body?.[key] !== undefined) patch[key] = String(req.body[key]).trim();
  }
  if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
  if (req.body?.level !== undefined) {
    const level = parseCourseLevel(req.body.level);
    if (!level) {
      res.status(400).json({ error: 'level must be 1, 2, or 3.' });
      return;
    }
    patch.level = level;
  }
  if (req.body?.validityMonths !== undefined) {
    patch.validityMonths = req.body.validityMonths === '' || req.body.validityMonths == null
      ? null
      : Number(req.body.validityMonths);
    if (patch.validityMonths != null && Number.isNaN(patch.validityMonths)) {
      res.status(400).json({ error: 'validityMonths must be a number.' });
      return;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'title') && !patch.title) {
    res.status(400).json({ error: 'title is required.' });
    return;
  }

  await ref.update(patch);

  const existingData = existing.data() || {};
  const completionPatch = {};
  if (patch.title && patch.title !== (existingData.title || '')) {
    completionPatch.courseTitle = patch.title;
  }
  if (patch.code !== undefined && patch.code !== (existingData.code || '')) {
    completionPatch.courseCode = patch.code;
  }
  if (Object.keys(completionPatch).length) {
    completionPatch.updatedAt = FieldValue.serverTimestamp();
    const completionsSnap = await db.collection('completions').where('courseId', '==', req.params.id).get();
    const docs = completionsSnap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((doc) => batch.update(doc.ref, completionPatch));
      await batch.commit();
    }
  }

  const snap = await ref.get();
  res.json({ course: serializeCourse(snap) });
});

app.get('/api/completions', async (req, res) => {
  const auth = await requireUser(req, res, 'employee');
  if (!auth) return;

  const requestedUid = String(req.query.employeeUid || '').trim();
  const status = String(req.query.status || '').trim();
  const expiringDays = req.query.expiringDays ? Number(req.query.expiringDays) : null;

  let employeeUid = auth.user.uid;
  if (requestedUid && requestedUid !== auth.user.uid) {
    if (!canTrain(auth.role)) {
      res.status(403).json({ error: 'Trainers only can view other employees.' });
      return;
    }
    employeeUid = requestedUid;
  } else if (!requestedUid && canTrain(auth.role) && req.query.scope === 'all') {
    employeeUid = '';
  }

  let snap;
  if (employeeUid) {
    snap = await db
      .collection('completions')
      .where('employeeUid', '==', employeeUid)
      .limit(300)
      .get();
  } else if (status === 'expired' || status === 'completed' || status === 'expiring_soon') {
    snap = await db
      .collection('completions')
      .where('status', '==', status)
      .orderBy('expiresAt', 'asc')
      .limit(300)
      .get();
  } else if (expiringDays && Number.isFinite(expiringDays)) {
    snap = await db.collection('completions').limit(2000).get();
  } else if (!employeeUid && canTrain(auth.role)) {
    // Trainer/admin directory lists — pull a wide set then filter in memory.
    snap = await db.collection('completions').limit(2000).get();
  } else {
    snap = await db.collection('completions').orderBy('completedAt', 'desc').limit(300).get();
  }

  const courseIndex = await loadCourseTierIndex();
  let completions = withCourseTiers(snap.docs.map(serializeCompletion), courseIndex);

  if (canTrain(auth.role) && (!employeeUid || requestedUid)) {
    const access = await loadAllowedEmployeeUids();
    if (employeeUid && !hasDirectoryAccess(employeeUid, access.allowed)) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    if (!employeeUid) {
      completions = completions.filter((item) => hasDirectoryAccess(item.employeeUid, access.allowed));
    }
  }

  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    completions = completions.filter((item) => {
      const hay = `${item.employeeName} ${item.employeeEmail} ${item.courseTitle} ${item.courseCode}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (status) {
    completions = completions.filter((item) => item.status === status);
  }

  if (expiringDays && Number.isFinite(expiringDays)) {
    const now = Date.now();
    const until = now + expiringDays * 24 * 60 * 60 * 1000;
    completions = completions.filter((item) => {
      if (!item.expiresAt || item.status === 'expired' || item.status === 'assigned') return false;
      const expires = new Date(item.expiresAt).getTime();
      return expires >= now && expires <= until;
    });
  }

  completions.sort((a, b) =>
    String(b.completedAt || b.expiresAt || '').localeCompare(String(a.completedAt || a.expiresAt || '')),
  );
  res.json({ completions });
});

app.get('/api/me/records', async (req, res) => {
  const auth = await requireUser(req, res, 'employee');
  if (!auth) return;

  const snap = await db
    .collection('completions')
    .where('employeeUid', '==', auth.user.uid)
    .get();

  const [links, courseIndex] = await Promise.all([
    loadAssessmentLinksByCourseId(),
    loadCourseTierIndex(),
  ]);
  const completions = withAssessmentLinks(
    withCourseTiers(snap.docs.map(serializeCompletion), courseIndex),
    links,
    { forTrainer: canTrain(auth.role), employeeUid: auth.user.uid },
  ).sort((a, b) => {
    const aDate = a.completedAt || a.expiresAt || a.createdAt || '';
    const bDate = b.completedAt || b.expiresAt || b.createdAt || '';
    return String(bDate).localeCompare(String(aDate));
  });
  const summary = {
    total: completions.length,
    valid: completions.filter((item) => item.status === 'completed').length,
    expired: completions.filter((item) => item.status === 'expired').length,
    expiringSoon: completions.filter((item) => item.status === 'expiring_soon').length,
    assigned: completions.filter((item) => item.status === 'assigned').length,
    failed: completions.filter((item) => item.status === 'failed').length,
    renewViaAssessment: completions.filter((item) => item.assessmentUrl).length,
  };

  res.json({
    employee: {
      uid: auth.user.uid,
      fullName: auth.user.fullName || '',
      email: auth.user.email || '',
      role: auth.role,
    },
    summary,
    completions,
    assessmentPortalUrl: getAssessmentPortalUrl(),
  });
});

app.post('/api/completions', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const result = await upsertCompletionRecord(
      {
        ...req.body,
        source: req.body?.source || 'manual',
        createCertificate: req.body?.createCertificate !== false,
      },
      auth.user,
    );
    res.status(result.isNew ? 201 : 200).json(result);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to save completion.' });
  }
});

/**
 * Trainer: log / assign one or more courses for many people.
 * Body: { courseId | courseIds, completedAt?, notes?, createCertificate?, assign?,
 *         employeeUids: string[] | employees: [{ employeeUid, employeeName?, employeeEmail? }] }
 */
app.post('/api/completions/batch', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const body = req.body || {};
    const completedAt = body.completedAt;
    const notes = body.notes || '';
    const assign = body.assign === true || String(body.status || '').toLowerCase() === 'assigned';
    const createCertificate = assign ? false : body.createCertificate !== false;
    const source = body.source || 'manual';

    const courseIdList = [];
    if (Array.isArray(body.courseIds) && body.courseIds.length) {
      body.courseIds.forEach((id) => {
        const trimmed = String(id || '').trim();
        if (trimmed) courseIdList.push(trimmed);
      });
    } else if (body.courseId) {
      const trimmed = String(body.courseId || '').trim();
      if (trimmed) courseIdList.push(trimmed);
    }

    // De-dupe course ids while preserving order.
    const seenCourses = new Set();
    const uniqueCourseIds = courseIdList.filter((id) => {
      if (seenCourses.has(id)) return false;
      seenCourses.add(id);
      return true;
    });

    if (!uniqueCourseIds.length) {
      res.status(400).json({ error: 'Select at least one course.' });
      return;
    }
    if (uniqueCourseIds.length > 50) {
      res.status(400).json({ error: 'Batch limited to 50 courses at a time.' });
      return;
    }

    let people = [];
    if (Array.isArray(body.employees) && body.employees.length) {
      people = body.employees
        .map((person) => ({
          employeeUid: String(person?.employeeUid || '').trim(),
          employeeName: String(person?.employeeName || '').trim(),
          employeeEmail: String(person?.employeeEmail || '').trim(),
        }))
        .filter((person) => person.employeeUid);
    } else if (Array.isArray(body.employeeUids)) {
      people = body.employeeUids
        .map((uid) => ({ employeeUid: String(uid || '').trim() }))
        .filter((person) => person.employeeUid);
    }

    // De-dupe by uid while preserving order.
    const seen = new Set();
    people = people.filter((person) => {
      if (seen.has(person.employeeUid)) return false;
      seen.add(person.employeeUid);
      return true;
    });

    if (!people.length) {
      res.status(400).json({ error: 'Select at least one employee.' });
      return;
    }
    if (people.length > 150) {
      res.status(400).json({ error: 'Batch limited to 150 people at a time.' });
      return;
    }
    if (people.length * uniqueCourseIds.length > 500) {
      res.status(400).json({ error: 'Batch limited to 500 course assignments at a time.' });
      return;
    }

    const courses = [];
    for (const courseId of uniqueCourseIds) {
      const course = await loadCourse(courseId);
      if (!course) {
        res.status(404).json({ error: `Course not found: ${courseId}` });
        return;
      }
      courses.push(course);
    }

    const results = [];
    let created = 0;
    let updated = 0;
    let failed = 0;
    let alreadyHeld = 0;

    for (const course of courses) {
      for (const person of people) {
        try {
          const result = await upsertCompletionRecord(
            {
              employeeUid: person.employeeUid,
              employeeName: person.employeeName,
              employeeEmail: person.employeeEmail,
              courseId: course.id,
              courseTitle: course.title,
              courseCode: course.code,
              completedAt: assign ? null : completedAt,
              notes,
              createCertificate,
              assign,
              source,
            },
            auth.user,
          );
          if (result.alreadyHeld) alreadyHeld += 1;
          else if (result.isNew) created += 1;
          else updated += 1;
          results.push({
            employeeUid: person.employeeUid,
            employeeName: result.completion?.employeeName || person.employeeName || '',
            courseId: course.id,
            courseTitle: course.title || '',
            ok: true,
            isNew: result.isNew,
            completionId: result.completion?.id || '',
            sharePointWebUrl: result.completion?.sharePointWebUrl || '',
            certificatePendingSharePoint: !!result.completion?.certificatePendingSharePoint,
            alreadyHeld: !!result.alreadyHeld,
            status: result.completion?.status || '',
          });
        } catch (error) {
          failed += 1;
          console.error('batch completion failed', person.employeeUid, course.id, error);
          results.push({
            employeeUid: person.employeeUid,
            employeeName: person.employeeName || '',
            courseId: course.id,
            courseTitle: course.title || '',
            ok: false,
            error: error.message || 'Failed to save completion.',
          });
        }
      }
    }

    const primaryCourse = courses[0];
    res.status(failed && failed === results.length ? 500 : 200).json({
      course: primaryCourse
        ? {
            id: primaryCourse.id,
            title: primaryCourse.title,
            code: primaryCourse.code,
          }
        : null,
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        code: course.code,
      })),
      totals: {
        requested: results.length,
        people: people.length,
        courses: courses.length,
        created,
        updated,
        failed,
        alreadyHeld,
        certificates: assign ? 0 : results.filter((row) => row.ok && !row.alreadyHeld).length,
      },
      results,
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to save batch completions.' });
  }
});

/**
 * Admin: amend completion / expiry dates to correct errors.
 */
app.patch('/api/completions/:id', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const ref = db.collection('completions').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Completion not found.' });
    return;
  }

  try {
    const data = snap.data();
    let completedAt = data.completedAt?.toDate?.() || null;
    let expiresAt = data.expiresAt?.toDate?.() || null;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'completedAt')) {
      if (req.body.completedAt === null || req.body.completedAt === '') {
        completedAt = null;
      } else {
        const parsed = new Date(req.body.completedAt);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Invalid completedAt.' });
          return;
        }
        completedAt = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'expiresAt')) {
      if (req.body.expiresAt === null || req.body.expiresAt === '') {
        expiresAt = null;
      } else {
        const parsed = new Date(req.body.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Invalid expiresAt.' });
          return;
        }
        expiresAt = parsed;
      }
    }

    const status = computeStatus(expiresAt, completedAt);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;

    const patch = {
      status,
      completedAt: completedAt ? Timestamp.fromDate(completedAt) : null,
      expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      lastAmendedAt: FieldValue.serverTimestamp(),
      lastAmendedByUid: auth.user.uid,
      lastAmendedByName: auth.user.fullName || auth.user.email || 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (notes !== undefined) patch.notes = notes;

    await ref.update(patch);
    const updated = await ref.get();
    res.json({ completion: serializeCompletion(updated) });
  } catch (error) {
    console.error('amend completion failed', error);
    res.status(500).json({ error: error.message || 'Failed to amend completion.' });
  }
});

/**
 * Admin: remove a course from an employee (deletes the completion / assignment).
 */
app.delete('/api/completions/:id', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const ref = db.collection('completions').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Completion not found.' });
    return;
  }

  try {
    const completion = serializeCompletion(snap);
    await ref.delete();
    await saveCourseExclusion(completion, auth.user);
    console.info('completion deleted', {
      id: completion.id,
      employeeUid: completion.employeeUid,
      employeeName: completion.employeeName,
      courseTitle: completion.courseTitle,
      actorUid: auth.user.uid,
      actorName: auth.user.fullName || auth.user.email,
    });
    res.json({ ok: true, id: completion.id, completion });
  } catch (error) {
    console.error('delete completion failed', error);
    res.status(500).json({ error: error.message || 'Failed to remove course.' });
  }
});

/**
 * Trainer+: required training log — assigned, expired, due within 30 days, failed,
 * sorted most overdue first (expiresAt ascending; assigned with no date first).
 */
app.get('/api/required-training', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const department = String(req.query.department || '').trim().toLowerCase();
    const now = Date.now();
    const until = now + EXPIRING_SOON_MS;

    const [completionsSnap, coursesSnap, access] = await Promise.all([
      db.collection('completions').get(),
      db.collection('courses').get(),
      loadDirectoryAccess(),
    ]);
    const courseIndex = courseIndexFromSnap(coursesSnap);
    const allowedUids = access.allowedUids;
    const profilesSnap = access.profilesSnap;

    const profilesByUid = new Map(
      profilesSnap.docs
        .map((doc) => serializeEmployeeProfile(doc))
        .filter((profile) => hasDirectoryAccess(profile.employeeUid, allowedUids, profile))
        .map((profile) => [profile.employeeUid, profile]),
    );

    let rows = withCourseTiers(
      completionsSnap.docs.map(serializeCompletion),
      courseIndex,
    ).map((item) => {
      const profile = profilesByUid.get(item.employeeUid) || {};
      return {
        ...item,
        department: profile.department || '',
      };
    }).filter((item) => {
      if (!hasDirectoryAccess(item.employeeUid, allowedUids, profilesByUid.get(item.employeeUid))) return false;
      if (item.status === 'failed' || item.status === 'assigned') return true;
      if (!item.expiresAt) return false;
      const expires = new Date(item.expiresAt).getTime();
      if (!Number.isFinite(expires)) return false;
      return expires < now || (expires >= now && expires <= until);
    });

    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.employeeName} ${row.employeeEmail} ${row.courseTitle} ${row.department}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (department) {
      rows = rows.filter((row) => String(row.department || '').toLowerCase() === department);
    }

    rows.sort((a, b) => {
      const aExp = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
      const bExp = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      if (aExp !== bExp) return aExp - bExp;
      return String(a.employeeName || '').localeCompare(String(b.employeeName || ''));
    });

    const links = await loadAssessmentLinksByCourseId();
    rows = withAssessmentLinks(rows, links, { forTrainer: true });

    const departments = [...new Set(
      [...profilesByUid.values()].map((row) => row.department).filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));

    res.json({
      rows,
      departments,
      totals: {
        total: rows.length,
        expired: rows.filter((row) => row.status === 'expired').length,
        expiringSoon: rows.filter((row) => row.status === 'expiring_soon').length,
        assigned: rows.filter((row) => row.status === 'assigned').length,
        failed: rows.filter((row) => row.status === 'failed').length,
      },
    });
  } catch (error) {
    console.error('required training failed', error);
    res.status(500).json({ error: error.message || 'Failed to load required training.' });
  }
});

/**
 * Service ingest for Assessment / CPC portals.
 * Header: x-ingest-secret: <TRAINING_INGEST_SECRET>
 */
app.post('/api/ingest/completion', async (req, res) => {
  const secret = getIngestSecret();
  if (!secret || req.headers['x-ingest-secret'] !== secret) {
    res.status(401).json({ error: 'Invalid ingest secret.' });
    return;
  }

  const source = String(req.body?.source || '').trim();
  if (!['assessment', 'cpc'].includes(source)) {
    res.status(400).json({ error: 'source must be assessment or cpc.' });
    return;
  }

  try {
    const result = await upsertCompletionRecord(
      {
        ...req.body,
        source,
        quizId: extractQuizId(req.body || {}),
        sourceExternalId: String(req.body?.sourceExternalId || req.body?.externalId || '').trim(),
        createCertificate: req.body?.createCertificate !== false,
      },
      { uid: source, fullName: SOURCE_LABELS[source] },
    );
    res.status(result.isNew ? 201 : 200).json(result);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Ingest failed.' });
  }
});

/**
 * Service: Assessment portal pulls a staff member's training records
 * (assigned / expired / valid) including linked quiz ids.
 * Header: x-ingest-secret: <TRAINING_INGEST_SECRET>
 */
app.get('/api/ingest/records', async (req, res) => {
  const secret = getIngestSecret();
  if (!secret || req.headers['x-ingest-secret'] !== secret) {
    res.status(401).json({ error: 'Invalid ingest secret.' });
    return;
  }

  try {
    let employeeUid = String(req.query.employeeUid || req.query.uid || '').trim();
    const employeeEmail = String(req.query.employeeEmail || req.query.email || '').trim().toLowerCase();
    if (!employeeUid && employeeEmail) {
      const profilesSnap = await db.collection('employee_profiles').get();
      const match = profilesSnap.docs.find((doc) => (
        String(doc.data()?.employeeEmail || '').trim().toLowerCase() === employeeEmail
      ));
      employeeUid = match?.id || '';
    }
    if (!employeeUid) {
      res.status(400).json({ error: 'employeeUid or employeeEmail is required.' });
      return;
    }

    const [profile, completionsSnap, courseIndex, links] = await Promise.all([
      loadEmployeeProfile(employeeUid),
      db.collection('completions').where('employeeUid', '==', employeeUid).get(),
      loadCourseTierIndex(),
      loadAssessmentLinksByCourseId(),
    ]);

    const completions = withAssessmentLinks(
      withCourseTiers(completionsSnap.docs.map(serializeCompletion), courseIndex),
      links,
      { employeeUid },
    ).sort((a, b) => String(b.completedAt || b.expiresAt || '').localeCompare(String(a.completedAt || a.expiresAt || '')));

    const due = completions.filter((item) => (
      item.status === 'assigned'
      || item.status === 'expired'
      || item.status === 'expiring_soon'
      || item.status === 'failed'
    ));

    res.json({
      employeeUid,
      employee: {
        uid: employeeUid,
        employeeName: profile?.employeeName || completions[0]?.employeeName || '',
        employeeEmail: profile?.employeeEmail || completions[0]?.employeeEmail || employeeEmail,
      },
      summary: summarizeEmployeeCompletions(completions),
      records: completions,
      due,
      dueQuizIds: [...new Set(due.map((item) => item.assessmentQuizId || item.quizId).filter(Boolean))],
    });
  } catch (error) {
    console.error('ingest records failed', error);
    res.status(500).json({ error: error.message || 'Failed to load records.' });
  }
});

app.post('/api/completions/:id/certificate', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  const ref = db.collection('completions').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Completion not found.' });
    return;
  }

  const data = snap.data();
  const profile = await loadEmployeeProfile(data.employeeUid);
  const meta = await maybeIssueCertificate({
    completionId: snap.id,
    employeeUid: data.employeeUid,
    employeeName: data.employeeName,
    employeeEmail: data.employeeEmail,
    courseId: data.courseId || '',
    courseTitle: data.courseTitle,
    completedAt: data.completedAt?.toDate?.() || new Date(),
    expiresAt: data.expiresAt?.toDate?.() || null,
    source: data.source || 'manual',
    trainingFolderName: req.body?.trainingFolderName
      || req.body?.sharePointFolderName
      || profile?.trainingFolderName
      || '',
    isActive: req.body?.isActive !== false,
  });

  await ref.update({
    ...meta,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await ref.get();
  res.json({ completion: serializeCompletion(updated) });
});

app.get('/api/dashboard', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  const now = Date.now();
  const [completionsSnap, coursesSnap, access] = await Promise.all([
    db.collection('completions').get(),
    db.collection('courses').get(),
    loadAllowedEmployeeUids(),
  ]);
  const completions = withCourseTiers(
    completionsSnap.docs.map(serializeCompletion),
    courseIndexFromSnap(coursesSnap),
    now,
  ).filter((item) => hasDirectoryAccess(item.employeeUid, access.allowed));
  completions.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));

  res.json({
    coursesActive: coursesSnap.docs.filter((doc) => doc.data().active !== false).length,
    completionsTotal: completions.length,
    expired: completions.filter((item) => item.status === 'expired').length,
    expiringSoon: completions.filter((item) => item.status === 'expiring_soon').length,
    failed: completions.filter((item) => item.status === 'failed').length,
    employeesWithRecords: new Set(completions.map((item) => item.employeeUid).filter(Boolean)).size,
    recent: completions.slice(0, 12),
  });
});

function summarizeEmployeeCompletions(completions) {
  return {
    total: completions.length,
    valid: completions.filter((item) => item.status === 'completed').length,
    expired: completions.filter((item) => item.status === 'expired').length,
    assigned: completions.filter((item) => item.status === 'assigned').length,
    expiringSoon: completions.filter((item) => item.status === 'expiring_soon').length,
    failed: completions.filter((item) => item.status === 'failed').length,
  };
}

/**
 * Trainer+ employee directory with training summary.
 */
app.get('/api/employees', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const department = String(req.query.department || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    const [profilesSnap, completionsSnap, coursesSnap, access] = await Promise.all([
      db.collection('employee_profiles').get(),
      db.collection('completions').get(),
      db.collection('courses').get(),
      loadDirectoryAccess(),
    ]);
    const allowedUids = access.allowedUids;

    const completions = withCourseTiers(
      completionsSnap.docs.map(serializeCompletion),
      courseIndexFromSnap(coursesSnap),
    );
    const byUid = new Map();

    profilesSnap.docs.forEach((doc) => {
      const profile = serializeEmployeeProfile(doc);
      if (!hasDirectoryAccess(profile.employeeUid, allowedUids, profile)) return;
      byUid.set(profile.employeeUid, {
        ...profile,
        completions: [],
      });
    });

    completions.forEach((item) => {
      if (!item.employeeUid) return;
      if (!hasDirectoryAccess(item.employeeUid, allowedUids, byUid.get(item.employeeUid))) return;
      if (!byUid.has(item.employeeUid)) {
        byUid.set(item.employeeUid, {
          employeeUid: item.employeeUid,
          employeeName: item.employeeName || 'Unknown',
          employeeEmail: item.employeeEmail || '',
          department: '',
          trainingFolderName: '',
          trainingFolderWebUrl: '',
          trainingFolderConfirmedAt: null,
          matrixName: '',
          updatedAt: null,
          completions: [],
        });
      }
      const row = byUid.get(item.employeeUid);
      row.completions.push(item);
      if (!row.employeeName && item.employeeName) row.employeeName = item.employeeName;
      if (!row.employeeEmail && item.employeeEmail) row.employeeEmail = item.employeeEmail;
    });

    const now = Date.now();
    let employees = [...byUid.values()].map((row) => {
      const summary = summarizeEmployeeCompletions(row.completions, now);
      const { completions: _omit, ...employee } = row;
      return {
        ...employee,
        summary,
        overallStatus: summary.expired > 0
          ? 'expired'
          : summary.expiringSoon > 0
            ? 'expiring'
            : summary.assigned > 0 && summary.valid === 0
              ? 'assigned'
              : summary.valid > 0
                ? 'valid'
                : 'none',
      };
    });

    if (q) {
      employees = employees.filter((row) => {
        const hay = `${row.employeeName} ${row.employeeEmail} ${row.department} ${row.matrixName}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (department) {
      employees = employees.filter((row) => String(row.department || '').toLowerCase() === department);
    }
    if (statusFilter === 'expired') {
      employees = employees.filter((row) => row.summary.expired > 0);
    } else if (statusFilter === 'expiring') {
      employees = employees.filter((row) => row.summary.expiringSoon > 0);
    } else if (statusFilter === 'valid') {
      employees = employees.filter((row) => row.summary.valid > 0 && row.summary.expired === 0);
    }

    employees.sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || '')));

    const departments = [...new Set(
      [...byUid.values()].map((row) => row.department).filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));

    res.json({
      employees,
      departments,
      totals: {
        employees: employees.length,
        withExpired: employees.filter((row) => row.summary.expired > 0).length,
        withExpiring: employees.filter((row) => row.summary.expiringSoon > 0).length,
      },
    });
  } catch (error) {
    console.error('employees list failed', error);
    res.status(500).json({ error: error.message || 'Failed to load employees.' });
  }
});

/**
 * Trainer+ single employee training record.
 */
app.get('/api/employees/:uid', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  const uid = String(req.params.uid || '').trim();
  if (!uid) {
    res.status(400).json({ error: 'uid is required.' });
    return;
  }

  try {
    const [profile, completionsSnap, courseIndex, access] = await Promise.all([
      loadEmployeeProfile(uid),
      db.collection('completions').where('employeeUid', '==', uid).get(),
      loadCourseTierIndex(),
      loadAllowedEmployeeUids(),
    ]);
    if (!hasDirectoryAccess(uid, access.allowed, profile)) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }

    const completions = withAssessmentLinks(
      withCourseTiers(
        completionsSnap.docs.map(serializeCompletion),
        courseIndex,
      ).sort((a, b) => String(b.completedAt || b.expiresAt || '').localeCompare(String(a.completedAt || a.expiresAt || ''))),
      await loadAssessmentLinksByCourseId(),
      { forTrainer: true, employeeUid: uid },
    );

    if (!profile && !completions.length) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }

    const employee = profile
      ? serializeEmployeeProfile(profile)
      : {
          employeeUid: uid,
          employeeName: completions[0]?.employeeName || 'Unknown',
          employeeEmail: completions[0]?.employeeEmail || '',
          department: '',
          trainingFolderName: '',
          trainingFolderWebUrl: '',
        };

    res.json({
      employee,
      completions,
      summary: summarizeEmployeeCompletions(completions),
    });
  } catch (error) {
    console.error('employee detail failed', error);
    res.status(500).json({ error: error.message || 'Failed to load employee.' });
  }
});

/**
 * Trainer+ SharePoint-style training matrix (flat rows).
 */
app.get('/api/matrix', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const department = String(req.query.department || '').trim().toLowerCase();
    const course = String(req.query.course || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const courseType = String(req.query.courseType || '').trim().toLowerCase();

    const [profilesSnap, completionsSnap, coursesSnap, access] = await Promise.all([
      db.collection('employee_profiles').get(),
      db.collection('completions').get(),
      db.collection('courses').get(),
      loadDirectoryAccess(),
    ]);
    const allowedUids = access.allowedUids;

    const profilesByUid = new Map(
      profilesSnap.docs
        .map((doc) => serializeEmployeeProfile(doc))
        .filter((profile) => hasDirectoryAccess(profile.employeeUid, allowedUids, profile))
        .map((profile) => [profile.employeeUid, profile]),
    );
    const serializedCourses = coursesSnap.docs.map(serializeCourse);
    const coursesById = new Map(
      serializedCourses.map((course) => [course.id, course]),
    );
    const courseIndex = buildCourseTierIndex(serializedCourses);

    let rows = withCourseTiers(
      completionsSnap.docs.map(serializeCompletion),
      courseIndex,
    ).filter((item) => hasDirectoryAccess(item.employeeUid, allowedUids, profilesByUid.get(item.employeeUid))).map((item) => {
      const profile = profilesByUid.get(item.employeeUid) || {};
      const courseDoc = item.courseId ? coursesById.get(item.courseId) : null;
      return {
        id: item.id,
        employeeUid: item.employeeUid,
        employeeName: item.employeeName || profile.employeeName || '',
        employeeEmail: item.employeeEmail || profile.employeeEmail || '',
        department: profile.department || '',
        courseId: item.courseId || '',
        courseName: item.courseTitle || '',
        courseCode: item.courseCode || courseDoc?.code || '',
        courseType: courseDoc?.category || '',
        validityMonths: courseDoc?.validityMonths ?? null,
        courseLevel: item.courseLevel || courseDoc?.level || 1,
        completedAt: item.completedAt,
        dueDate: item.expiresAt,
        status: item.status,
        source: item.source,
        notes: item.notes || '',
        sharePointWebUrl: item.sharePointWebUrl || '',
        trainingFolderName: profile.trainingFolderName || '',
        coveredByCourseTitle: item.coveredByCourseTitle || '',
        coveredByLevel: item.coveredByLevel || null,
      };
    });

    const links = await loadAssessmentLinksByCourseId();
    rows = withAssessmentLinks(
      rows.map((row) => ({
        ...row,
        courseTitle: row.courseName,
        expiresAt: row.dueDate,
      })),
      links,
      { forTrainer: true },
    );

    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.employeeName} ${row.employeeEmail} ${row.courseName} ${row.department}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (department) {
      rows = rows.filter((row) => String(row.department || '').toLowerCase() === department);
    }
    if (course) {
      rows = rows.filter((row) => String(row.courseName || '').toLowerCase().includes(course));
    }
    if (status) {
      rows = rows.filter((row) => String(row.status || '').toLowerCase() === status);
    }
    if (courseType) {
      rows = rows.filter((row) => String(row.courseType || '').toLowerCase() === courseType);
    }

    rows.sort((a, b) => {
      const nameCmp = String(a.employeeName).localeCompare(String(b.employeeName));
      if (nameCmp !== 0) return nameCmp;
      return String(a.courseName).localeCompare(String(b.courseName));
    });

    const departments = [...new Set(
      [...profilesByUid.values()].map((row) => row.department).filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));

    const courseNames = [...new Set(rows.map((row) => row.courseName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    res.json({
      rows,
      departments,
      courseNames,
      totals: {
        rows: rows.length,
        employees: new Set(rows.map((row) => row.employeeUid).filter(Boolean)).size,
        expired: rows.filter((row) => row.status === 'expired').length,
        expiringSoon: rows.filter((row) => row.status === 'expiring_soon').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        valid: rows.filter((row) => row.status === 'completed').length,
        assigned: rows.filter((row) => row.status === 'assigned').length,
      },
    });
  } catch (error) {
    console.error('matrix failed', error);
    res.status(500).json({ error: error.message || 'Failed to load training matrix.' });
  }
});

/**
 * Service provision from Employee Portal when training_app access is granted.
 * Ensures the employee's SharePoint training folder exists.
 */
app.post('/api/provisionUser', async (req, res) => {
  if (!requireProvisionSecret(req, res)) return;

  const uid = String(req.body?.uid || '').trim();
  const fullName = String(req.body?.fullName || '').trim();
  const email = String(req.body?.email || '').trim();
  const role = normalizeTrainingRole(req.body?.role || 'employee') || 'employee';

  if (!uid || !fullName) {
    res.status(400).json({ error: 'uid and fullName are required.' });
    return;
  }

  try {
    const existing = await loadEmployeeProfile(uid);
    const folderName = existing?.trainingFolderName || buildEmployeeFolderName(fullName);
    let folderMeta = {
      folderName,
      folderPath: folderName,
      webUrl: existing?.trainingFolderWebUrl || '',
    };
    let sharePointWarning = '';

    const sharePointConfig = getSharePointConfig();
    if (isSharePointConfigured(sharePointConfig)) {
      try {
        folderMeta = await ensureEmployeeFolder(sharePointConfig, {
          fullName,
          trainingFolderName: folderName,
        });
      } catch (sharePointError) {
        // Never block local profile creation on SharePoint — trainers need the user visible.
        sharePointWarning = sharePointError.message || 'SharePoint folder creation failed.';
        console.warn('provisionUser SharePoint failed (continuing)', uid, sharePointWarning);
      }
    }

    const profile = await upsertEmployeeProfile(uid, {
      employeeName: fullName,
      employeeEmail: email,
      role,
      accessEnabled: true,
      accessRevokedAt: FieldValue.delete(),
      trainingFolderName: folderMeta.folderName || folderName,
      trainingFolderWebUrl: folderMeta.webUrl || existing?.trainingFolderWebUrl || '',
      trainingFolderConfirmedAt: existing?.trainingFolderConfirmedAt || FieldValue.serverTimestamp(),
    });

    res.json({
      ok: true,
      profile: serializeEmployeeProfile(profile),
      folder: folderMeta,
      ...(sharePointWarning ? { sharePointWarning } : {}),
    });
  } catch (error) {
    console.error('provisionUser failed', error);
    res.status(500).json({ error: error.message || 'Failed to provision training user.' });
  }
});

/**
 * Service deprovision from Employee Portal when training_app access is removed.
 * Hides the person from trainer lists without deleting historical records.
 */
app.post('/api/deprovisionUser', async (req, res) => {
  if (!requireProvisionSecret(req, res)) return;

  const uid = String(req.body?.uid || '').trim();
  if (!uid) {
    res.status(400).json({ error: 'uid is required.' });
    return;
  }

  try {
    const existing = await loadEmployeeProfile(uid);
    const profile = await markEmployeeAccess(uid, false, {
      employeeName: String(req.body?.fullName || existing?.employeeName || '').trim() || existing?.employeeName || '',
      employeeEmail: String(req.body?.email || existing?.employeeEmail || '').trim() || existing?.employeeEmail || '',
    });
    res.json({
      ok: true,
      profile: serializeEmployeeProfile(profile),
    });
  } catch (error) {
    console.error('deprovisionUser failed', error);
    res.status(500).json({ error: error.message || 'Failed to deprovision training user.' });
  }
});

app.get('/api/admin/mappings', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  try {
    const [profilesSnap, folders, access] = await Promise.all([
      db.collection('employee_profiles').get(),
      isSharePointConfigured(getSharePointConfig())
        ? listEmployeeFolders(getSharePointConfig())
        : Promise.resolve([]),
      loadAllowedEmployeeUids(),
    ]);

    const profiles = profilesSnap.docs
      .map(serializeEmployeeProfile)
      .filter((profile) => hasDirectoryAccess(profile.employeeUid, access.allowed, profile));
    const mappedFolderNames = new Set(profiles.map((p) => normalizeName(p.trainingFolderName)).filter(Boolean));

    res.json({
      profiles,
      folders,
      unmappedFolders: folders.filter((folder) => !mappedFolderNames.has(normalizeName(folder.name))),
      sharePointConfigured: isSharePointConfigured(getSharePointConfig()),
    });
  } catch (error) {
    console.error('admin mappings failed', error);
    res.status(500).json({ error: error.message || 'Failed to load mappings.' });
  }
});

app.post('/api/admin/mappings/confirm', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const employeeUid = String(req.body?.employeeUid || '').trim();
  const employeeName = String(req.body?.employeeName || '').trim();
  const employeeEmail = String(req.body?.employeeEmail || '').trim();
  const trainingFolderName = String(req.body?.trainingFolderName || '').trim();
  const createIfMissing = req.body?.createIfMissing !== false;

  if (!employeeUid || !trainingFolderName) {
    res.status(400).json({ error: 'employeeUid and trainingFolderName are required.' });
    return;
  }

  try {
    let folderMeta = {
      folderName: trainingFolderName,
      folderPath: trainingFolderName,
      webUrl: '',
    };

    const sharePointConfig = getSharePointConfig();
    if (isSharePointConfigured(sharePointConfig) && createIfMissing) {
      folderMeta = await ensureEmployeeFolder(sharePointConfig, {
        fullName: employeeName || trainingFolderName,
        trainingFolderName,
      });
    }

    const profile = await upsertEmployeeProfile(employeeUid, {
      employeeName: employeeName || trainingFolderName,
      employeeEmail,
      trainingFolderName: folderMeta.folderName || trainingFolderName,
      trainingFolderWebUrl: folderMeta.webUrl || '',
      trainingFolderConfirmedAt: FieldValue.serverTimestamp(),
      trainingFolderConfirmedByUid: auth.user.uid,
    });

    res.json({ profile: serializeEmployeeProfile(profile), folder: folderMeta });
  } catch (error) {
    console.error('confirm mapping failed', error);
    res.status(500).json({ error: error.message || 'Failed to confirm mapping.' });
  }
});

app.get('/api/admin/folder-suggestions', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const name = String(req.query.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'name is required.' });
    return;
  }

  try {
    const sharePointConfig = getSharePointConfig();
    if (!isSharePointConfigured(sharePointConfig)) {
      res.json({ suggestions: [] });
      return;
    }
    const folders = await listEmployeeFolders(sharePointConfig);
    res.json({ suggestions: suggestEmployeeFolders(name, folders) });
  } catch (error) {
    console.error('folder suggestions failed', error);
    res.status(500).json({ error: error.message || 'Failed to suggest folders.' });
  }
});

/**
 * Admin: Assessment quiz → Training course mappings.
 */
app.get('/api/admin/assessment-maps', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  try {
    const [mapsSnap, coursesSnap, quizzes] = await Promise.all([
      db.collection('assessment_course_maps').get(),
      db.collection('courses').get(),
      fetchAssessmentQuizzes().catch((error) => {
        console.error('assessment quizzes fetch failed', error);
        return [];
      }),
    ]);

    const maps = mapsSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        quizId: String(data.quizId || doc.id),
        quizTitle: data.quizTitle || '',
        courseId: data.courseId || '',
        courseTitle: data.courseTitle || '',
        updatedAt: toIso(data.updatedAt),
        updatedByUid: data.updatedByUid || '',
      };
    });

    const courses = coursesSnap.docs
      .map((doc) => serializeCourse(doc))
      .filter((course) => course.active !== false)
      .sort((a, b) => a.title.localeCompare(b.title));

    res.json({
      maps,
      courses,
      quizzes,
      assessmentPortalUrl: getAssessmentPortalUrl(),
      quizzesAvailable: quizzes.length > 0,
    });
  } catch (error) {
    console.error('assessment maps list failed', error);
    res.status(500).json({ error: error.message || 'Failed to load assessment maps.' });
  }
});

app.put('/api/admin/assessment-maps', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const quizId = String(req.body?.quizId || '').trim();
  const quizTitle = String(req.body?.quizTitle || '').trim();
  const courseId = String(req.body?.courseId || '').trim();
  const mergeDuplicates = req.body?.mergeDuplicates !== false;

  if (!quizId || !courseId) {
    res.status(400).json({ error: 'quizId and courseId are required.' });
    return;
  }

  try {
    const course = await loadCourse(courseId);
    if (!course) {
      res.status(404).json({ error: 'Training course not found.' });
      return;
    }

    const ref = db.collection('assessment_course_maps').doc(quizId);
    await ref.set({
      quizId,
      quizTitle: quizTitle || '',
      courseId: course.id,
      courseTitle: course.title || '',
      trainerLed: req.body?.trainerLed === true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.user.uid,
    }, { merge: true });

    let mergeResult = { mergedEmployees: 0, deleted: 0, updated: 0 };
    if (mergeDuplicates && quizTitle) {
      mergeResult = await mergeAliasCompletionsIntoCourse({
        quizTitle,
        courseId: course.id,
        courseTitle: course.title || '',
        actor: auth.user,
      });
    }

    const snap = await ref.get();
    const data = snap.data() || {};
    res.json({
      map: {
        quizId: String(data.quizId || snap.id),
        quizTitle: data.quizTitle || '',
        courseId: data.courseId || '',
        courseTitle: data.courseTitle || '',
        updatedAt: toIso(data.updatedAt),
        updatedByUid: data.updatedByUid || '',
      },
      merge: mergeResult,
    });
  } catch (error) {
    console.error('assessment map save failed', error);
    res.status(500).json({ error: error.message || 'Failed to save assessment map.' });
  }
});

app.delete('/api/admin/assessment-maps/:quizId', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  const quizId = String(req.params.quizId || '').trim();
  if (!quizId) {
    res.status(400).json({ error: 'quizId is required.' });
    return;
  }

  try {
    await db.collection('assessment_course_maps').doc(quizId).delete();
    res.json({ ok: true, quizId });
  } catch (error) {
    console.error('assessment map delete failed', error);
    res.status(500).json({ error: error.message || 'Failed to delete assessment map.' });
  }
});

/**
 * Ops: seed Phishing Assessment → Phishing Awareness and merge duplicates.
 * Auth: admin session or x-provision-secret.
 */
app.post('/api/admin/assessment-maps/seed-phishing', async (req, res) => {
  const provisionOk = Boolean(getProvisionSecret())
    && req.headers['x-provision-secret'] === getProvisionSecret();
  if (!provisionOk) {
    const auth = await requireUser(req, res, 'admin');
    if (!auth) return;
  }

  try {
    const quizzes = await fetchAssessmentQuizzes();
    const phishingQuiz = quizzes.find((quiz) => /phish/i.test(quiz.title || ''));
    if (!phishingQuiz) {
      res.status(404).json({ error: 'Phishing Assessment quiz not found in Assessment portal.' });
      return;
    }

    const coursesSnap = await db.collection('courses').get();
    const courses = coursesSnap.docs.map((doc) => serializeCourse(doc));
    const phishingCourse = courses.find((course) => /phish/i.test(course.title || '') && /awareness/i.test(course.title || ''))
      || courses.find((course) => /phish/i.test(course.title || ''));
    if (!phishingCourse) {
      res.status(404).json({ error: 'Phishing Awareness course not found in Training.' });
      return;
    }

    const quizId = String(phishingQuiz.id);
    await db.collection('assessment_course_maps').doc(quizId).set({
      quizId,
      quizTitle: phishingQuiz.title || '',
      courseId: phishingCourse.id,
      courseTitle: phishingCourse.title || '',
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: 'seed-phishing',
    }, { merge: true });

    const merge = await mergeAliasCompletionsIntoCourse({
      quizTitle: phishingQuiz.title || '',
      courseId: phishingCourse.id,
      courseTitle: phishingCourse.title || '',
      actor: { uid: 'seed-phishing' },
    });

    res.json({
      ok: true,
      map: {
        quizId,
        quizTitle: phishingQuiz.title || '',
        courseId: phishingCourse.id,
        courseTitle: phishingCourse.title || '',
      },
      merge,
    });
  } catch (error) {
    console.error('seed phishing map failed', error);
    res.status(500).json({ error: error.message || 'Failed to seed phishing map.' });
  }
});

function scoreQuizCourseMatch(quizTitle, courseTitle) {
  const quiz = normalizeName(String(quizTitle || '').replace(/\bassessment\b/gi, ''));
  const course = normalizeName(courseTitle);
  if (!quiz || !course) return 0;
  if (quiz === course) return 100;
  if (course.includes(quiz) || quiz.includes(course)) return 90;
  const quizParts = quiz.split(' ').filter((part) => part.length > 2);
  const courseParts = course.split(' ');
  const overlap = quizParts.filter((part) => courseParts.includes(part)).length;
  if (!overlap) return 0;
  return Math.round((overlap / Math.max(quizParts.length, 1)) * 80);
}

/**
 * Ops/admin: auto-map Assessment quizzes to best-matching Training courses.
 */
app.post('/api/admin/assessment-maps/auto-map', async (req, res) => {
  const provisionOk = Boolean(getProvisionSecret())
    && req.headers['x-provision-secret'] === getProvisionSecret();
  let actorUid = 'auto-map';
  if (!provisionOk) {
    const auth = await requireUser(req, res, 'admin');
    if (!auth) return;
    actorUid = auth.user.uid;
  }

  try {
    const [quizzes, coursesSnap, existingMapsSnap] = await Promise.all([
      fetchAssessmentQuizzes(),
      db.collection('courses').get(),
      db.collection('assessment_course_maps').get(),
    ]);
    const courses = coursesSnap.docs
      .map((doc) => serializeCourse(doc))
      .filter((course) => course.active !== false && course.title);
    const existing = new Set(existingMapsSnap.docs.map((doc) => String(doc.id)));
    const created = [];
    const skipped = [];

    for (const quiz of quizzes) {
      const quizId = String(quiz.id);
      const quizTitle = quiz.title || '';
      if (!quizTitle || /^test\b/i.test(quizTitle)) {
        skipped.push({ quizId, quizTitle, reason: 'skipped' });
        continue;
      }
      if (existing.has(quizId) && req.body?.force !== true) {
        skipped.push({ quizId, quizTitle, reason: 'already-mapped' });
        continue;
      }

      let best = null;
      let bestScore = 0;
      courses.forEach((course) => {
        const score = scoreQuizCourseMatch(quizTitle, course.title);
        if (score > bestScore) {
          bestScore = score;
          best = course;
        }
      });

      if (!best || bestScore < 70) {
        skipped.push({ quizId, quizTitle, reason: 'no-match', bestScore });
        continue;
      }

      await db.collection('assessment_course_maps').doc(quizId).set({
        quizId,
        quizTitle,
        courseId: best.id,
        courseTitle: best.title || '',
        trainerLed: quiz.trainerLed === true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
      }, { merge: true });

      const merge = await mergeAliasCompletionsIntoCourse({
        quizTitle,
        courseId: best.id,
        courseTitle: best.title || '',
        actor: { uid: actorUid },
      });

      created.push({
        quizId,
        quizTitle,
        courseId: best.id,
        courseTitle: best.title,
        score: bestScore,
        merge,
      });
    }

    res.json({ ok: true, created, skipped });
  } catch (error) {
    console.error('auto-map assessment courses failed', error);
    res.status(500).json({ error: error.message || 'Failed to auto-map assessment courses.' });
  }
});

/**
 * Generate / reissue PDF certificates for completed training records and upload to SharePoint:
 * /{Employee folder}/Certificates/{Course Name}/{Course Name}.pdf
 *
 * Auth: admin session, or x-provision-secret (for ops scripts).
 * Body: { limit?, force?, offset? }
 */
app.post('/api/admin/backfill-certificates', async (req, res) => {
  const provisionOk = Boolean(getProvisionSecret())
    && req.headers['x-provision-secret'] === getProvisionSecret();
  if (!provisionOk) {
    const auth = await requireUser(req, res, 'admin');
    if (!auth) return;
  }

  const limit = Math.min(Math.max(Number(req.body?.limit) || 25, 1), 40);
  const force = req.body?.force === true;
  const offset = Math.max(Number(req.body?.offset) || 0, 0);

  try {
    const sharePointConfig = getSharePointConfig();
    if (!isSharePointConfigured(sharePointConfig)) {
      res.status(400).json({ error: 'SharePoint is not configured.' });
      return;
    }

    const snap = await db.collection('completions').limit(2000).get();
    const candidates = snap.docs
      .filter((doc) => {
        const data = doc.data();
        if (!data.completedAt) return false;
        if (!data.courseTitle && !data.courseId) return false;
        if (force) return true;
        return !data.sharePointWebUrl;
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const batch = candidates.slice(offset, offset + limit);
    const results = [];

    for (const doc of batch) {
      const data = doc.data();
      const profile = await loadEmployeeProfile(data.employeeUid);
      try {
        const meta = await maybeIssueCertificate({
          completionId: doc.id,
          employeeUid: data.employeeUid,
          employeeName: data.employeeName || profile?.employeeName || '',
          employeeEmail: data.employeeEmail || profile?.employeeEmail || '',
          courseId: data.courseId || '',
          courseTitle: data.courseTitle || 'Training',
          completedAt: data.completedAt?.toDate?.() || new Date(),
          expiresAt: data.expiresAt?.toDate?.() || null,
          source: data.source || 'manual',
          trainingFolderName: profile?.trainingFolderName || '',
          isActive: true,
        });
        await doc.ref.update({
          ...meta,
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({
          id: doc.id,
          ok: !meta.certificatePendingSharePoint,
          employeeName: data.employeeName || '',
          courseTitle: data.courseTitle || '',
          sharePointWebUrl: meta.sharePointWebUrl || '',
          error: meta.certificateError || '',
        });
      } catch (error) {
        results.push({
          id: doc.id,
          ok: false,
          employeeName: data.employeeName || '',
          courseTitle: data.courseTitle || '',
          error: error.message || 'Certificate failed',
        });
      }
    }

    const nextOffset = offset + batch.length;
    res.json({
      ok: true,
      processed: results.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      offset,
      nextOffset,
      totalCandidates: candidates.length,
      remaining: Math.max(candidates.length - nextOffset, 0),
      results,
    });
  } catch (error) {
    console.error('backfill certificates failed', error);
    res.status(500).json({ error: error.message || 'Failed to backfill certificates.' });
  }
});

/**
 * Import the Training Matrix CSV into courses + completions.
 * Uses bundled CSV by default, or accepts raw CSV body / { csvText }.
 * Does not generate certificates (keeps import fast).
 */
app.post('/api/admin/import-matrix', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  try {
    let csvText = '';
    if (typeof req.body === 'string' && req.body.trim()) {
      csvText = req.body;
    } else if (req.body?.csvText) {
      csvText = String(req.body.csvText);
    } else {
      const bundledPath = path.join(__dirname, 'data', 'training-matrix.csv');
      csvText = fs.readFileSync(bundledPath, 'utf8');
    }

    const parsed = parseTrainingMatrixCsv(csvText);
    if (!parsed.records.length) {
      res.status(400).json({ error: 'No rows found in CSV.' });
      return;
    }

    const portalUsers = (await fetchPortalUsersForSync()).filter(userHasTrainingAccess);
    const { matched, unmatched, ambiguous } = matchEmployeesToUsers(parsed.employees, portalUsers);
    const matchedByKey = new Map(matched.map((row) => [normalizeName(row.employeeName), row]));

    // Upsert courses
    const existingCoursesSnap = await db.collection('courses').get();
    const coursesByTitle = new Map();
    existingCoursesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      coursesByTitle.set(normalizeName(data.title), { id: doc.id, ...data });
    });

    let coursesCreated = 0;
    let coursesUpdated = 0;
    const courseIdByKey = new Map();

    for (const course of parsed.courses) {
      const key = normalizeName(course.title);
      const existing = coursesByTitle.get(key);
      if (existing) {
        courseIdByKey.set(key, existing.id);
        const patch = {
          updatedAt: FieldValue.serverTimestamp(),
          category: course.category,
        };
        if (course.validityMonths != null) patch.validityMonths = course.validityMonths;
        if (!existing.code && course.code) patch.code = course.code;
        if (existing.level == null) patch.level = 1;
        await db.collection('courses').doc(existing.id).set(patch, { merge: true });
        coursesUpdated += 1;
      } else {
        const ref = await db.collection('courses').add({
          code: course.code,
          title: course.title,
          category: course.category,
          description: 'Imported from Training Matrix',
          validityMonths: course.validityMonths,
          level: 1,
          tierFamily: '',
          active: true,
          sourceDefault: 'matrix',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdByUid: auth.user.uid,
        });
        courseIdByKey.set(key, ref.id);
        coursesCreated += 1;
      }
    }

    // Upsert matched employee profiles + folder names
    for (const row of matched) {
      const folderName = buildEmployeeFolderName(row.user.fullName || row.employeeName);
      await upsertEmployeeProfile(row.user.uid, {
        employeeName: row.user.fullName || row.employeeName,
        employeeEmail: row.user.email || '',
        department: row.department || '',
        matrixName: row.employeeName,
        trainingFolderName: folderName,
        accessEnabled: true,
        accessRevokedAt: FieldValue.delete(),
      });
    }

    let completionsCreated = 0;
    let completionsUpdated = 0;
    let completionsSkipped = 0;

    const exclusionsSnap = await db.collection('course_exclusions').get();
    const excludedKeys = new Set(
      exclusionsSnap.docs.map((doc) => {
        const data = doc.data() || {};
        return `${data.employeeUid}::${normalizeName(data.courseTitle || '')}`;
      }),
    );

    for (const record of parsed.records) {
      const match = matchedByKey.get(record.employeeKey);
      if (!match?.user?.uid) {
        completionsSkipped += 1;
        continue;
      }

      const courseId = courseIdByKey.get(record.courseKey) || '';
      let status = 'completed';
      if (String(record.status).toLowerCase() === 'expired') status = 'expired';
      if (String(record.status).toLowerCase() === 'required') status = 'assigned';

      const excluded = excludedKeys.has(`${match.user.uid}::${record.courseKey}`);

      // Required rows with no completion date stay as assigned.
      if (status === 'assigned' && !record.completedAt) {
        if (excluded) {
          completionsSkipped += 1;
          continue;
        }
        const existing = await findExistingIngest('matrix', record.sourceExternalId);
        const payload = {
          employeeUid: match.user.uid,
          employeeName: match.user.fullName || record.employeeName,
          employeeEmail: match.user.email || '',
          courseId,
          courseTitle: record.courseName,
          courseCode: '',
          status: 'assigned',
          completedAt: null,
          expiresAt: record.expiresAt ? Timestamp.fromDate(record.expiresAt) : null,
          source: 'matrix',
          sourceExternalId: record.sourceExternalId,
          notes: [
            record.assessmentType ? `Assessment: ${record.assessmentType}` : '',
            record.department ? `Department: ${record.department}` : '',
          ].filter(Boolean).join(' · '),
          loggedByUid: auth.user.uid,
          loggedByName: auth.user.fullName || auth.user.email || 'Matrix import',
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (existing) {
          await existing.ref.update(payload);
          completionsUpdated += 1;
        } else {
          await db.collection('completions').add({
            ...payload,
            createdAt: FieldValue.serverTimestamp(),
            certificateFileName: '',
            sharePointWebUrl: '',
            sharePointItemId: '',
            sharePointFolderPath: '',
          });
          completionsCreated += 1;
        }
        continue;
      }

      if (!record.completedAt) {
        completionsSkipped += 1;
        continue;
      }

      const result = await upsertCompletionRecord(
        {
          employeeUid: match.user.uid,
          employeeName: match.user.fullName || record.employeeName,
          employeeEmail: match.user.email || '',
          courseId,
          courseTitle: record.courseName,
          completedAt: record.completedAt.toISOString(),
          expiresAt: record.expiresAt ? record.expiresAt.toISOString() : undefined,
          validityMonths: record.validityMonths,
          source: 'matrix',
          sourceExternalId: record.sourceExternalId,
          notes: [
            record.assessmentType ? `Assessment: ${record.assessmentType}` : '',
            record.department ? `Department: ${record.department}` : '',
            record.status ? `Matrix status: ${record.status}` : '',
          ].filter(Boolean).join(' · '),
          createCertificate: false,
          trainingFolderName: buildEmployeeFolderName(match.user.fullName || record.employeeName),
        },
        auth.user,
      );

      // Preserve matrix status when explicitly expired.
      if (status === 'expired' && result.completion?.id) {
        await db.collection('completions').doc(result.completion.id).set({
          status: 'expired',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      if (result.isNew) completionsCreated += 1;
      else completionsUpdated += 1;
    }

    res.json({
      ok: true,
      summary: {
        rows: parsed.records.length,
        coursesCreated,
        coursesUpdated,
        completionsCreated,
        completionsUpdated,
        completionsSkipped,
        employeesMatched: matched.length,
        employeesUnmatched: unmatched.length,
        employeesAmbiguous: ambiguous.length,
      },
      unmatched: unmatched.map((row) => ({
        employeeName: row.employeeName,
        department: row.department,
        rowCount: row.rowCount,
      })),
      ambiguous: ambiguous.map((row) => ({
        employeeName: row.employeeName,
        candidates: (row.candidates || []).map((user) => ({
          uid: user.uid,
          fullName: user.fullName,
          email: user.email,
        })),
      })),
    });
  } catch (error) {
    console.error('import-matrix failed', error);
    res.status(error.status || 500).json({ error: error.message || 'Import failed.' });
  }
});

exports.api = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  app,
);

exports.refreshTrainingExpiries = onSchedule(
  {
    schedule: 'every 24 hours',
    region: 'europe-west2',
    timeZone: 'Europe/London',
  },
  async () => {
    const updated = await refreshExpiryStatuses();
    console.log(`Marked ${updated} training completions as expired.`);
  },
);
