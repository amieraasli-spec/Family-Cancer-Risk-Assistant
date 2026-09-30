#!/usr/bin/env python3
"""Extract the supplied synthetic workbook into committed CSV files.

The workbook that seeded this prototype is
`IKN_Medical_Reports_Dummy_Data.xlsx`, described by its own Guide sheet as
"SYNTHETIC ONLY ... Deterministically generated fictional data using seed
27092026; no hospital database or real patient file used."

This script is the only place that reads the .xlsx. It writes plain CSV so the
dataset is reviewable in a diff, and it deliberately drops the workbook's
rightmost *derived* columns (deadlines, flags, turnaround, balances). Those are
recomputed by this application's own deadline engine against a calendar that
includes public holidays, which the workbook omits on purpose. Keeping the
workbook's formula output would have meant shipping two disagreeing answers to
the same question; `docs/09-seed-reconciliation.md` records the difference.

Usage:  python3 scripts/extract_workbook.py [path-to-xlsx]
"""
from __future__ import annotations

import csv
import sys
from datetime import datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover - developer guidance only
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "synthetic"

DEFAULT_XLSX = Path(
    "/root/.claude/uploads/a62cfc56-b7ef-5028-97f2-607bb7e21932/"
    "94661404-IKN_Medical_Reports_Dummy_Data.xlsx"
)

# Recorded facts we keep. Everything else on the sheet is derived and is
# recomputed by server/domain/deadlines.ts.
APPLICATION_COLUMNS = [
    "application_id", "tracking_code_demo", "patient_label", "applicant_type",
    "department", "doctor_id", "report_type", "request_purpose",
    "received_at", "application_complete_at", "assigned_at", "acknowledged_at",
    "signed_submitted_at", "report_completed_at", "ready_at", "notified_at",
    "collected_at", "cancelled_at",
    "fee_status", "fee_due_rm", "fee_received_rm", "fee_receipt_demo", "fee_received_at",
    "internal_status", "delay_reason", "next_action_owner", "scenario", "claim_eligibility",
]
CLAIM_COLUMNS = [
    "claim_item_id", "application_id", "doctor_id", "department", "eligible_at",
    "claim_id", "claim_status", "claim_form_submitted", "claim_submitted_at",
    "finance_received_at", "verified_at", "approved_at", "last_payment_at",
    "claimed_amount_rm", "approved_amount_rm", "net_paid_rm",
    "payment_reference_demo", "claim_form_reference_demo", "return_or_rejection_reason",
]
DOCTOR_COLUMNS = ["doctor_id", "doctor_name", "department", "email"]
KPI_COLUMNS = [
    "month_start", "data_through", "period_status", "received", "completed", "cancelled",
]


def cell(value: object) -> str:
    """Render a cell for CSV. Dates become YYYY-MM-DD; blanks stay blank.

    A blank means "the event has not happened or does not apply". It never means
    zero, and nothing downstream is allowed to read it as a date.
    """
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def sheet_rows(workbook, name: str, columns: list[str]) -> list[dict[str, str]]:
    ws = workbook[name]
    rows = list(ws.iter_rows(values_only=True))
    header = [cell(h) for h in rows[0]]
    missing = [c for c in columns if c not in header]
    if missing:
        sys.exit(f"sheet {name} is missing expected columns: {missing}")
    index = {c: header.index(c) for c in columns}
    key = columns[0]
    out: list[dict[str, str]] = []
    for raw in rows[1:]:
        record = {c: cell(raw[index[c]]) for c in columns}
        # Captions sit underneath each table; they have no value in the key column.
        if not record[key]:
            continue
        out.append(record)
    return out


def write_csv(name: str, columns: list[str], rows: list[dict[str, str]]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path.relative_to(ROOT)}: {len(rows)} rows")


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not src.exists():
        sys.exit(f"workbook not found: {src}\nPass the path as the first argument.")
    wb = openpyxl.load_workbook(src, data_only=True)

    write_csv("applications.csv", APPLICATION_COLUMNS,
              sheet_rows(wb, "Applications", APPLICATION_COLUMNS))
    write_csv("claim_items.csv", CLAIM_COLUMNS, sheet_rows(wb, "Claims", CLAIM_COLUMNS))
    write_csv("doctors.csv", DOCTOR_COLUMNS, sheet_rows(wb, "Doctors", DOCTOR_COLUMNS))
    write_csv("workbook_monthly_kpi.csv", KPI_COLUMNS,
              sheet_rows(wb, "Monthly_KPI", KPI_COLUMNS))

    (OUT / "PROVENANCE.md").write_text(
        "# Provenance of the synthetic dataset\n\n"
        f"Extracted from `{src.name}` by `scripts/extract_workbook.py`.\n\n"
        "The workbook's own Guide sheet states: **SYNTHETIC ONLY — no real\n"
        "patients, doctors, contact details or payment records**, deterministically\n"
        "generated with seed 27092026, snapshot date 2026-09-27 (Asia/Kuala_Lumpur).\n\n"
        "All patient labels, doctor names, e-mail addresses, tracking codes, receipt\n"
        "references, payment references, fee amounts and claim amounts in these files\n"
        "are fictional. The e-mail addresses use the reserved `.invalid` TLD and can\n"
        "never be delivered to.\n\n"
        "## What was kept and what was dropped\n\n"
        "Kept: recorded facts — identifiers, categories, and the event dates the\n"
        "workbook records as having happened.\n\n"
        "Dropped: the workbook's derived columns (`service_due_at`, `doctor_due_at`,\n"
        "`turnaround_workdays`, the `*_flag` columns, `overdue_workdays`,\n"
        "`approved_unpaid_rm`, the ageing columns, `public_status_bm`). This\n"
        "application recomputes all of those from its own versioned calendar, which\n"
        "includes public holidays that the workbook deliberately omits. See\n"
        "`docs/09-seed-reconciliation.md`.\n\n"
        "`workbook_monthly_kpi.csv` keeps only the workbook's recorded monthly\n"
        "counts, and is used as an independent cross-check on the seeder, not as a\n"
        "source of KPI values.\n",
        encoding="utf-8",
    )
    print(f"{(OUT / 'PROVENANCE.md').relative_to(ROOT)}: written")


if __name__ == "__main__":
    main()
