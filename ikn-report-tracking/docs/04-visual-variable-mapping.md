# Visual-variable mapping

Every panel inherits the shared filter bar: **period / cohort, department, report
type, and a visible `data as of` timestamp**. The *unit of analysis* is printed
on every panel — applications, doctor tasks, claim items, or RM — because these
are not interchangeable.

Both mandatory captions are generated from the same validated aggregate that
drew the mark. Captions are recomputed whenever a filter changes and are
included in exports.

| Visual | Unit | X / rows | Y / columns | Encoding | Calculation | Location |
|---|---|---|---|---|---|---|
| Big-number cards (page 1) | applications | — | — | value + period label | received, completed, open at cutoff, overdue open | Overview → Today |
| Big-number cards (page 2) | mixed (labelled per card) | — | — | value + unit | due-cohort on-time %, median + P90 turnaround (working days), eligible unclaimed items, approved unpaid RM | Overview → Money & claims |
| Ratio card | applications | — | — | numerator / denominator + percent | overdue open ÷ all open, **same cutoff** | Overview → Queue health |
| Donut | applications | — | — | angle = count, label = count + % | open applications by mutually exclusive current stage; ≤5 slices, smaller stages grouped as "Other stages (n)" | Reports → Queue composition |
| Line (throughput) | applications | month | count | two lines on one shared count axis | monthly received, monthly completed | Insights → Trends |
| Line (timeliness) | applications | month | percent | line + target reference line | due-cohort on-time %, configured target | Insights → Trends (page 2) |
| Bar (overdue) | applications | department | count | bar length | overdue open count per department at cutoff | Doctors → Department workload |
| Bar (on-time) | applications | department | percent | bar length + printed n/N | on-time % per department | Doctors → Department on-time |
| Histogram (completed) | applications | turnaround bin: 0–7, 8–14, 15–21, 22–28, >28 working days | count | bar height | completed reports in period | Insights → Turnaround |
| Histogram (open ageing) | applications | age bin, same edges | count | bar height | open applications at cutoff | Insights → Turnaround (page 2) |
| Scatter | department-month | applications **assigned** during month | median doctor-task turnaround for tasks **completed** that month | point size = completed task count | medians suppressed below the configured minimum sample size | Insights → Workload |
| Heatmap | applications | month (columns) | department (rows) | 0–100% sequential: pale = lower late-or-unfinished rate, dark = higher; **grey = unavailable / not applicable, not zero** | late-or-unfinished among that month's due cohort ÷ all eligible reports due that month × 100 | Insights → Heatmap |
| Claims bar | claim items | claim stage | count | bar length | claim items by stage at cutoff | Finance → Claim pipeline |
| Claims bar (money) | RM | department | RM | bar length | approved amount less reconciled net payments | Finance → Approved unpaid |
| Ageing table ×3 | claim items | ageing bucket rows | count + RM | compact paginated table, 5 rows | days since `eligible_at` / `finance_received_at` / `approved_at` | Finance → Ageing |
| Forecast | applications | month | count | observed line, forecast line, 80% and 95% bands | ETS(A,Ad,N) or trailing-3-month-mean baseline, whichever backtests better | Insights → Forecast |
| Recommendation panel | mixed | — | — | card list | verified indicator + policy citation or labelled management suggestion | Insights → Actions |

## Deliberate choices, and what they are not

**Heatmap, not a map.** A department-by-month heatmap answers "where are deadline
problems persistent?". A Malaysia choropleth would answer a question nobody at
the Records Unit asked, and would require collecting applicant addresses for no
operational purpose. No address field exists in the schema.

**Scatter is for capacity investigation, not ranking.** The x cohort
(applications assigned during the month) and the y cohort (tasks completed
during the month) are **different sets of records**; the panel says so, and adds
that association does not establish causation. Medians for groups below the
configured minimum sample size (`min_sample_size`, default 5) are suppressed and
shown as "n too small". It is never rendered as a league table, and it produces
no doctor-level score.

**Money is measured on claim items, never on applications.** One application may
carry several eligible items; aggregating at application level would double- or
under-count. The unit label on each financial panel states this.

**Ratios print their parts.** Every percentage in the system is rendered with its
numerator and denominator available — printed on bars, on selection for heatmap
cells, and in the caption. A zero denominator renders
"Not applicable — no eligible cases", never 0% and never 100%.

## Colour and accessibility

- One sequential ramp for the heatmap with a printed 0–100% legend; grey is a
  reserved, separately-labelled "no data" swatch.
- Two-series line charts distinguish series by colour **and** by marker shape and
  direct labels, so colour is never the only channel.
- Stage colours in the donut are paired with text labels and percentages.
- All charts are SVG with `role="img"`, an accessible name, and a
  `<table>`-equivalent data summary reachable from the panel for screen readers.
