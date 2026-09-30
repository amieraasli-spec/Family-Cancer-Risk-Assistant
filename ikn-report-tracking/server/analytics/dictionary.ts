/**
 * The metric dictionary.
 *
 * Every figure the dashboard prints has an entry here with its exact definition,
 * its inclusion and exclusion rules, and the formula version that produced it.
 * The dashboard renders these entries directly on Insights → KPIs, so the
 * definition a manager reads is the definition the code used.
 *
 * `authority` is the honest label. Nothing is `OFFICIAL_KKM` and nothing is
 * `APPROVED_IKN`, because no approved specification was supplied; every entry is a
 * locally designed management metric until IKN's KPI owner confirms otherwise.
 */

export const FORMULA_VERSION = 'IKN-PROTO-FORMULA-v1';

export type MetricAuthority = 'LOCAL_MANAGEMENT_METRIC' | 'APPROVED_IKN' | 'OFFICIAL_KKM';

export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  definition: string;
  numerator?: string;
  denominator?: string;
  inclusions: string[];
  exclusions: string[];
  authority: MetricAuthority;
  notes?: string;
}

export const METRIC_DICTIONARY: readonly MetricDefinition[] = [
  {
    key: 'received',
    label: 'Received',
    unit: 'applications',
    definition: 'Distinct applications whose received_at falls within the selected month, '
      + 'in Asia/Kuala_Lumpur.',
    inclusions: ['Every application, complete or not', 'Applications later cancelled'],
    exclusions: ['Applications received after the data-as-of cutoff'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
  },
  {
    key: 'completed',
    label: 'Completed',
    unit: 'applications',
    definition: 'Distinct applications whose configured completion endpoint falls within the '
      + 'selected month. The prototype endpoint is completion accepted by Records '
      + '(accepted_completed_at).',
    inclusions: ['Reports whose completion Records has verified'],
    exclusions: ['Signed submissions not yet accepted by Records',
      'Collection, which is measured separately'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Completion is not collection. The two are reported apart on purpose.',
  },
  {
    key: 'open_backlog',
    label: 'Open backlog',
    unit: 'applications',
    definition: 'Applications received by the cutoff that have reached neither the configured '
      + 'completion endpoint nor an authorised cancellation by that cutoff.',
    inclusions: ['Incomplete applications still awaiting documents'],
    exclusions: ['Cancelled applications', 'Completed applications'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
  },
  {
    key: 'overdue_open',
    label: 'Overdue open',
    unit: 'applications',
    definition: 'Open applications whose ORIGINAL service deadline had passed at the cutoff.',
    inclusions: ['Open applications with an original deadline in the past'],
    exclusions: ['Applications with no deadline yet, because completeness is not recorded',
      'Cancelled applications'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Performance against an approved revised deadline is reported separately, never '
      + 'blended into this figure.',
  },
  {
    key: 'due_cohort_on_time_rate',
    label: 'Due-cohort on-time rate',
    unit: 'percent',
    definition: 'Of the applications whose ORIGINAL service deadline falls in the selected '
      + 'month, the share verified complete on or before that deadline.',
    numerator: 'Eligible applications with an original due date in the month and a verified '
      + 'completion on or before that deadline.',
    denominator: 'All eligible applications with an original due date in the month, '
      + 'INCLUDING those still unfinished.',
    inclusions: ['Unfinished applications whose deadline has passed — they count as late'],
    exclusions: ['Cancelled applications', 'Applications with no recorded deadline'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Before the month ends, only deadlines that have already elapsed are counted and '
      + 'the figure is labelled month-to-date. An unknown completion date is never on time.',
  },
  {
    key: 'completed_cohort_on_time_rate',
    label: 'Completed-cohort on-time rate (supplementary)',
    unit: 'percent',
    definition: 'Of the reports completed in the month, the share completed on or before '
      + 'their original due date.',
    numerator: 'Reports completed in the month on or before their original due date.',
    denominator: 'All eligible reports completed in that month.',
    inclusions: ['Only reports that were completed'],
    exclusions: ['Unfinished late reports — which is why this view is supplementary'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Labelled supplementary because unfinished cases are absent from the denominator, '
      + 'so it reads better than the due-cohort rate whenever work is running late.',
  },
  {
    key: 'turnaround',
    label: 'Turnaround',
    unit: 'working days',
    definition: 'Working days from application_complete_at to the configured completion '
      + 'endpoint, using the same calendar and the same day-count convention as the '
      + 'deadline engine.',
    inclusions: ['Completed reports with both dates recorded'],
    exclusions: ['Open reports, whose ageing is reported separately',
      'Reports missing either date, reported as a data-quality exception'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Reported as median, P90 and sample size. A mean is deliberately not published: '
      + 'the distribution has a long right tail.',
  },
  {
    key: 'doctor_deadline_compliance',
    label: 'Doctor deadline compliance',
    unit: 'percent',
    definition: 'Of the doctor tasks whose ORIGINAL doctor deadline falls in the month, the '
      + 'share completed and accepted on or before that deadline.',
    numerator: 'Eligible tasks due in the month, accepted complete on or before the original '
      + 'doctor deadline.',
    denominator: 'All eligible tasks with an original doctor deadline in that month, '
      + 'including unfinished overdue tasks.',
    inclusions: ['Unfinished tasks whose deadline has passed'],
    exclusions: ['Tasks on cancelled applications'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'The doctor allowance this is measured against is a prototype value (assumption '
      + '#4), not an IKN rule. Reassignment history and stage attribution are shown '
      + 'alongside, so a delay caused elsewhere is not read as the doctor’s.',
  },
  {
    key: 'claim_submission_coverage',
    label: 'Claim submission coverage',
    unit: 'percent',
    definition: 'Of the claim items that became eligible in the month, the share with a '
      + 'submitted claim by the cutoff.',
    numerator: 'Eligible items in the cohort with submitted_at set by the cutoff.',
    denominator: 'All items that became eligible in that month.',
    inclusions: ['Items returned and resubmitted — counted as submitted'],
    exclusions: ['Items assessed not eligible'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'The unsubmitted count and its ageing are shown next to the rate, because the '
      + 'rate alone does not say how old the gap is.',
  },
  {
    key: 'approved_unpaid_amount',
    label: 'Approved unpaid amount',
    unit: 'RM',
    definition: 'At the cutoff, the sum of approved item amounts less reconciled net payments, '
      + 'accounting for reversals.',
    inclusions: ['Approved items with no settlement evidence',
      'Partially paid items, for the unsettled remainder',
      'Reversed payments, which restore the outstanding balance'],
    exclusions: ['Items never approved', 'Rejected and withdrawn items'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'A negative balance is displayed as an inconsistency to investigate, not clamped '
      + 'to zero.',
  },
  {
    key: 'finance_turnaround',
    label: 'Finance turnaround',
    unit: 'working days',
    definition: 'Working days from the complete claim being received by Finance to reconciled '
      + 'settlement, for settled items.',
    inclusions: ['Items with both finance_received_at and reconciled settlement'],
    exclusions: ['Outstanding items, whose ageing is shown separately'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'Reported without a target: no finance processing allowance was supplied, and '
      + 'inventing one would create a judgement nobody approved.',
  },
  {
    key: 'follow_up_burden',
    label: 'Follow-up burden',
    unit: 'enquiries per 100 applications received',
    definition: 'Logged status enquiries — telephone calls and counter visits — per 100 '
      + 'applications received in the month.',
    numerator: 'Logged status enquiries in the month.',
    denominator: 'Applications received in the month, divided by 100.',
    inclusions: ['Enquiries staff have logged'],
    exclusions: ['Unlogged contacts, which this cannot see'],
    authority: 'LOCAL_MANAGEMENT_METRIC',
    notes: 'A contact-volume indicator, not a patient-level probability. Raw counts are shown '
      + 'alongside. No improvement may be claimed without a measured comparable baseline, '
      + 'and this prototype has none.',
  },
];

export function definitionFor(key: string): MetricDefinition | undefined {
  return METRIC_DICTIONARY.find((d) => d.key === key);
}
