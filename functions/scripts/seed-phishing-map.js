'use strict';

/**
 * One-shot seed: map Phishing Assessment → Phishing Awareness and merge duplicates.
 * Usage (from functions/): 
 *   $env:ASSESSMENT_SECRET="..."; node scripts/seed-phishing-map.js
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const secret = process.env.ASSESSMENT_SECRET || '';
  if (!secret) throw new Error('ASSESSMENT_SECRET env var required');

  initializeApp({ credential: applicationDefault(), projectId: 'training-cl' });
  const db = getFirestore();

  const response = await fetch('https://assessments.countrylion.co.uk/api/quizzes', {
    headers: { 'x-provision-secret': secret },
  });
  if (!response.ok) throw new Error(`quizzes fetch failed ${response.status}`);
  const data = await response.json();
  const quizzes = data.quizzes || [];

  const phishingQuiz = quizzes.find((q) => /phish/i.test(q.title || ''));
  const coursesSnap = await db.collection('courses').get();
  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const phishingCourse = courses.find((c) => /phish/i.test(c.title || '') && /awareness/i.test(c.title || ''))
    || courses.find((c) => /phish/i.test(c.title || ''));

  console.log('quiz:', phishingQuiz?.id, phishingQuiz?.title);
  console.log('course:', phishingCourse?.id, phishingCourse?.title);
  if (!phishingQuiz || !phishingCourse) {
    console.log('SKIP: missing quiz or course');
    return;
  }

  await db.collection('assessment_course_maps').doc(String(phishingQuiz.id)).set({
    quizId: String(phishingQuiz.id),
    quizTitle: phishingQuiz.title || '',
    courseId: phishingCourse.id,
    courseTitle: phishingCourse.title || '',
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: 'seed-script',
  }, { merge: true });
  console.log('MAPPED OK');

  const aliasKey = normalizeName(phishingQuiz.title);
  const courseKey = normalizeName(phishingCourse.title);
  const snap = await db.collection('completions').get();
  const byUid = new Map();

  snap.docs.forEach((doc) => {
    const row = doc.data() || {};
    const uid = row.employeeUid || '';
    if (!uid) return;
    const titleKey = normalizeName(row.courseTitle || '');
    const isAlias = titleKey === aliasKey;
    const isTarget = row.courseId === phishingCourse.id || titleKey === courseKey;
    if (!isAlias && !isTarget) return;
    if (!byUid.has(uid)) byUid.set(uid, { alias: [], target: [] });
    const group = byUid.get(uid);
    if (isAlias && row.courseId !== phishingCourse.id) group.alias.push(doc);
    if (isTarget) group.target.push(doc);
  });

  let merged = 0;
  let deleted = 0;
  for (const [uid, group] of byUid.entries()) {
    if (!group.alias.length) continue;
    merged += 1;
    const ranked = [...group.alias, ...group.target].sort((a, b) => {
      const aTime = a.data().completedAt?.toDate?.()?.getTime?.() || 0;
      const bTime = b.data().completedAt?.toDate?.()?.getTime?.() || 0;
      return bTime - aTime;
    });
    const winner = group.target[0] || ranked[0];
    const newest = ranked[0].data();
    await winner.ref.set({
      employeeUid: uid,
      employeeName: newest.employeeName || '',
      employeeEmail: newest.employeeEmail || '',
      courseId: phishingCourse.id,
      courseTitle: phishingCourse.title || '',
      courseCode: newest.courseCode || '',
      completedAt: newest.completedAt || null,
      expiresAt: newest.expiresAt || null,
      source: newest.source || 'assessment',
      sourceExternalId: newest.sourceExternalId || '',
      score: newest.score ?? null,
      notes: newest.notes || '',
      status: newest.status || 'completed',
      updatedAt: FieldValue.serverTimestamp(),
      mergedFromQuizTitle: phishingQuiz.title,
    }, { merge: true });
    for (const doc of [...group.alias, ...group.target]) {
      if (doc.id === winner.id) continue;
      await doc.ref.delete();
      deleted += 1;
    }
  }

  console.log(`merge employees=${merged} deleted=${deleted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
