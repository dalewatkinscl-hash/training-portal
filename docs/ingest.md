# Training ingest — Assessment & CPC

Training is the **master records** system. Assessment and CPC should POST completions here instead of keeping their own long-term record stores.

## Endpoint

`POST /api/ingest/completion`

- Auth: header `x-ingest-secret` must match Functions env `TRAINING_INGEST_SECRET`
- Sources: `assessment` | `cpc`
- Idempotent key: `source` + `sourceExternalId`

## Assessment portal (`assessments-89dd7`)

On successful assessment pass / certificate generation, call Training:

```js
await fetch('https://training.countrylion.co.uk/api/ingest/completion', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-ingest-secret': process.env.TRAINING_INGEST_SECRET,
  },
  body: JSON.stringify({
    source: 'assessment',
    sourceExternalId: attemptId, // unique per attempt
    employeeUid,
    employeeName,
    employeeEmail,
    courseTitle,
    courseCode,
    completedAt: new Date().toISOString(),
    validityMonths: 12,
    score,
    createCertificate: true,
    sharePointFolderName,      // from Employee Portal user if available
    sharePointEmployeeRoot,    // "Current Employees" / "Previous Employees"
  }),
});
```

Store `TRAINING_INGEST_SECRET` in Assessment Functions env (same value as Training).

## CPC portal (`countrylion-cpc`)

Same call with `source: "cpc"` and CPC’s own `sourceExternalId` (e.g. CPC session / module completion id).

## Mapping courses

Prefer creating matching courses in Training and passing `courseId` so validity rules stay central. If `courseId` is omitted, Training still stores `courseTitle` / `courseCode` and uses `validityMonths` from the payload.

## Pull assigned / due courses (Assessment)

Assessment should GET a staff member’s Training records so assigned and due courses appear in the Assessment portal.

`GET https://training.countrylion.co.uk/api/ingest/records?employeeUid=<uid>`

Optional: `employeeEmail` instead of `employeeUid`.

Headers:

```
x-ingest-secret: <TRAINING_INGEST_SECRET>
```

Response includes:

- `records` — full training history
- `due` — assigned, expired, expiring soon, and failed rows
- `dueQuizIds` — mapped Assessment quiz ids the person still needs

When they pass a mapped quiz, keep POSTing `/api/ingest/completion` with `createCertificate: true`. Training updates the assigned row, issues the PDF, and uploads it to the employee’s SharePoint Training folder.

Trainers can also **Add course** in Training:

- **Log as completed** — classroom / already taken; certificate to SharePoint immediately
- **Assign as required** — shows as Required in Training (and in Assessment via this pull API / Take assessment link). Certificate is issued when they pass.
