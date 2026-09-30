# IKN Medical Report Tracking & Performance System

A working prototype for the Medical Records Unit of Institut Kanser Negara.
Patient-facing title: **Semakan Status Laporan Perubatan**.

It tracks a medical report application from receipt to collection, tracks the
doctor's claim and its payment separately, and produces monthly management KPIs
that reconcile with what the dashboard shows.

> **Demonstration data — not actual IKN performance.** Every figure comes from the
> supplied synthetic workbook. This build is not connected to the IKN website, a
> registration system, a finance system or a messaging gateway, and a demonstration
> is not evidence that it is. `GET /api/health` and the Overview → Queue health
> screen both say so.

---

## Running it

Node 22.6 or later. No database server and no native build step.

```bash
npm install
cp .env.example .env          # then set IKN_TOKEN_PEPPER to any 32+ character value
npm run db:reset              # create the schema
npm run db:seed               # load the synthetic dataset and print a summary
npm run dev                   # API on :4180, web on :4181
```

Then open:

- **http://localhost:4181/semakan.html** — the applicant portal
- **http://localhost:4181/index.html** — the staff application

`npm run db:seed` writes `var/demo-tracking-references.csv`, which holds the
plaintext tracking references for the demonstration. Only their HMACs are in the
database. *An equivalent file must never be produced for real applicants.*

### Demonstration accounts

Password `ikn-prototype-2026` for all of them. Privileged roles need a second
factor; the prototype accepts `000000` and records it as simulated.

| Username | Role | Worth seeing |
|---|---|---|
| `records1` | Records officer | the whole workflow, all five tabs |
| `records.super` | Records supervisor | additionally may reopen a closed case |
| `demo-d001` … `demo-d018` | Doctor | their own work and claims, and nothing else |
| `hod.rto`, `hod.sur`, … | Head of department | one department only; asking for another is refused |
| `finance1`, `finance2` | Finance officer | claims and payments; `finance2` can approve what `finance1` verified |
| `director` | Director | hospital performance, extensions, snapshot freezing |
| `sysadmin` | System administrator | configuration and audit — **and no patient data at all** |

---

## Verifying it

```bash
npm run typecheck   # server and web
npm test            # 101 acceptance checks
npm run reconcile   # this engine's monthly figures against the supplied workbook
```

The test suite covers the eleven risks the brief names as affecting patients,
reporting or money, and drives the real HTTP application rather than calling
handlers directly — an access-control test that bypasses the router proves nothing
about the route.

A browser pass checks the tablet constraint. It needs both servers running:

```bash
npm run dev            # in one terminal
npm run test:ui        # in another
```

It walks 37 screens at 768 × 904 (the reference 10-inch portrait viewport less
browser chrome) and reports any page scroll, **any clipped content**, and any
analytical output missing either mandatory caption. Screenshots land in
`var/screens/`.

---

## How it is put together

```
docs/        the specification: screen map, workflows, permissions, visuals, assumptions
shared/      vocabulary and text used by both the server and the two frontends
server/
  db/        schema, migrations, seeders
  domain/    calendar, deadlines, money, ids, events — no HTTP, no SQL dialect
  auth/      permissions, sessions, the authorisation gate
  services/  workflow, claims, fees, exports — one entry point per workflow
  analytics/ cohort, metrics, captions, forecast, recommendations, panels
  http/      routers; public and staff are mounted separately
web/
  src/portal/  the applicant portal — its own bundle, no staff code in it
  src/staff/   the staff application
tests/       acceptance checks
scripts/     extraction, seeding, reconciliation
data/        the committed synthetic dataset and the working-day calendar
```

### Six decisions worth not re-litigating

**Three workflows, deliberately independent.** Report, patient fee and doctor claim
each have their own state machine. Release to the applicant is never gated on a
claim or a reimbursement, and completing a report never, by itself, creates a
payable entitlement. `tests/04-money.test.ts` holds this down.

**The event trail is the record; the status column is a cache.** One function
changes an application's status, and it writes the event in the same transaction.
`status_events` is append-only — no `UPDATE` or `DELETE` in the codebase targets it.

**The original deadline is written once.** Reassignment, leave, return for
correction, reopening and claim processing all leave it untouched. Only an
authorised extension writes a revised date, and it keeps the original alongside,
with a reason and an approver.

**"Paid" requires evidence.** A reference, an amount, a paid date and a
reconciliation timestamp — enforced in the service layer *and* as a table
constraint. An approval, a voucher or a payment instruction reads "Awaiting payment
confirmation". A reversal is a negative allocation, not an edit, so history stays
intact.

**Captions are computed, never written.** Every chart and table carries "How to read
this" and "What this shows", both generated from the same validated aggregate that
drew the marks, both recomputed when a filter changes, and both carried into the
CSV and the PDF. No positive finding is hard-coded; where the data is unflattering
the caption says so — the seeded dataset never reaches the 85% reference, and the
timeliness caption reports exactly that.

**Absence is shown, not implied.** A zero denominator renders "Not applicable — no
eligible cases", never 0%. A heatmap cell with nothing due is grey with its own
legend entry, never the bottom of the scale. A forecast with too little history is
withheld with the reason. A recommendation with no approved policy behind it says
"No verified policy source available" and routes to the document owner.

---

## What is unverified

Every policy-dependent value is a versioned, editable configuration row marked
`UNVERIFIED`, listed in **`docs/05-assumptions-register.md`**, and shown as such in
Administration. The dashboard never applies the words "official", "KKM KPI" or "IKN
target" to a figure derived from an unconfirmed value.

The ones that matter most:

- **The starting-day convention** — it moves every deadline by one working day.
- **The doctor allowance** — 18 working days was invented here. 14 and 21 are
  asserted nowhere in this system.
- **The KPI endpoint and target** — the 85% is the KKM Piagam Pelanggan reference
  for state and specialist hospitals, not a confirmed IKN target.
- **Fee and claim amounts** — fictional, from the dummy workbook.
- **Variable-date public holidays** — deliberately *not* generated. Guessing Hari
  Raya or Deepavali would move real applicants' deadlines by whole working days.
  They load from the gazette through Administration → Business calendar.

**`docs/12-open-items-for-live-use.md`** is the list to work through before the
portal is linked from the IKN website, and before any real patient data is entered.

---

## Documents

| | |
|---|---|
| `docs/01-screen-map.md` | every screen and the tablet budget it fits |
| `docs/02-workflows-and-state-transitions.md` | the three state machines and their invariants |
| `docs/03-permission-matrix.md` | the matrix, and the prohibitions the tests enforce |
| `docs/04-visual-variable-mapping.md` | which variable each visual encodes, and why a heatmap rather than a map |
| `docs/05-assumptions-register.md` | **every unverified value, with its owner** |
| `docs/06-data-dictionary.md` | entities, conventions, and the fields deliberately absent |
| `docs/07-api-contracts.md` | all three surfaces, with error codes |
| `docs/08-configuration-guide.md` | every editable setting and what changing it moves |
| `docs/09-seed-reconciliation.md` | this engine against the supplied workbook, quantified |
| `docs/10-deployment.md` | build, configure, run, schedule, monitor, roll back |
| `docs/11-integration-notes.md` | implemented / simulated / absent, and moving to PostgreSQL |
| `docs/12-open-items-for-live-use.md` | **what must be closed before live use** |

---

## Data provenance

The dataset is the supplied `IKN_Medical_Reports_Dummy_Data.xlsx`, whose own Guide
sheet states: SYNTHETIC ONLY, deterministically generated with seed 27092026,
snapshot 2026-09-27 (Asia/Kuala_Lumpur), no hospital database or real patient file
used. `scripts/extract_workbook.py` is the only code that reads it, and writes
reviewable CSV to `data/synthetic/`.

The workbook's derived columns — deadlines, flags, turnaround, balances — are
deliberately dropped and recomputed here against a calendar that includes public
holidays, which the workbook omits. Shipping two disagreeing answers to the same
question would have been worse than explaining one difference:
`docs/09-seed-reconciliation.md` quantifies it. Received, completed and cancelled
counts agree exactly across all 33 months; only the derived deadlines differ, by
42 applications whose due date moves into an adjacent month.
