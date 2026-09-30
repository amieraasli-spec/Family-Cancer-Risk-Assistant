# Assumptions register

Every value in this table is a **configurable prototype assumption**, not a
verified IKN or KKM rule. Each has a `config_key` that is editable and versioned
at runtime through Administration → rules, and each carries a
`verification_state` that the UI displays.

`verification_state` values: `UNVERIFIED` (prototype default, shown with a
caution marker), `PENDING_IKN` (submitted for confirmation), `CONFIRMED`
(confirmed by the named owner, with date).

| # | Item | `config_key` | Prototype value | Basis | Owner to confirm | State |
|---|---|---|---|---|---|---|
| 1 | General service allowance | `sla.service.working_days` | 28 working days | IKN public FAQ (Rekod Perubatan) states 28 working days from receipt of a **complete** application | Records Unit head | `UNVERIFIED` |
| 2 | Starting-day convention | `calendar.include_start_day` | `false` (day after completeness is day 1) | The FAQ does not state the convention; the supplied dummy dataset excludes the starting day | Records Unit head | `UNVERIFIED` — **must be validated before production** |
| 3 | Report-type exceptions to the service allowance | `sla.service.by_report_type` | none (all report types 28) | No published exception list obtained | Records Unit head | `UNVERIFIED` |
| 4 | Doctor task allowance | `sla.doctor.working_days` | 18 working days, capped to leave the review buffer | **Invented for the prototype.** No official IKN doctor allowance was supplied. 14 and 21 are *not* asserted anywhere in this system | Clinical HODs + Records Unit | `UNVERIFIED` |
| 5 | Records review buffer | `sla.review_buffer.working_days` | 3 working days before the service deadline | Prototype choice so final checking fits inside the service deadline | Records Unit head | `UNVERIFIED` |
| 6 | Official KPI completion endpoint | `kpi.completion_endpoint` | `accepted_completed_at` (completion accepted by Records) | Chosen because it is the point Records can defend; `signed_submitted_at`, `ready_at`, `notified_at` and `collection_or_delivery_at` are all retained for stage analysis | IKN KPI owner | `UNVERIFIED` |
| 7 | On-time target | `kpi.on_time_target_percent` | 85% | KKM Piagam Pelanggan publishes an at-least-85% reference for reports within 28 working days at state/specialist hospitals. **IKN's own approved local target, cohort and exclusions are unconfirmed.** No dashboard label in this system says "official KKM KPI" | IKN KPI owner | `UNVERIFIED` |
| 8 | Working-day calendar | `calendar.version` | Mon–Fri, plus Federal Territory (Putrajaya) public holidays 2024–2026 and officially recognised replacement days as configured | Calendar rows are seeded and editable; the supplied dummy dataset deliberately omitted holidays, so seeded metrics differ slightly from the workbook's own formula columns (documented in `docs/09-seed-reconciliation.md`) | Records Unit + ICT | `UNVERIFIED` |
| 9 | Patient fee schedule | `fee.rule_version` | RM 50 ordinary / RM 100 specialist summary / RM 250 detailed specialist report | **Fictional amounts from the dummy workbook.** Not official IKN charges | Finance | `UNVERIFIED` |
| 10 | Fee-gated release | `fee.release_requires_settled` | `false` (release is not blocked by an unpaid fee) | No policy obtained permitting a fee-gated release. Left off deliberately | Records Unit head + Finance | `UNVERIFIED` |
| 11 | Claim eligibility rule | `claim.eligibility_rule_version` | `DEMO-ELIG-1`: a completed report of a chargeable type accepted by Records makes one item eligible | **Invented for the prototype.** Real eligibility criteria were not supplied | Finance + Clinical | `UNVERIFIED` |
| 12 | Doctor remuneration rates | `claim.rate_table_version` | RM 30 / RM 60 / RM 120, sampled independently of the patient fee | **Fictional amounts from the dummy workbook.** No official schedule obtained. The system stores amounts; it does not compute entitlement from a rate table | Finance | `UNVERIFIED` |
| 13 | Payment evidence definition | `payment.evidence_required` | reference **and** amount **and** paid date **and** reconciliation timestamp | Prototype control so "Paid" cannot be claimed from an approval or a voucher alone | Finance | `UNVERIFIED` |
| 14 | Finance processing allowance | `sla.finance.working_days` | not set — finance turnaround is **reported**, not judged against a deadline | No finance allocation supplied. Deliberately absent rather than invented | Finance | `UNVERIFIED` |
| 15 | Reminder schedule | `notify.reminder_offsets` | 7, 3, 1 working days before deadline; overdue alert next working day | Proposed operational setting, **not a verified KKM rule** | Records Unit head | `UNVERIFIED` |
| 16 | Escalation ladder | `notify.escalation_chain` | HOD + Records supervisor, then authorised manager | Proposed; local escalation policy not obtained | Records Unit head | `UNVERIFIED` |
| 17 | Minimum sample size for published medians | `analytics.min_sample_size` | 5 | Prototype disclosure control | Records Unit head | `UNVERIFIED` |
| 18 | Approved host for the patient portal | `deploy.public_host` | not set | ICT-approved host, approved link or reverse proxy required; the prototype runs on localhost only | IKN ICT | `UNVERIFIED` |
| 19 | Messaging gateway | `notify.provider` | `SIMULATION` | No approved gateway supplied. The adapter refuses to send to any address outside the configured test allowlist | IKN ICT | `UNVERIFIED` |
| 20 | Policy document collection for the recommendation panel | `rag.collection_version` | empty | No approved, versioned document collection supplied. The RAG path is implemented but **withholds every policy claim** and the deterministic rules panel serves in its place | Document owners | `UNVERIFIED` |
| 21 | Registration source of truth | `integration.registration` | manual entry + validated spreadsheet import | No documented interface to an existing registration system was supplied | IKN ICT | `UNVERIFIED` |
| 22 | Finance system interface | `integration.finance` | validated spreadsheet import + manual reconciliation | No documented interface supplied. The prototype never initiates a bank transfer | Finance + ICT | `UNVERIFIED` |

## What this register means in practice

- The dashboard never applies the words "official", "KKM KPI" or "IKN target" to
  any number whose `verification_state` is not `CONFIRMED`.
- Changing any value writes a new rule version with `effective_from`; existing
  applications keep the rule version they were registered under, so past results
  do not move when a rule changes.
- `docs/12-open-items-for-live-use.md` lists what must be supplied before real
  patient data or the live IKN website is involved.
