# Training Records Portal

Master training records system for Country Lion. Hosted on Firebase, gated by Employee Portal SSO.

- **Production URL:** https://training.countrylion.co.uk
- **Portal key:** `training_app`
- **Firebase project:** `training-cl`
- **Roles:** `employee` · `trainer` · `admin`

## What it does

- Course catalogue with validity / expiry periods
- Add course to people: **log completed** (certificate to SharePoint now) or **assign required** (shows in Training and Assessment until they pass)
- Ingest API for **Assessment** and **CPC** portals
- Certificate PDF generation
- Upload certificates into each employee’s SharePoint **Training** folder (same HR site / Graph app as disciplinary docs)
- Employee self-service “My records” profile view
- Expiry dashboard for trainers

## Architecture

```
Assessment / CPC  --ingest-->  Training (Firestore)
Employee Portal SSO  -------->  training.countrylion.co.uk
CSV Training Matrix --------->  courses + completions (admin import)
Training certificates ------->  SharePoint /sites/Training / Employee Training Documents / {First Last}/
New training_app access ----->  auto-creates that SharePoint folder
```

## First-time Firebase setup

1. Create Firebase project **`training-cl`** (Blaze plan for Functions).
2. Enable **Hosting**, **Functions**, and **Firestore** (europe-west2 preferred).
3. Attach custom domain **`training.countrylion.co.uk`**.
4. Install CLI if needed: `npm i -g firebase-tools && firebase login`
5. From this repo:

```powershell
cd functions; npm install
cd ../frontend; npm install
cd ..
firebase use training-cl
npm run deploy
```

## Secrets (Functions)

Set in Firebase Console → Functions → environment / secrets (or `firebase functions:secrets:set`):

| Secret | Purpose |
|--------|---------|
| `MS_GRAPH_TENANT_ID` | Same Azure tenant as Employee Portal SharePoint |
| `MS_GRAPH_CLIENT_ID` | Same Graph app registration |
| `MS_GRAPH_CLIENT_SECRET` | Same Graph client secret |
| `TRAINING_INGEST_SECRET` | Shared secret for Assessment / CPC ingest calls |

## Employee Portal access

In User Management:

1. Add portal key **`training_app`** (already added to `KNOWN_PORTALS` in this change set).
2. Grant roles: `employee` / `trainer` / `admin`.
3. Allow origin `https://training.countrylion.co.uk` for login redirects.

## Ingest API (Assessment / CPC)

`POST https://training.countrylion.co.uk/api/ingest/completion`

Headers:

```
Content-Type: application/json
x-ingest-secret: <TRAINING_INGEST_SECRET>
```

Body example:

```json
{
  "source": "assessment",
  "sourceExternalId": "assessment-attempt-123",
  "employeeUid": "abc123",
  "employeeName": "Jane Driver",
  "employeeEmail": "jane@countrylion.co.uk",
  "courseId": optionalFirestoreCourseId,
  "courseTitle": "Driver Assessment – Module A",
  "courseCode": "ASM-A",
  "completedAt": "2026-07-23",
  "validityMonths": 12,
  "score": 92,
  "createCertificate": true,
  "sharePointFolderName": "Jane Driver",
  "sharePointEmployeeRoot": "Current Employees"
}
```

Idempotent on `(source, sourceExternalId)`.

See `docs/ingest.md` for CPC / Assessment wiring notes.

## Local development

```powershell
cd frontend
npm install
npm run dev
```

SSO cookies only work on `*.countrylion.co.uk`. For UI-only work without session, temporarily mock `/api/session` or use the deployed custom domain.

## SharePoint path

Certificates upload to:

`Employee Files / Current Employees / {Employee folder} / Training /`

Folder name resolution matches Employee Portal mapping fields (`sharePointFolderName`, `sharePointEmployeeRoot`) when provided on ingest/completion.
