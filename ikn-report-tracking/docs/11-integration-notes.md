# Integration and deployment notes

## What is implemented, what is simulated, what is absent

The distinction matters more than anything else on this page. **A demonstration is
not evidence that this application has been connected to the IKN website or to a
finance system.**

| Capability | State | What that means |
|---|---|---|
| Report, fee and claim workflows | **Implemented** | Working code over a relational schema, with an append-only event trail and an acceptance suite. |
| Deadline engine and KPIs | **Implemented** | Working, against a calendar that is itself unverified. |
| Public status portal | **Implemented** | Runs on localhost. Not attached to the IKN website. |
| Forecast and recommendations | **Implemented** | The forecast is validated; the recommendation panel is the deterministic rules layer. |
| Exports and monthly snapshots | **Implemented** | CSV and print-ready PDF, reconciled with the dashboard. |
| Messaging (SMS / e-mail) | **Simulated** | The adapter writes to the notification log and makes no network call. It cannot reach a real applicant. |
| Multi-factor authentication | **Simulated** | The control is real — a privileged session holds no permission until it clears — but the factor is a fixed demonstration code. |
| Attachment virus scanning | **Simulated** | The schema and the flow exist; `scan_status` is `SKIPPED_SIMULATION`. |
| Retrieval over policy documents | **Implemented, withholding** | The retrieval path and its clearance filter are real. The collection is empty, so it returns nothing and the panel says so. |
| Registration system interface | **Absent** | Manual entry and a validated spreadsheet import. Labelled a manual reconciliation everywhere it appears. |
| Finance system interface | **Absent** | As above. This system records payments; it never initiates a bank transfer. |
| IKN website integration | **Absent** | The live site has not been touched. |
| Staff SSO | **Absent** | Local accounts, so the permission model can be exercised. |

`GET /api/health` reports this, and the dashboard's Overview → Queue health shows
it on screen, so nobody has to take the table above on trust.

## Moving from the prototype database to PostgreSQL

The prototype runs on `node:sqlite`, which ships with Node 22 and needs no native
build. Every statement is written to a portability contract set out at the top of
`server/db/migrations/001_initial.sql`:

- timestamps are `TEXT` ISO-8601 UTC; all Asia/Kuala_Lumpur arithmetic is in the
  domain layer, so no SQL depends on a session time zone;
- money is `INTEGER` sen; no `NUMERIC` precision to agree on;
- booleans are `INTEGER` 0/1 rather than `BOOLEAN`;
- identifiers are application-generated `TEXT`, so there is no `SERIAL`/`IDENTITY`
  difference;
- placeholders are `?`, so an adapter renumbers them to `$1..$n` and nothing else.

What a PostgreSQL adapter has to supply: connection pooling, that placeholder
renumbering, and `ON CONFLICT` syntax — which is already the PostgreSQL spelling.
`server/db/database.ts` is the only file that knows which engine is in use.

**Before production**, replace these prototype shortcuts:

1. **Verification tokens** are held in a `Map` in `server/http/public-routes.ts`.
   Correct for a single process; a multi-instance deployment needs the shared
   session store.
2. **Analytics load the filtered cohort into memory**, because working-day
   arithmetic cannot be expressed in portable SQL. At 1,000 applications this
   costs milliseconds. For a multi-year dataset, add a nightly materialised table
   of derived working-day columns keyed by calendar version — not a bigger query.
3. **The PDF is print-ready HTML.** For an unattended monthly PDF, render it
   headless server-side; the HTML already carries both captions, the filter echo
   and the data-class notice.

## Hosting the patient portal

The brief's constraint: a dedicated application on an ICT-approved host, reached
through an approved link or reverse proxy. **Do not modify the live website during
the prototype stage**, and do not assume an existing API.

- The portal builds as its own bundle (`semakan.html`) with no staff component and
  no staff API client in it, so the public artefact cannot be made to reveal staff
  data by a client-side mistake.
- It sets `frame-ancestors 'none'` and `X-Frame-Options: DENY`. An embedded
  component is possible only if IKN's site security configuration permits framing;
  a link is the safe default and is what the screen map assumes.
- `deploy.public_host` is unset and `UNVERIFIED`.

Reverse-proxy expectations, if that route is chosen: terminate TLS at the proxy,
forward `X-Forwarded-For` (the application hashes it and never stores a raw
address), and do **not** cache `/api/public/*` — the responses already say
`no-store`.

## Registration and finance: the import path

There is no documented interface to either system, so the supported route is a
validated spreadsheet import with controlled manual reconciliation.

`POST /api/staff/imports/dry-run` validates and reports per row and **applies
nothing**, so an operator sees exactly what a real import would do first. Each row
is `ACCEPTED`, `REJECTED`, `DUPLICATE` or `CONFLICT`, and the batch records its
source, `imported_at`, who ran it and who reconciled it. The duplicate guard is the
same one a doctor's submission hits: an import cannot create a second live claim
item for one eligible service.

Everything about this path is labelled `MANUAL_IMPORT` in the database, in the API
response and on the dashboard. It is never described as live integration.

When IKN supplies a documented, approved interface, it replaces the import at the
`import_batches.integration_mode` boundary and the label changes to
`APPROVED_INTERFACE`.

## Messaging

`server/config/settings.ts` reads `IKN_NOTIFY_PROVIDER`. `SIMULATION` writes to
`notifications` and makes no network call. `IKN_NOTIFY_TEST_ALLOWLIST` bounds the
destinations the adapter may ever use, so a test run cannot reach a real patient.

Message content is minimal administrative information addressed to a verified
contact reference — never clinical text, never a full identifier. `dedupe_key` is
uniquely indexed, so a retried job sends nothing twice; failures carry a reason and
an attempt count and surface on the dashboard and in Administration.

## Secrets and configuration

| Variable | Purpose | Production |
|---|---|---|
| `IKN_TOKEN_PEPPER` | HMACs tracking references, session ids and one-time codes | **Required**; from managed secrets. The process refuses to start in production without it. |
| `IKN_DB_FILE` / `DATABASE_URL` | database location | managed |
| `IKN_DATA_CLASS` | `SYNTHETIC` keeps the demonstration notice on every page and export | only IKN may set `LIVE`, and only after `docs/12-open-items-for-live-use.md` is closed |
| `IKN_NOTIFY_PROVIDER` | `SIMULATION` or `APPROVED_GATEWAY` | |
| `IKN_CORS_ORIGINS` | origins permitted to call the API from a browser | empty means same-origin only |

No secret carries a `VITE_` prefix, because that prefix would put it in the
browser bundle. The frontend holds no key of any kind: the session is an HttpOnly
cookie the browser sends on its own.

## Backups and retention

Not implemented; it is an operational decision, not a code one. What the schema
supports: every financial and status change is reconstructable from
`status_events` and `payment_allocations`, monthly snapshots freeze a reportable
position, and `audit_events` records privileged access. Retention periods must
come from IKN's records-management policy, which was not supplied.
