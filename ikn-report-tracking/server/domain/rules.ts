/**
 * Loads the versioned rule rows that govern deadlines, fees and claim eligibility.
 *
 * An application keeps the rule version it was registered under, so changing a
 * rule never moves a past result. That is why every lookup here is by explicit
 * version, and `activeSlaRule` is used only at registration time.
 */
import type { Handle } from '../db/database.ts';
import type { VerificationState } from '../../shared/domain.ts';

export interface SlaRule {
  slaRuleVersion: string;
  description: string;
  serviceWorkingDays: number;
  doctorWorkingDays: number;
  reviewBufferDays: number;
  byReportType: Readonly<Record<string, number>>;
  completionEndpoint: 'signed_submitted_at' | 'accepted_completed_at' | 'ready_at'
    | 'notified_at' | 'collection_or_delivery_at';
  onTimeTargetPercent: number;
  calendarVersion: string;
  effectiveFrom: string;
  verificationState: VerificationState;
}

export interface FeeRule {
  feeRuleVersion: string;
  description: string;
  amountsSen: Readonly<Record<string, number>>;
  releaseRequiresSettled: boolean;
  currency: string;
  effectiveFrom: string;
  verificationState: VerificationState;
}

export interface EligibilityRule {
  eligibilityRuleVersion: string;
  description: string;
  criteria: {
    /** Report types that create one eligible claim item when completed. */
    chargeableReportTypes: string[];
    /** Which timestamp must exist for eligibility to be reachable. */
    requiresEndpoint: 'accepted_completed_at';
  };
  effectiveFrom: string;
  verificationState: VerificationState;
}

export function slaRule(handle: Handle, version: string): SlaRule {
  const r = handle.get<Record<string, any>>(
    'SELECT * FROM sla_rules WHERE sla_rule_version = ?', version);
  if (!r) throw new Error(`unknown SLA rule version: ${version}`);
  return {
    slaRuleVersion: r.sla_rule_version,
    description: r.description,
    serviceWorkingDays: r.service_working_days,
    doctorWorkingDays: r.doctor_working_days,
    reviewBufferDays: r.review_buffer_days,
    byReportType: JSON.parse(r.by_report_type_json),
    completionEndpoint: r.completion_endpoint,
    onTimeTargetPercent: r.on_time_target_percent,
    calendarVersion: r.calendar_version,
    effectiveFrom: r.effective_from,
    verificationState: r.verification_state,
  };
}

export function activeSlaRule(handle: Handle, asOf: string): SlaRule {
  const r = handle.get<{ sla_rule_version: string }>(
    `SELECT sla_rule_version FROM sla_rules WHERE effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC LIMIT 1`, asOf);
  if (!r) throw new Error(`no SLA rule effective at ${asOf}`);
  return slaRule(handle, r.sla_rule_version);
}

export function feeRule(handle: Handle, version: string): FeeRule {
  const r = handle.get<Record<string, any>>(
    'SELECT * FROM fee_rules WHERE fee_rule_version = ?', version);
  if (!r) throw new Error(`unknown fee rule version: ${version}`);
  return {
    feeRuleVersion: r.fee_rule_version,
    description: r.description,
    amountsSen: JSON.parse(r.amounts_sen_json),
    releaseRequiresSettled: r.release_requires_settled === 1,
    currency: r.currency,
    effectiveFrom: r.effective_from,
    verificationState: r.verification_state,
  };
}

export function activeFeeRule(handle: Handle, asOf: string): FeeRule {
  const r = handle.get<{ fee_rule_version: string }>(
    `SELECT fee_rule_version FROM fee_rules WHERE effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC LIMIT 1`, asOf);
  if (!r) throw new Error(`no fee rule effective at ${asOf}`);
  return feeRule(handle, r.fee_rule_version);
}

export function eligibilityRule(handle: Handle, version: string): EligibilityRule {
  const r = handle.get<Record<string, any>>(
    'SELECT * FROM claim_eligibility_rules WHERE eligibility_rule_version = ?', version);
  if (!r) throw new Error(`unknown eligibility rule version: ${version}`);
  return {
    eligibilityRuleVersion: r.eligibility_rule_version,
    description: r.description,
    criteria: JSON.parse(r.criteria_json),
    effectiveFrom: r.effective_from,
    verificationState: r.verification_state,
  };
}

export function activeEligibilityRule(handle: Handle, asOf: string): EligibilityRule {
  const r = handle.get<{ eligibility_rule_version: string }>(
    `SELECT eligibility_rule_version FROM claim_eligibility_rules WHERE effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC LIMIT 1`, asOf);
  if (!r) throw new Error(`no claim eligibility rule effective at ${asOf}`);
  return eligibilityRule(handle, r.eligibility_rule_version);
}

/** Reads the current version of a configuration setting, with its verification state. */
export function configValue<T>(handle: Handle, key: string, fallback: T): {
  value: T; verificationState: VerificationState; version: number | null;
} {
  const r = handle.get<{ value_json: string; verification_state: VerificationState; version: number }>(
    `SELECT value_json, verification_state, version FROM config_settings
     WHERE config_key = ? AND superseded_at IS NULL ORDER BY version DESC LIMIT 1`, key);
  if (!r) return { value: fallback, verificationState: 'UNVERIFIED', version: null };
  return { value: JSON.parse(r.value_json) as T, verificationState: r.verification_state, version: r.version };
}
