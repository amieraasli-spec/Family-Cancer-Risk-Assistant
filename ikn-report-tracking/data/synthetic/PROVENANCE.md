# Provenance of the synthetic dataset

Extracted from `94661404-IKN_Medical_Reports_Dummy_Data.xlsx` by `scripts/extract_workbook.py`.

The workbook's own Guide sheet states: **SYNTHETIC ONLY — no real
patients, doctors, contact details or payment records**, deterministically
generated with seed 27092026, snapshot date 2026-09-27 (Asia/Kuala_Lumpur).

All patient labels, doctor names, e-mail addresses, tracking codes, receipt
references, payment references, fee amounts and claim amounts in these files
are fictional. The e-mail addresses use the reserved `.invalid` TLD and can
never be delivered to.

## What was kept and what was dropped

Kept: recorded facts — identifiers, categories, and the event dates the
workbook records as having happened.

Dropped: the workbook's derived columns (`service_due_at`, `doctor_due_at`,
`turnaround_workdays`, the `*_flag` columns, `overdue_workdays`,
`approved_unpaid_rm`, the ageing columns, `public_status_bm`). This
application recomputes all of those from its own versioned calendar, which
includes public holidays that the workbook deliberately omits. See
`docs/09-seed-reconciliation.md`.

`workbook_monthly_kpi.csv` keeps only the workbook's recorded monthly
counts, and is used as an independent cross-check on the seeder, not as a
source of KPI values.
