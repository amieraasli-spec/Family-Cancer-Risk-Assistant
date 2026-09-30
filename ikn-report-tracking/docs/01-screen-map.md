# Screen map — IKN Medical Report Tracking & Performance System

Patient-facing title: **Semakan Status Laporan Perubatan**.

Every screen below is designed to fit a 10-inch tablet in portrait at the
reference viewport **768 × 1024 CSS pixels**, with roughly 120 px of that
height assumed lost to browser chrome (so ~904 px of usable height). The rule
the layout obeys everywhere: *one primary chart or one compact paginated table
per screen, at most four KPI cards, at most five table rows by default, caption
space always reserved.* When the user raises text size or the viewport shrinks,
the page **reduces cards and rows and adds steps** — it never clips, never
forces a tiny font and never disables zoom.

---

## A. Public / patient surface

Mounted separately from the staff app (different bundle, different API origin
path, no shared session). Bahasa Melayu is the default; English is a toggle.

| # | Screen | Purpose | Contents | Exit |
|---|---|---|---|---|
| P0 | `/` Semakan status — entry | Single field, nothing else | Language toggle, tracking-code field, help text, Records Unit contact, "Demonstration data" banner in prototype builds | P1 or P2 |
| P1 | Verification step (conditional) | Step-up only when the applicant used a predictable internal report number, or asks for missing-document detail | Masked destination of the one-time code, code field, resend with cool-down, staff-assisted route | P2 |
| P2 | Status result | The only screen that shows case data | Public reference, current public stage, date received, original target date, last update, next action, collection/delivery instructions, verified contact | P3 or exit |
| P3 | Next-action detail (conditional, verified only) | What document is outstanding | Itemised outstanding requirements, how to submit, counter hours | back to P2 |
| P4 | Code problem | Recovery without enumeration | Uniform "we cannot show a status for that code" message, staff-assisted route, no hint about whether the code exists | P0 |

Patient flow length target: **enter code → (verify only if required) → status**.
No account creation. No staff dashboard component is reachable from this bundle.

---

## B. Staff surface

Five main tabs. Administration is a **separate permitted menu**, not a sixth tab.
Each tab is a list of short subpages with Previous / Next navigation, so no page
relies on scrolling to hide length.

### Overview
| Subpage | Contents |
|---|---|
| Overview → Today | 4 big-number cards: received (period), completed (period), open at cutoff, overdue open |
| Overview → Money & claims | 4 big-number cards: due-cohort on-time %, median turnaround (working days), eligible unclaimed items, approved unpaid RM |
| Overview → Queue health | Ratio card: overdue open / all open at the same cutoff, with both counts, plus data-as-of and integration-freshness strip |

### Reports
| Subpage | Contents |
|---|---|
| Reports → Queue | Paginated 5-row worklist: reference, stage, owner, working days remaining/overdue, next action |
| Reports → Queue composition | Donut of open applications by mutually exclusive current stage (≤5 slices, remainder grouped) |
| Reports → Exceptions | Unassigned complete applications, unacknowledged assignments, missing completeness dates |
| Reports → Case detail | Stepped case view: 1 identity & purpose → 2 dates & deadlines → 3 doctor task → 4 fee → 5 release → 6 history |
| Reports → Register | Stepped registration wizard: 1 applicant & authority → 2 report request → 3 completeness → 4 fee or exemption → 5 confirm |

### Doctors
| Subpage | Contents |
|---|---|
| Doctors → My work *(doctor role)* | Assigned tasks, acknowledge, progress, submit completion |
| Doctors → My claims *(doctor role)* | Own eligible items, submit claim, own payment status |
| Doctors → Department workload *(HOD, director, records)* | Bar: department vs overdue count |
| Doctors → Department on-time | Bar: on-time % with numerator/denominator printed |
| Doctors → Reassignment | HOD-authorised reassignment within their department, with reason |

### Finance
| Subpage | Contents |
|---|---|
| Finance → Claim pipeline | Bar: claim items by claim stage |
| Finance → Approved unpaid | Bar: RM approved-but-unpaid by department |
| Finance → Ageing: unclaimed | 5-row paginated table, days since `eligible_at` |
| Finance → Ageing: with finance | 5-row paginated table, days since `finance_received_at` |
| Finance → Ageing: approved unpaid | 5-row paginated table, days since `approved_at` |
| Finance → Reconcile | Stepped payment reconciliation: 1 select item → 2 evidence → 3 amount & date → 4 confirm |

### Insights
| Subpage | Contents |
|---|---|
| Insights → KPIs | Metric dictionary entries with value, definition, denominator, exclusions |
| Insights → Trends | Line: monthly received vs completed (same count axis); separate page for on-time % vs target |
| Insights → Turnaround | Histogram: completed turnaround bins 0–7/8–14/15–21/22–28/>28; separate open-report ageing |
| Insights → Workload | Scatter: one point per department-month |
| Insights → Heatmap | Department × month late-or-unfinished rate, 0–100% legend |
| Insights → Forecast | ETS(A,Ad,N) monthly application forecast with intervals and validation error |
| Insights → Actions | Recommendation panel |

### Administration (separate menu, `system_admin` only)
Users & roles · Business calendar versions · SLA rule versions · Fee rule versions ·
Claim eligibility rule versions · Policy document registry · Notification adapter &
simulation mode · Import & reconciliation · Monthly snapshot versions · Technical log.

`system_admin` has **no** entitlement to patient content, clinical approval or
payment approval; those routes reject the role server-side even though the admin
menu is visible to it.

---

## C. Navigation rules

- Tab bar is fixed; subpage strip is a compact segmented control plus
  Previous/Next buttons at the foot of the content area.
- Long notes and attachments open in a **separate paginated viewer**, never inline.
- Registration, claim forms, case detail and reconciliation are **stepped**, never
  one long form.
- Every analytical panel carries its two mandatory captions in reserved space
  directly beneath it, and they survive export.
