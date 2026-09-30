/**
 * Metric result shapes shared by the API and the dashboard.
 *
 * Two rules are encoded in the types rather than left to discipline:
 *   - a rate carries its numerator and denominator, so no percentage can be
 *     rendered without its parts;
 *   - a rate with a zero denominator is `applicable: false` and has **no value**,
 *     so it cannot be printed as 0% or 100%.
 */
import type { Captions } from './domain.ts';

export interface CountMetric {
  kind: 'count';
  key: string;
  label: string;
  unit: 'applications' | 'doctor_tasks' | 'claim_items' | 'enquiries' | 'working_days' | 'RM';
  value: number;
}

export type RateMetric =
  | {
    kind: 'rate'; key: string; label: string; applicable: true;
    numerator: number; denominator: number; percent: number;
    /** Set when the month is not finished, so the figure is month-to-date. */
    partialPeriodNotice?: string;
  }
  | {
    kind: 'rate'; key: string; label: string; applicable: false;
    numerator: 0; denominator: 0; message: string;
  };

export type DistributionMetric =
  | {
    kind: 'distribution'; key: string; label: string; unit: string; applicable: true;
    median: number; p90: number; sampleSize: number;
  }
  | {
    kind: 'distribution'; key: string; label: string; unit: string; applicable: false;
    sampleSize: 0; message: string;
  };

export interface MoneyMetric {
  kind: 'money';
  key: string;
  label: string;
  /** Integer sen. Formatted for display by the client. */
  valueSen: number;
  /** Negative components are surfaced rather than clamped away. */
  inconsistencies: { claimItemId: string; note: string }[];
}

export type Metric = CountMetric | RateMetric | DistributionMetric | MoneyMetric;

export interface DataQualityException {
  code: string;
  label: string;
  count: number;
  /** Up to a handful of examples, so staff can go and fix them. */
  examples: string[];
}

export interface ExcludedCases {
  code: string;
  reason: string;
  count: number;
}

export interface Panel<T> {
  key: string;
  title: string;
  unitOfAnalysis: string;
  data: T;
  captions: Captions;
  /** Echo of the filter that produced this panel, so a screenshot is self-describing. */
  filter: FilterEcho;
}

export interface FilterEcho {
  periodLabel: string;
  departmentLabel: string;
  reportTypeLabel: string;
  dataAsOf: string;
  calendarVersion: string;
  slaRuleVersion: string;
  formulaVersion: string;
  dataClass: string;
}
