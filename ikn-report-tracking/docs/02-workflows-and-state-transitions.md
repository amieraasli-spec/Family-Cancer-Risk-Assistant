# Workflows and state transitions

Three workflows run **independently** on the same application. Release of the
report to the applicant is never gated on the doctor's claim or reimbursement.
Completing a report never, by itself, creates a payable entitlement.

All transitions are recorded as rows in `status_events` (append-only). A status
column on the entity is a cached projection of the latest event, never the
source of truth for history.

---

## A. Medical report workflow (`internal_status` on `applications`)

```
                      ┌─────────────────────────────────────────────┐
                      │                                             ▼
RECEIVED ──► AWAITING_DOCUMENTS ──► COMPLETE_UNASSIGNED ──► ASSIGNED ──► ACKNOWLEDGED
    │                  ▲                     ▲                 │              │
    │                  └── returned ─────────┘                 │              ▼
    │                                                          │        IN_PREPARATION
    │                                                          │              │
    │                                              reassigned ─┘              ▼
    │                                                              SIGNED_SUBMITTED
    │                                                                   │      ▲
    │                                                                   ▼      │
    │                                                            RECORDS_VERIFICATION
    │                                                               │          │
    │                                       returned for correction ┘──────────┘
    │                                                               ▼
    │                                                       READY_FOR_RELEASE
    │                                                               │
    │                                                               ▼
    └────────────────► CANCELLED ◄────────────────────────  COLLECTED_OR_DELIVERED
                          │                                         │
                          └──── reopened ──► (prior state) ◄── reopened
```

| From | Event | To | Permitted roles | Notes |
|---|---|---|---|---|
| — | `REGISTER` | `RECEIVED` | records_officer | sets `received_at`; patient-journey clock starts here |
| `RECEIVED` | `MARK_INCOMPLETE` | `AWAITING_DOCUMENTS` | records_officer | sets `next_action_owner = APPLICANT` |
| `RECEIVED` / `AWAITING_DOCUMENTS` | `MARK_COMPLETE` | `COMPLETE_UNASSIGNED` | records_officer | sets `application_complete_at` (true time) **and** `completeness_recorded_at` (time staff recorded it); service deadline is computed here |
| `COMPLETE_UNASSIGNED` | `ASSIGN` | `ASSIGNED` | records_officer, hod | creates a `doctor_tasks` row; sets `original_doctor_due_at` |
| `ASSIGNED` | `ACKNOWLEDGE` | `ACKNOWLEDGED` | doctor (own task) | sets `acknowledged_at` |
| `ACKNOWLEDGED` | `START_PREPARATION` | `IN_PREPARATION` | doctor (own task) | |
| `ACKNOWLEDGED` / `IN_PREPARATION` | `SUBMIT_SIGNED` | `SIGNED_SUBMITTED` | doctor (own task) | sets `signed_submitted_at`; **not** completion |
| `SIGNED_SUBMITTED` | `BEGIN_RECORDS_CHECK` | `RECORDS_VERIFICATION` | records_officer | |
| `RECORDS_VERIFICATION` | `RETURN_FOR_CORRECTION` | `IN_PREPARATION` | records_officer | records `returned_at`, `delay_reason_code`; **overall service deadline unchanged** |
| `RECORDS_VERIFICATION` | `ACCEPT_COMPLETION` | `READY_FOR_RELEASE` | records_officer | sets `accepted_completed_at` on the task and `report_completed_at` + `ready_at` on release |
| `READY_FOR_RELEASE` | `NOTIFY_APPLICANT` | `READY_FOR_RELEASE` | records_officer | sets `notified_at`; not a stage change |
| `READY_FOR_RELEASE` | `RECORD_COLLECTION` | `COLLECTED_OR_DELIVERED` | records_officer | sets `collection_or_delivery_at`, `receipt_of_delivery_reference` |
| any non-terminal | `CANCEL` | `CANCELLED` | records_officer (+ reason) | requires applicant-facing explanation |
| `CANCELLED` / `COLLECTED_OR_DELIVERED` | `REOPEN` | previous state | records_officer supervisor | reason + approver recorded; original deadline preserved |
| `ASSIGNED`…`SIGNED_SUBMITTED` | `REASSIGN` | `ASSIGNED` | hod (own department), records_officer | closes old task, opens new one; **service deadline unchanged**; `reassignment_events` incremented |
| `COMPLETE_UNASSIGNED`+ | `GRANT_EXTENSION` | unchanged | authorised manager | writes `revised_due_at`, keeps `original_service_due_at`; requires reason, approver, timestamps |

### Public stage mapping

| Internal status | Public stage (BM) |
|---|---|
| `RECEIVED` | Permohonan diterima |
| `AWAITING_DOCUMENTS` | Tindakan pemohon diperlukan |
| `COMPLETE_UNASSIGNED`, `ASSIGNED`, `ACKNOWLEDGED`, `IN_PREPARATION`, `SIGNED_SUBMITTED` | Sedang diproses |
| `RECORDS_VERIFICATION` | Dalam semakan akhir |
| `READY_FOR_RELEASE` | Sedia untuk diambil / dihantar |
| `COLLECTED_OR_DELIVERED` | Selesai |
| `CANCELLED` | Dibatalkan / tidak diteruskan |

A delayed case keeps its true stage and gains a courteous delay message plus the
latest update. The original target stays visible; any revised estimate is shown
separately and labelled as an estimate, never as a guaranteed completion date.

---

## B. Patient fee workflow (`fee_status` on `patient_fees`)

```
NOT_REQUIRED
AWAITING_PAYMENT ──► PAID ──► REFUNDED
        │              │
        │              └──► RECONCILIATION_EXCEPTION
        └──► EXEMPT
```

| From | Event | To | Roles | Notes |
|---|---|---|---|---|
| — | `SET_FEE` | `AWAITING_PAYMENT` / `NOT_REQUIRED` | records_officer | amount from the active `fee_rule_version` |
| `AWAITING_PAYMENT` | `RECORD_PAYMENT` | `PAID` | records_officer | requires `receipt_reference`, verified `amount_received`, `verified_at` |
| `AWAITING_PAYMENT` | `GRANT_EXEMPTION` | `EXEMPT` | records_officer | requires `exemption_basis` |
| `PAID` | `RECORD_REFUND` | `REFUNDED` | records_officer | `refund_amount` |
| `PAID` | `FLAG_EXCEPTION` | `RECONCILIATION_EXCEPTION` | finance_officer | amount/receipt mismatch surfaced, not hidden |

Fee collection is **not** doctor remuneration. Release conditions tied to an
unpaid fee apply only through the configured approved policy
(`release_requires_fee_settled` in the fee rule version), which ships **off** in
the prototype pending IKN confirmation.

---

## C. Doctor claim workflow (`claim_items.status`)

Eligibility is assessed separately from claim status.

```
eligibility:  UNASSESSED ──► ELIGIBLE ──► (claim lifecycle)
                         └─► NOT_ELIGIBLE  (terminal, with rule version)

claim:  NOT_SUBMITTED ──► SUBMITTED ──► UNDER_VERIFICATION ──► VERIFIED ──► APPROVED
                 ▲                              │                              │
                 │                              ▼                              ▼
                 └──────── RETURNED ◄───────────┘                      PAYMENT_PROCESSING
                 │                                                             │
                 ├──► WITHDRAWN (doctor, before verification)                   ▼
                 └──► REJECTED (finance, terminal, with reason)         ┌── PARTIALLY_PAID ──┐
                                                                       │        │            │
                                                                       ▼        ▼            ▼
                                                                     PAID   PAYMENT_FAILED  REVERSED
```

| From | Event | To | Roles |
|---|---|---|---|
| `UNASSESSED` | `ASSESS_ELIGIBILITY` | `ELIGIBLE` / `NOT_ELIGIBLE` | records_officer, finance_officer |
| `NOT_SUBMITTED` | `SUBMIT_CLAIM` | `SUBMITTED` | doctor (own item only) |
| `SUBMITTED` | `FINANCE_RECEIVE` | `UNDER_VERIFICATION` | finance_officer |
| `UNDER_VERIFICATION` | `RETURN_CLAIM` | `RETURNED` | finance_officer (+ `return_reason`) |
| `UNDER_VERIFICATION` | `VERIFY_CLAIM` | `VERIFIED` | finance_officer |
| `UNDER_VERIFICATION` | `REJECT_CLAIM` | `REJECTED` | finance_officer (+ reason) |
| `RETURNED` | `SUBMIT_CLAIM` | `SUBMITTED` | doctor (duplicate guard re-checked) |
| `VERIFIED` | `APPROVE_CLAIM` | `APPROVED` | finance_officer **≠ submitter** |
| `APPROVED` | `INSTRUCT_PAYMENT` | `PAYMENT_PROCESSING` | finance_officer |
| `PAYMENT_PROCESSING` | `RECONCILE_PAYMENT` | `PARTIALLY_PAID` / `PAID` | finance_officer |
| `PAYMENT_PROCESSING` | `RECORD_PAYMENT_FAILURE` | `PAYMENT_FAILED` | finance_officer |
| `PAID` / `PARTIALLY_PAID` | `RECORD_REVERSAL` | `REVERSED` | finance_officer |
| `NOT_SUBMITTED` / `SUBMITTED` | `WITHDRAW_CLAIM` | `WITHDRAWN` | doctor (own item) |

### Invariants enforced in the database and in the service layer

1. **`PAID` requires reconciled evidence** — at least one `payment_allocations`
   row with `payment_reference`, `amount_paid` and `paid_at` all present, and
   `reconciled_at` set. An approval, a payment instruction or a voucher alone
   moves the item no further than `PAYMENT_PROCESSING`, displayed as
   *"Awaiting payment confirmation"*.
2. **No duplicate active claim item** for the same `(application_id, task_id,
   eligibility_rule_version)` — a partial unique index excludes only terminal
   non-consuming states (`REJECTED`, `WITHDRAWN`, `REVERSED`). Re-submission and
   spreadsheet import both hit the same guard.
3. **Submitter ≠ approver** — `APPROVE_CLAIM` rejects when the acting user is the
   claim's submitting doctor or the user who created the submission event.
4. **A claim may hold several items**; each item keeps its own report, doctor,
   amount, eligibility rule and status. Aggregations count items, never
   applications, for money.
5. **No payment initiation.** The system records payment; it never instructs a bank.
