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
