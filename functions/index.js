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
const fs = require('fs');
const path = require('path');

initializeApp();
const db = getFirestore();

const PORTAL_KEY = 'training_app';
const MASTER_USER_MGMT_URL = 'https://employee.countrylion.co.uk';
const ROLE_LEVEL = { employee: 1, manager: 2, trainer: 2, admin: 3 };
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
  return user?.portalsAccess?.[PORTAL_KEY] || '';
}

function roleAtLeast(role, minRole) {
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minRole] || 99);
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
    await ref.set(payload);
  } else {
    await ref.set(payload, { merge: true });
  }
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
    active: data.active !== false,
    sourceDefault: data.sourceDefault || 'manual',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

const EXPIRING_SOON_MS = 60 * 24 * 60 * 60 * 1000;

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

async function loadAssessmentCourseMap(quizId) {
  if (!quizId) return null;
  const snap = await db.collection('assessment_course_maps').doc(String(quizId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadAssessmentLinksByCourseId() {
  const mapsSnap = await db.collection('assessment_course_maps').get();
  const byCourseId = new Map();
  const byCourseTitle = new Map();
  mapsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const courseId = String(data.courseId || '').trim();
    const quizId = String(data.quizId || doc.id || '').trim();
    if (!quizId) return;
    const link = {
      assessmentQuizId: quizId,
      assessmentQuizTitle: data.quizTitle || '',
      assessmentCourseTitle: data.courseTitle || '',
      assessmentUrl: `${getAssessmentPortalUrl().replace(/\/$/, '')}/?quiz=${encodeURIComponent(quizId)}`,
    };
    if (courseId) byCourseId.set(courseId, link);
    const titleKey = normalizeName(data.courseTitle || '');
    if (titleKey) byCourseTitle.set(titleKey, link);
    const quizTitleKey = normalizeName(data.quizTitle || '');
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

function withAssessmentLinks(completions, links) {
  return (completions || []).map((item) => {
    const actionable = item.status === 'expired' || item.status === 'expiring_soon';
    if (!actionable) return item;
    const link = resolveAssessmentLinkForCompletion(item, links);
    if (!link) return item;
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

  const completedDate = completedAt ? new Date(completedAt) : new Date();
  if (Number.isNaN(completedDate.getTime())) {
    throw Object.assign(new Error('Invalid completedAt.'), { status: 400 });
  }

  let expiryDate = expiresAt ? new Date(expiresAt) : computeExpiry(completedDate, resolvedValidity);
  if (expiresAt && Number.isNaN(expiryDate.getTime())) {
    throw Object.assign(new Error('Invalid expiresAt.'), { status: 400 });
  }

  const status = computeStatus(expiryDate, completedDate);
  let existing = await findExistingIngest(source, sourceExternalId);

  // Assessment / mapped courses: update the employee's existing course row (any source).
  if (!existing && resolvedCourseId && (source === 'assessment' || source === 'cpc')) {
    existing = await findExistingCompletionForCourse(employeeUid, resolvedCourseId);
  }

  const profile = await loadEmployeeProfile(employeeUid);
  const resolvedFolderName = trainingFolderName
    || sharePointFolderName
    || profile?.trainingFolderName
    || '';

  const base = {
    employeeUid,
    employeeName: employeeName || profile?.employeeName || '',
    employeeEmail: employeeEmail || profile?.employeeEmail || '',
    courseId: resolvedCourseId,
    courseCode: resolvedCode,
    courseTitle: resolvedTitle,
    status,
    completedAt: Timestamp.fromDate(completedDate),
    expiresAt: expiryDate ? Timestamp.fromDate(expiryDate) : null,
    source,
    sourceExternalId: sourceExternalId || '',
    score,
    notes: notes || '',
    quizId: quizId || extractQuizId(payload) || '',
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
  if (createCertificate) {
    certificateMeta = await maybeIssueCertificate({
      completionId: ref.id,
      employeeUid,
      employeeName: employeeName || profile?.employeeName || '',
      employeeEmail: employeeEmail || profile?.employeeEmail || '',
      courseTitle: resolvedTitle,
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
  return { completion: serializeCompletion(snap), isNew };
}

async function maybeIssueCertificate(options) {
  const {
    completionId,
    employeeName,
    courseTitle,
    completedAt,
    expiresAt,
    source,
    sharePointFolderName,
    trainingFolderName,
    isActive,
  } = options;

  const pdfBuffer = await buildTrainingCertificatePdf({
    employeeName,
    courseTitle,
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
  for (const key of ['code', 'title', 'category', 'description', 'sourceDefault']) {
    if (req.body?.[key] !== undefined) patch[key] = String(req.body[key]).trim();
  }
  if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
  if (req.body?.validityMonths !== undefined) {
    patch.validityMonths = req.body.validityMonths === '' || req.body.validityMonths == null
      ? null
      : Number(req.body.validityMonths);
    if (patch.validityMonths != null && Number.isNaN(patch.validityMonths)) {
      res.status(400).json({ error: 'validityMonths must be a number.' });
      return;
    }
  }

  await ref.update(patch);
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
      .orderBy('completedAt', 'desc')
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

  let completions = snap.docs.map(serializeCompletion);

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

  res.json({ completions });
});

app.get('/api/me/records', async (req, res) => {
  const auth = await requireUser(req, res, 'employee');
  if (!auth) return;

  const snap = await db
    .collection('completions')
    .where('employeeUid', '==', auth.user.uid)
    .orderBy('completedAt', 'desc')
    .limit(200)
    .get();

  const links = await loadAssessmentLinksByCourseId();
  const completions = withAssessmentLinks(
    snap.docs.map(serializeCompletion),
    links,
  );
  const summary = {
    total: completions.length,
    valid: completions.filter((item) => item.status === 'completed').length,
    expired: completions.filter((item) => item.status === 'expired').length,
    expiringSoon: completions.filter((item) => item.status === 'expiring_soon').length,
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
 * Trainer+: required training log — expired + due within 60 days,
 * sorted most overdue first (expiresAt ascending).
 */
app.get('/api/required-training', async (req, res) => {
  const auth = await requireUser(req, res, 'trainer');
  if (!auth) return;

  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const department = String(req.query.department || '').trim().toLowerCase();
    const now = Date.now();
    const until = now + EXPIRING_SOON_MS;

    const [completionsSnap, profilesSnap] = await Promise.all([
      db.collection('completions').get(),
      db.collection('employee_profiles').get(),
    ]);

    const profilesByUid = new Map(
      profilesSnap.docs.map((doc) => [doc.id, serializeEmployeeProfile(doc)]),
    );

    let rows = completionsSnap.docs.map((doc) => {
      const item = serializeCompletion(doc);
      const profile = profilesByUid.get(item.employeeUid) || {};
      return {
        ...item,
        department: profile.department || '',
      };
    }).filter((item) => {
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
      const aExp = new Date(a.expiresAt).getTime();
      const bExp = new Date(b.expiresAt).getTime();
      if (aExp !== bExp) return aExp - bExp;
      return String(a.employeeName || '').localeCompare(String(b.employeeName || ''));
    });

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
  const completionsSnap = await db.collection('completions').get();
  const coursesSnap = await db.collection('courses').get();
  const completions = completionsSnap.docs.map(serializeCompletion);
  completions.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));

  res.json({
    coursesActive: coursesSnap.docs.filter((doc) => doc.data().active !== false).length,
    completionsTotal: completions.length,
    expired: completions.filter((item) => item.status === 'expired').length,
    expiringSoon: completions.filter((item) => item.status === 'expiring_soon').length,
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

    const [profilesSnap, completionsSnap] = await Promise.all([
      db.collection('employee_profiles').get(),
      db.collection('completions').get(),
    ]);

    const completions = completionsSnap.docs.map(serializeCompletion);
    const byUid = new Map();

    profilesSnap.docs.forEach((doc) => {
      const profile = serializeEmployeeProfile(doc);
      byUid.set(profile.employeeUid, {
        ...profile,
        completions: [],
      });
    });

    completions.forEach((item) => {
      if (!item.employeeUid) return;
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
    const [profile, completionsSnap] = await Promise.all([
      loadEmployeeProfile(uid),
      db.collection('completions').where('employeeUid', '==', uid).get(),
    ]);

    const completions = completionsSnap.docs
      .map(serializeCompletion)
      .sort((a, b) => String(b.completedAt || b.expiresAt || '').localeCompare(String(a.completedAt || a.expiresAt || '')));

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

    const [profilesSnap, completionsSnap, coursesSnap] = await Promise.all([
      db.collection('employee_profiles').get(),
      db.collection('completions').get(),
      db.collection('courses').get(),
    ]);

    const profilesByUid = new Map(
      profilesSnap.docs.map((doc) => [doc.id, serializeEmployeeProfile(doc)]),
    );
    const coursesById = new Map(
      coursesSnap.docs.map((doc) => [doc.id, serializeCourse(doc)]),
    );

    let rows = completionsSnap.docs.map((doc) => {
      const item = serializeCompletion(doc);
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
        completedAt: item.completedAt,
        dueDate: item.expiresAt,
        status: item.status,
        source: item.source,
        notes: item.notes || '',
        sharePointWebUrl: item.sharePointWebUrl || '',
        trainingFolderName: profile.trainingFolderName || '',
      };
    });

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
  const role = String(req.body?.role || 'employee').trim();

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

    const sharePointConfig = getSharePointConfig();
    if (isSharePointConfigured(sharePointConfig)) {
      folderMeta = await ensureEmployeeFolder(sharePointConfig, {
        fullName,
        trainingFolderName: folderName,
      });
    }

    const profile = await upsertEmployeeProfile(uid, {
      employeeName: fullName,
      employeeEmail: email,
      role,
      trainingFolderName: folderMeta.folderName || folderName,
      trainingFolderWebUrl: folderMeta.webUrl || '',
      trainingFolderConfirmedAt: existing?.trainingFolderConfirmedAt || FieldValue.serverTimestamp(),
    });

    res.json({
      ok: true,
      profile: serializeEmployeeProfile(profile),
      folder: folderMeta,
    });
  } catch (error) {
    console.error('provisionUser failed', error);
    res.status(500).json({ error: error.message || 'Failed to provision training user.' });
  }
});

app.get('/api/admin/mappings', async (req, res) => {
  const auth = await requireUser(req, res, 'admin');
  if (!auth) return;

  try {
    const [profilesSnap, folders] = await Promise.all([
      db.collection('employee_profiles').get(),
      isSharePointConfigured(getSharePointConfig())
        ? listEmployeeFolders(getSharePointConfig())
        : Promise.resolve([]),
    ]);

    const profiles = profilesSnap.docs.map(serializeEmployeeProfile);
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

    const portalUsers = await fetchPortalUsersForSync();
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
        await db.collection('courses').doc(existing.id).set(patch, { merge: true });
        coursesUpdated += 1;
      } else {
        const ref = await db.collection('courses').add({
          code: course.code,
          title: course.title,
          category: course.category,
          description: 'Imported from Training Matrix',
          validityMonths: course.validityMonths,
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
      });
    }

    let completionsCreated = 0;
    let completionsUpdated = 0;
    let completionsSkipped = 0;

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

      // Required rows with no completion date stay as assigned.
      if (status === 'assigned' && !record.completedAt) {
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
