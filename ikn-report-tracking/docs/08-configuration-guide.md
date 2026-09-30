# Configuration guide

Everything policy-dependent is data, not code. Each setting is versioned, carries a
verification state and an owner, and can be changed at runtime by a system
administrator without a deployment.

## The four kinds of configuration

| Kind | Table | Changed by | Effect of a change |
|---|---|---|---|
| Working-day calendar | `business_calendar_versions` + `business_calendar_days` | Administration → Business calendar | New deadlines use the new dates. Deadlines already recorded do not move. |
| SLA rules | `sla_rules` | `POST /api/staff/config` (new version) | An application keeps the rule version it was registered under. |
| Fee rules | `fee_rules` | as above | As above. |
| Claim eligibility | `claim_eligibility_rules` | as above | As above. |
| Operational settings | `config_settings` | Administration → Assumptions & rules | Takes effect on the next request. |

**Nothing overwrites.** A change supersedes the current row and inserts the next
version with an `effective_from`, so a figure computed last month can still be
reproduced under the rule that produced it. That is also why every monthly snapshot
records the rule and calendar versions it was taken under.

## Verification state

Every setting is `UNVERIFIED`, `PENDING_IKN` or `CONFIRMED`. The dashboard shows
the state, and applies the words "official", "KKM KPI" or "IKN target" to nothing
derived from a setting that is not `CONFIRMED`.

Confirming a value is a deliberate act with a named owner:

```http
POST /api/staff/config
{ "configKey": "sla.doctor.working_days",
  "value": 21,
  "verificationState": "CONFIRMED",
  "basis": "Minuted at the HOD meeting of 14 October 2026",
  "ownerToConfirm": "Clinical HODs" }
```

The change is audited with the acting user, and the previous version stays
readable.

## The settings, and what each one moves

### Deadlines

| Key | Default | What changing it does |
|---|---|---|
| `sla.service.working_days` | 28 | The general service allowance. Applies to applications registered after the change. |
| `calendar.include_start_day` | `false` | **Moves every future deadline by one working day.** Confirm with Records before production. |
| `sla.doctor.working_days` | 18 | The internal doctor allocation. Invented for the prototype. |
| `sla.review_buffer.working_days` | 3 | How much time Records keeps for final checking. The doctor deadline is pulled back so this always fits inside the service deadline. |
| `sla.service.by_report_type` | `{}` | Per-report-type exceptions, as `{"Detailed specialist report": 35}`. Empty means the general allowance applies to all. |

### KPI

| Key | Default | What changing it does |
|---|---|---|
| `kpi.completion_endpoint` | `accepted_completed_at` | Which timestamp counts as "completed". The others stay recorded for stage analysis, so changing this re-bases the KPI without losing anything. |
| `kpi.on_time_target_percent` | 85 | The reference line on the timeliness chart. |
| `analytics.min_sample_size` | 5 | Below this, a median is suppressed rather than published. |

### Money

| Key | Default | What changing it does |
|---|---|---|
| `fee.rule_version` amounts | RM 50 / 100 / 250 | The charge set at registration. Existing applications keep the rule they were registered under. |
| `fee.release_requires_settled` | `false` | **Turning this on gates report release on the patient fee.** It ships off because no policy permitting it was supplied. Nothing here ever consults a claim. |
| `claim.eligibility_rule_version` | `DEMO-ELIG-1` | Which completed reports create an eligible claim item. |
| `payment.evidence_required` | reference, amount, paid date, reconciliation | Documented for reference; the requirement is also a table constraint, so it cannot be weakened from configuration alone. |
| `sla.finance.working_days` | `null` | Deliberately unset. Finance turnaround is reported, not judged. Setting it would introduce a target nobody approved. |

### Notifications

| Key | Default | What changing it does |
|---|---|---|
| `notify.reminder_offsets` | `[7, 3, 1]` | Working days before a deadline at which a reminder is due. |
| `notify.escalation_chain` | HOD → Records supervisor → authorised manager | Who is told when a deadline passes. |
| `notify.provider` | `SIMULATION` | `APPROVED_GATEWAY` enables real sending. Requires a gateway. |

### Deployment and evidence

| Key | Default | What changing it does |
|---|---|---|
| `deploy.public_host` | `null` | The ICT-approved host for the portal. |
| `rag.collection_version` | `null` | Set once an approved, versioned policy collection exists. Until then the recommendation panel presents nothing as a policy requirement. |
| `integration.registration` / `integration.finance` | `MANUAL_IMPORT` | `APPROVED_INTERFACE` once a documented interface exists. Changes the label on every import and on the dashboard. |

## Loading the working-day calendar

Fixed-date Federal Territory holidays are seeded from
`data/calendar/holidays-fixed.csv`. Variable-date holidays — Chinese New Year,
Thaipusam, both Hari Raya, Awal Muharram, Maulidur Rasul, Nuzul Al-Quran, Wesak,
Deepavali, the Agong's birthday — and officially recognised replacement days are
**not generated**, because guessing them would move real applicants' deadlines by
whole working days.

Load them from the gazette through Administration → Business calendar:

```csv
calendar_date,day_kind,label
2027-02-06,PUBLIC_HOLIDAY,Chinese New Year
2027-02-08,REPLACEMENT_HOLIDAY,Replacement for Chinese New Year
2027-03-15,WORKING_OVERRIDE,Records Unit working Saturday
```

`day_kind` is `PUBLIC_HOLIDAY`, `REPLACEMENT_HOLIDAY` or `WORKING_OVERRIDE` (a
normally non-working date on which the unit works). The loader validates each row,
reports what it rejected, invalidates the deadline engine's cache and audits the
change.

## Adding a department, a doctor or a user

No configuration file: `departments`, `doctors` and `users` are ordinary tables,
managed through Administration → Users. A doctor account must carry a `doctor_id`
— a table constraint enforces that the link exists exactly when the role is
`doctor` — because every task and claim query is scoped through it.

## Changing a permission

Permissions are code, in `server/auth/permissions.ts`, not configuration. That is
deliberate: a permission change should go through review and be covered by the
test suite, which asserts the prohibitions `docs/03-permission-matrix.md` states as
absolute. Widening the model quietly fails the build.
