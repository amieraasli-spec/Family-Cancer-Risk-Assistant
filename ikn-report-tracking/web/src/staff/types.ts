/** Shapes the API returns, mirrored for the client. */

export interface Captions {
  howToRead: string;
  whatThisShows: string;
  dataClassNotice?: string;
}

export interface FilterEcho {
  periodLabel: string; departmentLabel: string; reportTypeLabel: string; dataAsOf: string;
  calendarVersion: string; slaRuleVersion: string; formulaVersion: string; dataClass: string;
}

export interface Panel<T> {
  key: string; title: string; unitOfAnalysis: string; data: T;
  captions: Captions; filter: FilterEcho;
}

export interface CountMetric { kind: 'count'; key: string; label: string; unit: string; value: number }

export type RateMetric =
  | { kind: 'rate'; key: string; label: string; applicable: true; numerator: number;
    denominator: number; percent: number; partialPeriodNotice?: string }
  | { kind: 'rate'; key: string; label: string; applicable: false; numerator: 0;
    denominator: 0; message: string };

export type DistributionMetric =
  | { kind: 'distribution'; key: string; label: string; unit: string; applicable: true;
    median: number; p90: number; sampleSize: number }
  | { kind: 'distribution'; key: string; label: string; unit: string; applicable: false;
    sampleSize: 0; message: string };

export interface MoneyMetric {
  kind: 'money'; key: string; label: string; valueSen: number;
  inconsistencies: { claimItemId: string; note: string }[];
}

export interface OverviewResponse {
  cards: Panel<{
    page1: { received: CountMetric; completed: CountMetric; openBacklog: CountMetric;
      overdueOpen: CountMetric };
    page2: { dueCohortOnTime: RateMetric; turnaround: DistributionMetric;
      eligibleUnclaimed: CountMetric; approvedUnpaid: MoneyMetric };
    captions: Record<string, Captions>;
  }>;
  queueHealth: Panel<{
    ratio: RateMetric; overdueAgainstRevised: CountMetric; incomplete: CountMetric;
    unassignedComplete: CountMetric; unacknowledged: CountMetric;
    integrationFreshness: IntegrationFreshness;
  }>;
}

export interface IntegrationFreshness {
  registration: { mode: string; connected: boolean; notice: string };
  finance: { mode: string; connected: boolean; notice: string };
  messaging: { mode: string; connected: boolean; notice: string; failedCount: number };
  recentImports: { target_entity: string; imported_at: string; integration_mode: string;
    accepted_count: number; rejected_count: number; conflict_count: number }[];
}

export interface WorklistRow {
  applicationId: string; departmentId: string; reportType: string; stage: string;
  currentOwner: string; workingDaysRemaining: number | null; workingDaysOverdue: number;
  originalDueDate: string | null; revisedDueDate: string | null;
  delayReasonCode: string | null; nextAction: string;
}

export interface DataQualityException {
  code: string; label: string; count: number; examples: string[];
}

export interface ReportsResponse {
  worklist: Panel<{ rows: WorklistRow[]; page: number; pageSize: number; totalRows: number;
    overdueInCohort: number }>;
  queueComposition: Panel<{ slices: { key: string; label: string; count: number; percent: number }[];
    total: number }>;
  exceptions: Panel<DataQualityException[]>;
}

export interface DepartmentRow {
  departmentId: string; departmentName: string; overdueOpen: number; open: number;
  onTime: RateMetric;
}

export interface DepartmentsResponse {
  overdue: Panel<DepartmentRow[]>;
  onTime: Panel<DepartmentRow[]>;
  doctorCompliance: Panel<RateMetric>;
}

export interface AgeingRow {
  bucket: string; count: number; amountSen: number; amountRm: string; examples: string[];
  actionOwner: string;
}

export interface FinanceResponse {
  pipeline: Panel<{ status: string; count: number }[]>;
  approvedUnpaidByDepartment: Panel<{ departmentId: string; departmentName: string;
    amountSen: number; amountRm: string }[]>;
  submissionCoverage: Panel<RateMetric>;
  financeTurnaround: Panel<DistributionMetric>;
  ageingUnclaimed: Panel<{ rows: AgeingRow[]; page: number; pageSize: number; totalRows: number }>;
  ageingWithFinance: Panel<{ rows: AgeingRow[]; page: number; pageSize: number; totalRows: number }>;
  ageingApprovedUnpaid: Panel<{ rows: AgeingRow[]; page: number; pageSize: number; totalRows: number }>;
}

export interface MetricDefinition {
  key: string; label: string; unit: string; definition: string;
  numerator?: string; denominator?: string; inclusions: string[]; exclusions: string[];
  authority: string; notes?: string;
}

export interface HeatmapCell {
  departmentId: string; departmentName: string; month: string;
  percent: number | null; numerator: number; denominator: number;
}

export interface ScatterPoint {
  departmentId: string; departmentName: string; month: string; assignedInMonth: number;
  medianDoctorTurnaround: number | null; completedTasks: number; suppressed: boolean;
}

export interface InsightsResponse {
  kpis: Panel<{
    dictionary: MetricDefinition[];
    formulaVersion: string;
    values: Record<string, CountMetric | RateMetric | DistributionMetric |
      { rate: RateMetric; enquiryCount: CountMetric }>;
    excludedCases: { code: string; reason: string; count: number }[];
    onTimeTargetPercent: number;
    targetProvenance: string;
  }>;
  trend: Panel<{ month: string; received: number; completed: number }[]>;
  timeliness: Panel<{ series: { month: string; rate: RateMetric }[]; targetPercent: number }>;
  turnaround: Panel<{ bins: { key: string; label: string; count: number }[]; total: number }>;
  openAgeing: Panel<{ bins: { key: string; label: string; count: number }[]; total: number }>;
  workload: Panel<{ points: ScatterPoint[]; minSampleSize: number }>;
  heatmap: Panel<{ cells: HeatmapCell[]; months: string[] }>;
}

export interface ForecastPoint {
  month: string; horizon: number; rawPoint: number; point: number;
  lower80: number; upper80: number; lower95: number; upper95: number; flooredAtZero: boolean;
}

export type ForecastData =
  | {
    forecast: {
      available: true; history: { month: string; received: number }[];
      trainingFrom: string; trainingTo: string; forecastGeneratedAt: string;
      horizonMonths: number; selectedModel: string; modelSelectionReason: string;
      etsParameters: { alpha: number; beta: number; phi: number } | null;
      validation: {
        ets: { model: string; mae: number; wape: number | null;
          origins: { month: string; actual: number; predicted: number }[] };
        baseline: { model: string; mae: number; wape: number | null;
          origins: { month: string; actual: number; predicted: number }[] };
      };
      points: ForecastPoint[];
      boundaryHandling: string; seasonalityNotice: string;
    };
    scenario: {
      kind: 'SCENARIO'; startingBacklog: number;
      months: { month: string; arrivals: number; assumedCompletions: number;
        assumedCancellations: number; projectedBacklog: number }[];
      assumptions: string[]; disclaimer: string;
    };
  }
  | {
    available: false; reason: string; message: string; completeMonths: number;
    requiredMonths: number; history: { month: string; received: number }[];
  };

export interface Recommendation {
  key: string; observedIndicator: string; recommendedAction: string; actionOwner: string;
  reviewDate: string; evidenceKind: 'POLICY_REQUIREMENT' | 'MANAGEMENT_SUGGESTION';
  policyCitation: {
    documentTitle: string; documentVersion: string; effectiveDate: string | null;
    clauseOrPage: string; internalLink: string | null; quotedPassage: string;
  } | null;
  policyGap: { message: string; routeTo: string } | null;
  examples: string[]; severity: 'HIGH' | 'MEDIUM' | 'LOW'; requiresHumanAcceptance: true;
}

export interface ActionsData {
  generatedAt: string; ragCollectionVersion: string | null; ragStatus: string;
  ragNotice: string; recommendations: Recommendation[]; rulesEvaluatedWithNoFinding: string[];
}

export interface ReferenceData {
  departments: { department_id: string; name: string }[];
  reportTypes: string[];
  metricDictionary: MetricDefinition[];
  assumptions: { config_key: string; value_json: string; verification_state: string;
    basis: string | null; owner_to_confirm: string | null }[];
  slaRule: {
    slaRuleVersion: string; serviceWorkingDays: number; doctorWorkingDays: number;
    reviewBufferDays: number; completionEndpoint: string; onTimeTargetPercent: number;
    calendarVersion: string; verificationState: string; description: string;
  };
  feeRule: { feeRuleVersion: string; releaseRequiresSettled: boolean; verificationState: string;
    description: string };
  minSampleSize: number;
}

export interface DoctorTask {
  task_id: string; application_id: string; report_type: string; department_id: string;
  assigned_at: string; acknowledged_at: string | null; original_doctor_due_at: string;
  current_doctor_due_at: string; signed_submitted_at: string | null;
  accepted_completed_at: string | null; returned_at: string | null; return_count: number;
  delay_reason_code: string | null; internal_status: string;
  original_service_due_at: string | null;
}

export interface DoctorClaimItem {
  claim_item_id: string; application_id: string; eligibility_status: string;
  eligible_at: string | null; status: string; claimed_amount_sen: number;
  approved_amount_sen: number | null; submitted_at: string | null; approved_at: string | null;
  return_reason: string | null; claimedAmountRm: string; approvedAmountRm: string | null;
  netPaidRm: string; paymentDisplay: string;
}
