# Seed reconciliation: this engine against the supplied workbook

Reproduce with `npm run db:reset && npm run db:seed && npm run reconcile`, which
writes the full month-by-month comparison to `var/reconciliation.csv`.

Both sides describe the same 1,000 synthetic applications. They agree exactly on
what the dataset **records**, and differ in a bounded, explained way on what is
**derived** — because this application recomputes every deadline against a
calendar that includes public holidays, and the workbook's own formula columns
deliberately omit them.

## Recorded facts: exact agreement

| Measure | Months compared | Months disagreeing |
|---|---|---|
| Applications received | 33 | **0** |
| Reports completed | 33 | **0** |
| Applications cancelled | 33 | **0** |

This is the check that matters most for the seeder: every application, its
department, its report type and every event date loaded exactly as the workbook
recorded it. Nothing was dropped, duplicated or shifted in translation.

The derived-status cross-check tells the same story. The seeder reconstructs each
application's internal status from the timestamps that exist rather than trusting
the workbook's status column, and the two disagree on **3 of 1,000** rows:

| Application | Workbook column | Derived from the timestamps |
|---|---|---|
| DEMO-LP-00919 | `RELEASE_CHECK` | `READY_FOR_RELEASE` — a `report_completed_at` is present, so completion has been accepted |
| DEMO-LP-00962 | `RECEIVED` | `AWAITING_DOCUMENTS` — `next_action_owner` is `APPLICANT` |
| DEMO-LP-00977 | `RECEIVED` | `AWAITING_DOCUMENTS` — as above |

In each case the derived status follows the recorded events, which is the
convention this system holds to throughout: the status column is a cache of the
event trail, never an independent claim.

## Derived deadlines: a bounded, explained difference

The workbook's Guide sheet states its calendar is **`MON-FRI ONLY` — "Public and
replacement holidays intentionally omitted"**. This application's calendar
includes the fixed-date Federal Territory (Putrajaya) holidays, so a 28
working-day allowance spanning one of them lands one working day later here.

| Measure | Workbook | This engine |
|---|---|---|
| Due-cohort denominator, all months | 921 | 911 |
| On time within the original deadline | 673 | 669 |
| Due-cohort on-time rate | 73.1% | **73.4%** |
| Months where the due-cohort size differs | — | 18 of 33 |
| Applications whose due date moved to a different month | — | 42 |

Two effects, both in the expected direction:

1. **Deadlines move later**, because holidays are excluded from the count. That
   turns a handful of narrowly-late reports into narrowly-on-time ones, which is
   why the rate is marginally higher here.
2. **Cohort boundaries move**, because a deadline pushed past a month end joins
   the next month's due cohort. Forty-two applications changed due month, which
   is why 18 of 33 months have a different denominator even though the underlying
   population is identical.

The remaining ten of the denominator difference (921 − 911) comes from the four
applications whose completeness date the seeder deliberately removes (below) plus
six whose due date moved past the 2026-09-27 cutoff and so are not yet due.

**Neither figure is a measurement of IKN.** Both are properties of a synthetic
dataset, and the engine's calendar is itself `UNVERIFIED`: the variable-date
holidays are not loaded, so it still under-counts non-working days. Loading the
gazette through Administration → Business calendar would move deadlines later
again and lift the rate slightly further.

## Deliberate augmentations

Four changes to the dataset, each made so a required behaviour has something real
to act on. All are deterministic — reseeding reproduces them exactly — and all are
reported by `npm run db:seed`.

| Augmentation | Count | Why |
|---|---|---|
| Missing completeness date | 4 | The brief requires missing dates to appear as data-quality exceptions. Without any, the exception reporting would have nothing to report and could not be demonstrated or tested. |
| Late completeness recording | 7 | Exercises the separation of the true completeness time from the time staff recorded it, and proves the clock runs from the former. |
| Payment failures | 1 | The workbook's Guide lists payment failures as out of scope, but acceptance check 6 requires the failed-payment path to exist. |
| Payment reversals | 3 | As above, for reversals. Each is a reconciled payment plus a negative reversing allocation, so the net position stays derivable. |

The reversals are why the approved-unpaid figure here (RM 1,260 at the snapshot,
before the extra test case added in development) exceeds the workbook's summary
figure of RM 1,050: a reversal restores an outstanding balance, which is exactly
what it should do.

Also created beyond the workbook: a `contact_enquiries` log, generated
deterministically at roughly 18 status enquiries per 100 applications, because the
follow-up burden indicator has no source in the supplied data. It is a
contact-volume indicator only. There is no measured baseline, so no improvement
may be claimed from it.

## What this reconciliation does not establish

- It does not validate any figure against IKN. Both sides are synthetic.
- It does not confirm the starting-day convention. The workbook and this engine
  both exclude the starting day; whether IKN does is assumption #2 and remains
  `UNVERIFIED`.
- It does not confirm the completion endpoint. This engine measures to completion
  accepted by Records; the workbook's `completed` column happens to align, but the
  applicable KPI endpoint is assumption #6 and is unconfirmed.
