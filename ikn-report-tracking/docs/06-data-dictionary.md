# Data dictionary

The authoritative definition is `server/db/migrations/001_initial.sql`, which
carries a comment on every non-obvious column. This page is the reader's version:
what each entity is for, and the decisions encoded in it.

## Conventions

| Convention | Rule | Why |
|---|---|---|
| Timestamps | `TEXT`, ISO-8601 UTC with a trailing `Z` | Portable between SQLite and PostgreSQL. Business-date arithmetic converts to Asia/Kuala_Lumpur in the domain layer, never in SQL. |
| Business dates | `TEXT`, `YYYY-MM-DD`, Asia/Kuala_Lumpur | A deadline is a calendar date in one place, not an instant. |
| Money | `INTEGER` **sen** | No float ever touches an amount, so rounding cannot accumulate across a month of claim items. Columns are suffixed `_sen`. |
| Booleans | `INTEGER` 0/1 | SQLite has no boolean; this is the portable form. |
| Identifiers | application-generated `TEXT` | No `SERIAL`/`IDENTITY` dialect difference, and an id can be minted before the insert. |
| Occurred vs recorded | `occurred_at` and `recorded_at` are separate on every event | A late entry must not be able to rewrite when something happened. |

## Entities

### `applications`
One row per report request. `internal_report_number` is sequential and quotable
and is **deliberately not a credential**; `public_tracking_tokens` holds the
credential. `protected_patient_reference` is a pseudonymous handle — no name, no
NRIC, no contact detail is stored here; `verified_contact_reference` points at a
contact record held in the existing approved system.

`application_complete_at` is when completeness was genuinely achieved;
`completeness_recorded_at` is when staff keyed it in. The service deadline is
computed from the former, which is what stops a late registration silently
restarting the clock. `original_service_due_at` is written once and never
rewritten; `revised_due_at` is written only by an authorised extension and sits
alongside it.

### `public_tracking_tokens`
Only the HMAC of a tracking reference is stored, under a server-side pepper that
never enters the database, so a stolen dump cannot be ground back to an
application. A reference can be revoked and replaced without touching the
application row.

### `doctor_tasks`
One row per assignment. A reassignment closes the old row (`active = 0`,
`superseded_at`) and opens a new one, so the history survives; a partial unique
index keeps at most one active task per application. `original_doctor_due_at` is
fixed at assignment and `current_doctor_due_at` may move, but neither affects the
application's service deadline.

### `releases`
The five timestamps that must not be conflated: `report_completed_at`,
`ready_at`, `notified_at`, `collection_or_delivery_at`, plus who authorised the
release. Completion is not collection, and the KPI endpoint is a configured choice
among these.

### `patient_fees`
The applicant's charge for a copy of the report. A table constraint refuses
`fee_status = 'PAID'` without a receipt reference, a positive amount received and
a verification timestamp. **A patient fee is not doctor remuneration**; nothing in
the claim tables reads it and nothing here reads a claim.

### `claims` and `claim_items`
A claim may hold several items; each item keeps its own report, doctor, amount,
eligibility rule and status, and money is always aggregated over **items**, never
applications. Constraints in the table: an eligible item must carry an
`eligible_at` and a rule version; an approval must carry an amount; and
`approved_by <> submitted_by`. A partial unique index blocks a second live item
for the same `(application, task, eligibility rule)`, releasing the slot only for
`REJECTED`, `WITHDRAWN` and `REVERSED`.

### `payment_allocations`
Append-only in practice: a reversal is a **negative allocation** referencing the
payment it reverses, not an edit of the original row, so history stays intact and
the net position stays derivable. A constraint refuses `payment_status =
'RECONCILED'` without a reference, a paid date, a reconciliation timestamp and a
non-zero amount — which is what makes "Paid" unreachable from an approval alone.

### `status_events`
The append-only record of what happened. No `UPDATE` or `DELETE` in the codebase
targets it. `sequence_no` orders events per entity; `idempotency_key` links an
event to the request that caused it.

### `delay_events`
A delay is recorded against the **stage** that owned it and the party it is
attributed to, and `attributed_to` has no default. Delay is never assigned to the
doctor by virtue of a report being late.

### `deadline_extensions`
Reason, approver, requested and approved timestamps, and both the original and the
revised date. An extension is visible, attributable and reversible in the record.

### `notifications`
`dedupe_key` is uniquely indexed, so a retried reminder is a no-op however many
times a job runs. `simulated` and `provider` record how it was sent; failures
carry a reason and an attempt count and are surfaced on the dashboard.

### `audit_events`
Privileged access and every authorisation decision, granted or denied. A run of
denials against one account is the signal this table exists for.

### Versioned rules
`business_calendar_versions` + `business_calendar_days`, `sla_rules`, `fee_rules`,
`claim_eligibility_rules` and `config_settings`. An application keeps the rule
version it was registered under, so changing a rule never moves a past result. A
configuration change **supersedes** rather than overwrites.

### `monthly_snapshot_versions`
A frozen month, with the rule versions, formula version, data class and the full
export bundle. A correction creates the next revision and records what it
supersedes and why.

### Controls
`sessions`, `idempotency_keys`, `otp_challenges` and `rate_limit_buckets` hold
only hashes of the secrets they govern. `rate_limit_buckets` keys on a salted hash
of a client hint, never a raw IP address.

### `attachments`
Administrative attachments only — authority letters, consent forms, receipts,
claim forms, delivery receipts. Clinical report authoring stays in the existing
approved workflow. Every row carries a SHA-256, a size, a content type and a scan
status.

### `policy_documents` and `policy_passages`
The registry the recommendation panel retrieves from. Every row currently reads
`approval_state = 'NOT_SUPPLIED'`, which is why the panel presents no
recommendation as a policy requirement.

## Fields deliberately absent

| Not stored | Why |
|---|---|
| Patient name, NRIC, address, telephone, e-mail | Not needed to track a report. The portal verifies against a contact reference held in the existing approved system. |
| Diagnosis, clinical text, report content | Out of scope: clinical authoring stays in the approved workflow. Keeping it out of this database keeps it out of the public API and the analytics by construction. |
| Applicant address / geography | The heatmap is department × month. Collecting addresses to draw a map would be collecting data for a question nobody asked. |
| Doctor remuneration rate table | No official schedule was supplied. The system records claimed and approved amounts; it does not compute entitlement. |
