# Deployment instructions

Two deployables from one repository: an API process and a static web bundle. They
are separate on purpose — the public portal must be servable from an ICT-approved
host without the staff application going anywhere near it.

## Prerequisites

- Node 22.6 or later (the prototype uses `node:sqlite`, which ships with Node)
- For production: PostgreSQL, TLS termination, and a managed secret store
- No native build step, no system packages

## Build

```bash
npm ci
npm run typecheck        # server and web must both be clean
npm test                 # 101 acceptance checks
npm run build            # dist/server (tsc) and dist/web (vite)
```

`dist/web` contains two independent bundles:

| File | Serve as | Contains |
|---|---|---|
| `index.html` + `assets/staff-*.js` | the staff application | staff screens and the staff API client |
| `semakan.html` + `assets/semakan-*.js` | the applicant portal | the portal only — **no staff component, no staff API client** |

They share the React vendor chunk and nothing else. Serve them from separate hosts
or separate paths so the public artefact carries no staff code.

## Configuration

Copy `.env.example` and set it from the secret store. Nothing here belongs in the
repository, and nothing carries a `VITE_` prefix, because that prefix would place
it in the browser bundle.

```bash
NODE_ENV=production
PORT=4180
DATABASE_URL=postgres://…          # or IKN_DB_FILE for the prototype engine
IKN_TOKEN_PEPPER=…                 # 32+ characters from managed secrets
IKN_DATA_CLASS=SYNTHETIC           # only IKN sets LIVE — see docs/12
IKN_NOTIFY_PROVIDER=SIMULATION
IKN_NOTIFY_TEST_ALLOWLIST=records.test@example.invalid
IKN_CORS_ORIGINS=https://…         # empty means same-origin only
```

`IKN_TOKEN_PEPPER` is not optional in production: the process refuses to start
without it rather than falling back to an unkeyed hash. Rotating it invalidates
every issued tracking reference and every session — plan a reissue, or rotate only
during an outage window.

## Database

```bash
npm run db:reset    # prototype only; refuses to run unless IKN_DATA_CLASS=SYNTHETIC
```

In production, run migrations forward only. `server/db/database.ts` applies any
file in `server/db/migrations/` not yet recorded in `schema_migrations`, in name
order, and is the only file that knows which engine is in use — see
`docs/11-integration-notes.md` for the PostgreSQL adapter.

Migrations run before the process serves traffic. There is no automatic rollback:
a corrective migration is a new file, so the applied history stays a true record.

## Running

```bash
node dist/server/index.js
```

Behind a reverse proxy: terminate TLS at the proxy, forward `X-Forwarded-For` (the
application hashes it for rate limiting and never stores a raw address), and do
**not** cache `/api/public/*` or `/api/staff/*` — both already send `no-store`.

`GET /api/health` returns the data class, the messaging provider and the
integration status. It states plainly that nothing is connected, and is safe to
expose to a load balancer: it reveals no patient data and no version string.

## Scheduled work

Not wired to a scheduler in the prototype, because the intervals are unverified
(assumption #15). When they are confirmed, three jobs are needed:

| Job | Suggested cadence | Notes |
|---|---|---|
| Deadline reminders and escalation | each working day, early | Reads `notify.reminder_offsets`; the `dedupe_key` unique index makes a re-run a no-op. |
| Rate-limit pruning | daily | `pruneRateLimits()` drops windows older than a day. |
| Monthly snapshot | first working day of the month | Or leave it to the director, who can freeze on demand. Re-freezing without a reason is refused, so an accidental double run cannot overwrite a frozen month. |

Every one of these is safe to run twice, which is the property to preserve if you
change them.

## Monitoring

| Watch | Where | Why |
|---|---|---|
| Failed notifications | `notifications` where `status = 'FAILED'`, surfaced on Overview → Queue health and in Administration | An applicant whose report is ready and who was never told is the most likely reason for a telephone call. |
| Denied authorisations | `audit_events` where `outcome = 'DENIED'` | A run against one account is the signal the table exists for. |
| Public rate limiting | 429s on `/api/public/*` | Sustained limiting means somebody is probing tracking references. |
| Data-quality exceptions | Reports → Exceptions | These leave figures unmeasurable, which flatters the reported result while they stand. |

## Rollback

The web bundle is static — redeploy the previous build. The API is stateless apart
from the database, so redeploying the previous image is safe **provided no
migration ran**. If one did, roll forward with a corrective migration rather than
reversing it: `status_events`, `payment_allocations` and `monthly_snapshot_versions`
are append-only records, and reversing a migration over them risks destroying the
audit trail that makes a past figure defensible.
