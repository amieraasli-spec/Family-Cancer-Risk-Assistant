# API contracts

Three surfaces, mounted separately and with separate middleware:

| Prefix | Audience | Authentication |
|---|---|---|
| `/api/public` | applicants | none; a tracking reference is the credential |
| `/api/auth` | staff | username and password, plus a second factor for privileged roles |
| `/api/staff` | staff, finance, management, administration | session cookie |

Every `/api/staff` route declares the permission it requires and calls the
authorisation gate before touching data. The scope that comes back is threaded
into the SQL, so `docs/03-permission-matrix.md` is enforced in the query and not
in the view.

---

## Public

### `POST /api/public/status`

The reference travels in the **body**, never in a URL, so it stays out of access
logs, browser history, `Referer` headers and analytics.

```jsonc
// request
{ "reference": "P69S-1JFP-DX1H-PQ5T-RAM9", "language": "ms",
  "verificationToken": "vfy_…" }              // optional, from /verify
```

Response is the closed allowlist in `PublicStatusView`
(`server/services/public-status.ts`). Every key is listed in
`tests/01-public-surface.test.ts`, which fails if a new one appears:

```jsonc
{
  "publicReference": "P69S-1JFP-DX1H-PQ5T-RAM9",
  "stage": "SEDANG_DIPROSES",
  "stageLabel": "Sedang diproses",
  "stageExplanation": "Permohonan anda lengkap dan laporan sedang disediakan.",
  "receivedDate": "2026-09-01",
  "targetCompletionDate": "2026-10-13",
  "targetNotSetNotice": null,
  "revisedEstimateDate": null,
  "estimateDisclaimer": null,
  "lastUpdateDate": "2026-09-20",
  "nextActionCode": null,
  "nextActionText": "Tiada tindakan diperlukan buat masa ini.",
  "outstandingItems": null,          // non-null only after verification
  "collectionInstructions": "…",
  "delayNotice": null,               // added when overdue; the stage stays true
  "feeOutstanding": false,
  "contact": { "unitName": "…", "telephone": null, "email": null,
               "counterHours": null, "unverifiedNotice": "…" },
  "dataClassNotice": "Demonstration data — not actual IKN performance.",
  "verified": false
}
```

| Status | Meaning |
|---|---|
| 200 | the reference resolved |
| 400 | no reference supplied |
| 404 | **one uniform response** for unknown, revoked, and not-a-tracking-reference |
| 429 | rate limited (10 per 5 minutes per client) |

### `POST /api/public/verify/challenge`

Step-up for an applicant who has only the predictable internal report number.
Returns **no status**. The response is identical whether or not the report number
exists, so it cannot be used to enumerate; only the opaque `challengeId` differs,
and it reveals nothing.

```jsonc
// request
{ "reportNumber": "IKN/LP/2026/000123", "language": "ms" }
// response — same message and staffAssistedRoute in every case
{ "challengeId": "otc_…" | null, "destinationMasked": "••••••123" | null,
  "message": "…", "staffAssistedRoute": "…" }
```

Limits: 3 per 15 minutes per client, **and** 5 per hour per application, which is
what blunts SMS flooding aimed at one patient.

### `POST /api/public/verify`

```jsonc
{ "challengeId": "otc_…", "code": "123456" }
→ { "verificationToken": "vfy_…", "applicationScoped": true, "expiresInSeconds": 900 }
```

The token is scoped to one application: presenting it with a different reference
grants nothing. 404 on a wrong, expired, consumed or over-attempted code.

---

## Authentication

| Route | Body | Notes |
|---|---|---|
| `POST /api/auth/login` | `{username, password}` | one message for an unknown account and a wrong password; sets an HttpOnly, SameSite=Strict cookie |
| `POST /api/auth/mfa` | `{code}` | privileged roles hold **no** permission until this succeeds |
| `POST /api/auth/logout` | — | revokes the session |
| `GET /api/auth/me` | — | principal, permission list and data class; the list is a convenience for the interface, never the control |

---

## Staff

### Filtering

Every analytical route takes the shared filter as query parameters, and echoes it
back on each panel so a screenshot is self-describing.

```
?month=2026-09&trailingMonths=12&departments=DEPT-RTO&reportTypes=Ordinary%20report
&asOf=2026-09-27T15:59:59.000Z&page=1&pageSize=5
```

A department-scoped caller who asks for a department they do not hold receives
**403**, not a silently narrowed answer.

### Routes

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/staff/reference` | `application.read` | departments, report types, metric dictionary, active rules, assumptions |
| GET | `/staff/applications` | `application.read` | worklist, queue composition, exceptions |
| GET | `/staff/applications/:id` | `application.read` | case detail; the `fee` block is `null` for a doctor, with a notice saying why |
| POST | `/staff/applications` | `application.register` | returns the tracking reference **once**; it is stored only as a hash |
| POST | `/staff/applications/:id/events` | varies by event | the single workflow entry point |
| POST | `/staff/applications/:id/tracking-reference` | `application.register` | revokes and reissues after a suspected leak |
| GET | `/staff/applications/:id/fee` · POST same | `fee.read` / `fee.*` | fee actions |
| GET | `/staff/my-tasks` · `/staff/my-claims` | `task.read` / `claim.read`, scope `OWN` | doctor views |
| GET | `/staff/claims` | `claim.read` | finance panels; a doctor is redirected to `/my-claims` |
| POST | `/staff/claims/eligibility` | `claim.eligibility.assess` | records the decision with a rule version |
| POST | `/staff/claims/submit` | `claim.submit` | doctor, own items only |
| POST | `/staff/claims/:id/actions` | varies | receive, verify, return, reject, approve, instruct, withdraw |
| POST | `/staff/claims/:id/reconcile` | `payment.reconcile` | requires reference, amount **and** paid date |
| POST | `/staff/claims/:id/payment-failure` · `/reversal` | `payment.reconcile` | |
| GET | `/staff/metrics/overview` · `/departments` · `/insights` | `metrics.read.hospital` | |
| GET | `/staff/metrics/forecast` | `forecast.read` | withheld with a reason when history is short |
| GET | `/staff/metrics/actions` · POST `/decisions` | `recommendations.read` / `.accept` | |
| GET | `/staff/exports/monthly?format=json\|csv\|pdf` | `export.monthly` | built from the same panel functions the screen calls |
| GET/POST | `/staff/snapshots` | `export.monthly` / `snapshot.freeze` | |
| POST | `/staff/calendar/days` | `admin.calendar` | loads gazetted holidays from CSV |
| GET/POST | `/staff/config` | `admin.rules` | a change supersedes, never overwrites |
| POST | `/staff/imports/dry-run` | `import.run` | validates and reports; applies nothing |
| GET | `/staff/notifications` · `/audit` · `/users` | `admin.*` | |

### Workflow events

`POST /api/staff/applications/:id/events`

```jsonc
{ "event": "MARK_COMPLETE",
  "occurredAt": "2026-09-01T02:00:00.000Z",   // optional; defaults to now
  "payload": { "completeAt": "2026-09-01T02:00:00.000Z" } }
```

| Event | Required payload |
|---|---|
| `MARK_INCOMPLETE` | `reasonCode` |
| `MARK_COMPLETE` | `completeAt` (the **true** time, not the entry time) |
| `ASSIGN` / `REASSIGN` | `doctorId`, and `reasonCode` on a reassignment |
| `RETURN_FOR_CORRECTION` | `reasonCode` |
| `RECORD_COLLECTION` | `receiptReference`, optional `releaseMethod`, `collectedBy` |
| `CANCEL` | `reasonCode`, `publicMessage` |
| `GRANT_EXTENSION` | `revisedDueDate`, `reason` |

### Idempotency

Every mutating route accepts `Idempotency-Key`. The first completed response is
stored and replayed verbatim for a repeat of the same key with the same body; the
same key with a **different** body returns `409 IDEMPOTENCY_KEY_REUSED`, which is
a client bug worth surfacing rather than silently answering.

### Errors

```jsonc
{ "error": { "code": "INVALID_TRANSITION", "message": "…", "detail": { … } } }
```

`code` is the contract; `message` is for a human and may be reworded. An
unexpected failure returns `500 INTERNAL_ERROR` with no internal detail, having
been audited with its detail server-side.

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` / `FORBIDDEN` | 401 / 403 | audited, including the reason |
| `NOT_FOUND` | 404 | on a public route, the single uniform response |
| `INVALID_TRANSITION` | 409 | not permitted from the current state; lists what is |
| `DUPLICATE_CLAIM_ITEM` | 409 | an active item already covers this service |
| `SNAPSHOT_EXISTS` | 409 | a correction needs a revision reason |
| `IDEMPOTENCY_KEY_REUSED` | 409 | same key, different body |
| `MISSING_RECEIPT`, `MISSING_PAYMENT_REFERENCE`, `INVALID_PAID_AMOUNT` | 422 | evidence is incomplete |
| `APPROVED_EXCEEDS_CLAIMED`, `AMOUNT_BELOW_DUE` | 422 | the amounts do not reconcile |
| `COMPLETENESS_BEFORE_RECEIPT`, `FUTURE_COMPLETENESS` | 422 | the dates are impossible |
| `EXTENSION_NOT_LATER` | 422 | a revised deadline must be later |
| `RATE_LIMITED` | 429 | |

### Headers

Public and staff responses both carry `Cache-Control: no-store`,
`X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and a Content-Security-Policy with
`frame-ancestors 'none'`. HSTS is added when `NODE_ENV=production`.
