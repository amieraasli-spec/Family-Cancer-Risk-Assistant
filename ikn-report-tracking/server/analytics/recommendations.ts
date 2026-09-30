/**
 * The recommendation panel.
 *
 * Two layers, and only the first one is active in this prototype:
 *
 *  - **Deterministic rules.** Each rule reads verified operational indicators and,
 *    when a threshold is crossed, produces a recommendation with the indicator that
 *    triggered it, the action, the owner and a review date. These are labelled
 *    MANAGEMENT_SUGGESTION: they are inferred from data, not quoted from policy.
 *
 *  - **Retrieval over approved policy documents.** Implemented as an interface with
 *    a real access filter, and it currently returns nothing, because no approved,
 *    versioned document collection was supplied. When retrieval finds no approved,
 *    current passage, the panel says "No verified policy source available" and
 *    routes to the document owner. It never fabricates a citation, and it never
 *    upgrades a suggestion to a requirement without a passage behind it.
 *
 * Retrieved text is treated as **evidence, never as instructions**: passages are
 * rendered as quoted citations and are not interpreted as commands.
 *
 * Nothing here can act. A recommendation cannot alter a deadline, approve a claim,
 * move money, issue a clinical report or send a message; it waits for a human to
 * accept, decline or defer it, and that decision is recorded.
 */
import type { Handle } from '../db/database.ts';
import { formatRinggit } from '../domain/money.ts';
import { addDays, toBusinessDate, type BusinessDate, type Instant } from '../domain/time.ts';
import type { Cohort } from './cohort.ts';
import type { ClaimAggregates } from './metrics.ts';
import type { DataQualityException } from '../../shared/metrics.ts';

export type EvidenceKind = 'POLICY_REQUIREMENT' | 'MANAGEMENT_SUGGESTION';

export interface PolicyCitation {
  documentTitle: string;
  documentVersion: string;
  effectiveDate: string | null;
  clauseOrPage: string;
  /** Internal link staff can follow. Null when the document is not in the collection. */
  internalLink: string | null;
  /** The passage, quoted. Treated as evidence, not as an instruction. */
  quotedPassage: string;
}

export interface Recommendation {
  key: string;
  /** What was observed, with its numbers. */
  observedIndicator: string;
  recommendedAction: string;
  actionOwner: string;
  reviewDate: BusinessDate;
  evidenceKind: EvidenceKind;
  /** Present only when an approved, current policy passage was retrieved. */
  policyCitation: PolicyCitation | null;
  /** The honest replacement for a citation when none exists. */
  policyGap: {
    message: string;
    routeTo: string;
  } | null;
  /** Cases the recommendation points at, so staff can act rather than search. */
  examples: string[];
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  requiresHumanAcceptance: true;
}

export interface RecommendationPanel {
  generatedAt: Instant;
  ragCollectionVersion: string | null;
  ragStatus: 'NO_APPROVED_COLLECTION' | 'ACTIVE';
  ragNotice: string;
  recommendations: Recommendation[];
  /** Rules that were evaluated and found nothing to report. */
  rulesEvaluatedWithNoFinding: string[];
}

/**
 * Retrieval over the approved policy collection, scoped to what the requesting
 * staff member may read.
 *
 * The clearance filter is applied in SQL rather than after the fact, so a document
 * above the caller's clearance is never loaded, let alone quoted. Aggregate,
 * de-identified operational figures are the only inputs; no patient or claim
 * document is sent anywhere.
 */
export function retrievePolicySupport(
  handle: Handle, topic: string, clearance: string,
): PolicyCitation | null {
  const row = handle.get<{
    title: string; document_version: string; effective_date: string | null;
    internal_link: string | null; clause_or_page: string; passage_text: string;
  }>(
    `SELECT d.title, d.document_version, d.effective_date, d.internal_link,
            p.clause_or_page, p.passage_text
     FROM policy_passages p JOIN policy_documents d ON d.document_id = p.document_id
     WHERE d.approval_state = 'APPROVED'
       AND d.superseded_by IS NULL
       AND d.collection_version <> 'NONE'
       AND (d.required_clearance = 'STANDARD' OR d.required_clearance = ?)
       AND p.passage_text LIKE ?
     ORDER BY d.effective_date DESC LIMIT 1`,
    clearance, `%${topic}%`);
  if (!row) return null;
  return {
    documentTitle: row.title,
    documentVersion: row.document_version,
    effectiveDate: row.effective_date,
    clauseOrPage: row.clause_or_page,
    internalLink: row.internal_link,
    quotedPassage: row.passage_text,
  };
}

const NO_POLICY_MESSAGE = 'No verified policy source available.';

interface RuleContext {
  handle: Handle;
  cohort: Cohort;
  claims: ClaimAggregates;
  exceptions: readonly DataQualityException[];
  clearance: string;
  asOf: Instant;
}

interface Rule {
  key: string;
  label: string;
  topic: string;
  evaluate: (ctx: RuleContext) => Omit<Recommendation,
    'key' | 'evidenceKind' | 'policyCitation' | 'policyGap' | 'requiresHumanAcceptance'> | null;
}

const RULES: readonly Rule[] = [
  {
    key: 'PRIORITISE_OLD_UNASSIGNED',
    label: 'Prioritise old unassigned work',
    topic: 'assignment',
    evaluate: ({ cohort, asOf }) => {
      const stale = cohort.applications
        .filter((a) => a.isOpen && a.completeAt !== null && a.taskId === null)
        .sort((a, b) => (a.completeAt! < b.completeAt! ? -1 : 1));
      if (stale.length === 0) return null;
      const oldest = stale[0]!;
      const oldestAge = oldest.ageingWorkingDays ?? 0;
      return {
        observedIndicator: `${stale.length} complete application`
          + `${stale.length === 1 ? '' : 's'} had no doctor assigned at the `
          + `${cohort.cutoffDate} cutoff; the oldest has been waiting ${oldestAge} working `
          + `day${oldestAge === 1 ? '' : 's'} since completeness.`,
        recommendedAction: 'Assign the unassigned complete applications, oldest first, before '
          + 'taking any newly completed application.',
        actionOwner: 'Records officer, with the head of department for capacity',
        reviewDate: nextReview(asOf, 3),
        examples: stale.slice(0, 5).map((a) => a.applicationId),
        severity: oldestAge > 10 ? 'HIGH' : 'MEDIUM',
      };
    },
  },
  {
    key: 'REPEATED_SIGNATURE_DELAYS',
    label: 'Review repeated signature delays',
    topic: 'signature',
    evaluate: ({ cohort, asOf }) => {
      const waiting = cohort.applications.filter(
        (a) => a.delayReasonCode === 'AWAITING_SIGNATURE');
      if (waiting.length < 3) return null;
      const byDepartment = new Map<string, number>();
      for (const a of waiting) {
        byDepartment.set(a.departmentId, (byDepartment.get(a.departmentId) ?? 0) + 1);
      }
      const worst = [...byDepartment.entries()].sort((x, y) => y[1] - x[1])[0]!;
      return {
        observedIndicator: `${waiting.length} applications carry a delay reason of awaiting `
          + `signature, concentrated in one department with ${worst[1]} of them.`,
        recommendedAction: 'Review the signing arrangements with the affected department, '
          + 'including cover during leave, and record the delay against the stage that '
          + 'caused it rather than against the individual doctor.',
        actionOwner: 'Head of department, with the Records supervisor',
        reviewDate: nextReview(asOf, 10),
        examples: waiting.slice(0, 5).map((a) => a.applicationId),
        severity: 'MEDIUM',
      };
    },
  },
  {
    key: 'ELIGIBLE_UNSUBMITTED_CLAIMS',
    label: 'Remind doctors about eligible unsubmitted claims',
    topic: 'claim',
    evaluate: ({ claims, asOf }) => {
      const count = claims.eligibleUnclaimed.value;
      if (count === 0) return null;
      return {
        observedIndicator: `${count} eligible claim item${count === 1 ? '' : 's'} had no claim `
          + 'form submitted at the cutoff.',
        recommendedAction: 'Send the standing reminder to the doctors holding eligible '
          + 'unsubmitted items. Report release is not affected by this, and must not be held '
          + 'back on account of it.',
        actionOwner: 'Records officer, with Finance for the item list',
        reviewDate: nextReview(asOf, 5),
        examples: [],
        severity: count > 20 ? 'MEDIUM' : 'LOW',
      };
    },
  },
  {
    key: 'RECONCILE_APPROVED_UNPAID',
    label: 'Reconcile approved unpaid items',
    topic: 'payment',
    evaluate: ({ claims, asOf }) => {
      if (claims.approvedUnpaid.valueSen === 0
        && claims.approvedUnpaid.inconsistencies.length === 0) return null;
      const inconsistent = claims.approvedUnpaid.inconsistencies.length;
      return {
        observedIndicator: `${formatRinggit(claims.approvedUnpaid.valueSen)} of approved claim `
          + 'value had no reconciled payment evidence at the cutoff'
          + (inconsistent > 0
            ? `, and ${inconsistent} item${inconsistent === 1 ? '' : 's'} show settlement `
              + 'exceeding approval.'
            : '.'),
        recommendedAction: 'Obtain the payment references and dates for the approved items and '
          + 'reconcile them. An approval, a voucher or a payment instruction is not evidence '
          + 'that money moved, so these items stay "awaiting payment confirmation" until the '
          + 'evidence is recorded.',
        actionOwner: 'Finance officer',
        reviewDate: nextReview(asOf, 5),
        examples: claims.approvedUnpaid.inconsistencies.slice(0, 5).map((i) => i.claimItemId),
        severity: inconsistent > 0 ? 'HIGH' : 'MEDIUM',
      };
    },
  },
  {
    key: 'CORRECT_MISSING_COMPLETENESS_DATES',
    label: 'Correct missing completeness dates',
    topic: 'completeness',
    evaluate: ({ exceptions, asOf }) => {
      const missing = exceptions.find((e) => e.code === 'MISSING_COMPLETENESS_DATE');
      if (!missing) return null;
      return {
        observedIndicator: `${missing.count} completed report${missing.count === 1 ? '' : 's'} `
          + 'had no recorded completeness date, so neither a deadline nor a turnaround can be '
          + 'measured for them.',
        recommendedAction: 'Establish the true completeness date from the file and record it. '
          + 'Until then these cases sit outside every timeliness figure, which flatters the '
          + 'reported result.',
        actionOwner: 'Records officer',
        reviewDate: nextReview(asOf, 5),
        examples: missing.examples,
        severity: 'HIGH',
      };
    },
  },
  {
    key: 'UNACKNOWLEDGED_ASSIGNMENTS',
    label: 'Chase unacknowledged assignments',
    topic: 'assignment',
    evaluate: ({ cohort, asOf }) => {
      const stale = cohort.applications.filter(
        (a) => a.isOpen && a.taskAssignedAt !== null && a.taskAcknowledgedAt === null);
      if (stale.length === 0) return null;
      return {
        observedIndicator: `${stale.length} assignment${stale.length === 1 ? '' : 's'} had not `
          + 'been acknowledged by the assigned doctor at the cutoff.',
        recommendedAction: 'Confirm the assigned doctor is available and reassign within the '
          + 'department where they are not. Reassignment does not extend the overall service '
          + 'deadline, so the sooner it happens the more time remains.',
        actionOwner: 'Head of department, with the Records officer',
        reviewDate: nextReview(asOf, 3),
        examples: stale.slice(0, 5).map((a) => a.applicationId),
        severity: 'MEDIUM',
      };
    },
  },
  {
    key: 'READY_NOT_NOTIFIED',
    label: 'Notify applicants whose reports are ready',
    topic: 'notification',
    evaluate: ({ exceptions, asOf }) => {
      const found = exceptions.find((e) => e.code === 'READY_NOT_NOTIFIED');
      if (!found) return null;
      return {
        observedIndicator: `${found.count} report${found.count === 1 ? '' : 's'} were ready for `
          + 'release with no applicant notification recorded.',
        recommendedAction: 'Send the collection notification to the verified contact for each '
          + 'case. Every one of these is an applicant who has no way of knowing their report '
          + 'is waiting, and is the most likely reason for a telephone call to the counter.',
        actionOwner: 'Records officer',
        reviewDate: nextReview(asOf, 2),
        examples: found.examples,
        severity: 'HIGH',
      };
    },
  },
];

export function buildRecommendations(ctx: RuleContext): RecommendationPanel {
  const collection = ctx.handle.get<{ value_json: string }>(
    `SELECT value_json FROM config_settings WHERE config_key = 'rag.collection_version'
       AND superseded_at IS NULL ORDER BY version DESC LIMIT 1`);
  const collectionVersion = collection ? JSON.parse(collection.value_json) as string | null : null;

  const recommendations: Recommendation[] = [];
  const noFinding: string[] = [];

  for (const rule of RULES) {
    const finding = rule.evaluate(ctx);
    if (!finding) { noFinding.push(rule.label); continue; }

    const citation = retrievePolicySupport(ctx.handle, rule.topic, ctx.clearance);
    recommendations.push({
      key: rule.key,
      ...finding,
      // A citation is what turns a suggestion into a requirement. Without one the
      // recommendation stays a management suggestion, and says so.
      evidenceKind: citation ? 'POLICY_REQUIREMENT' : 'MANAGEMENT_SUGGESTION',
      policyCitation: citation,
      policyGap: citation ? null : {
        message: NO_POLICY_MESSAGE,
        routeTo: documentOwnerFor(ctx.handle, rule.topic),
      },
      requiresHumanAcceptance: true,
    });
  }

  recommendations.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    generatedAt: ctx.asOf,
    ragCollectionVersion: collectionVersion,
    ragStatus: collectionVersion ? 'ACTIVE' : 'NO_APPROVED_COLLECTION',
    ragNotice: collectionVersion
      ? `Retrieval is active over approved collection ${collectionVersion}. Retrieved passages `
        + 'are shown as quoted evidence and are not treated as instructions.'
      : 'No approved, versioned policy collection has been supplied, so no recommendation is '
        + 'presented as a policy requirement. The deterministic rules panel is serving in its '
        + 'place, and every item below is a management suggestion inferred from the operational '
        + 'data. Nothing here is a citation.',
    recommendations,
    rulesEvaluatedWithNoFinding: noFinding,
  };
}

function documentOwnerFor(handle: Handle, topic: string): string {
  const owners: Record<string, string> = {
    assignment: 'Records Unit — IKN Records Unit SOP',
    signature: 'Records Unit — IKN local escalation policy',
    claim: 'Finance — claim and payment circular',
    payment: 'Finance — claim and payment circular',
    completeness: 'Records Unit — IKN Records Unit SOP',
    notification: 'Records Unit — IKN Records Unit SOP',
  };
  const fallback = owners[topic] ?? 'Records Unit';
  const row = handle.get<{ owner: string | null; title: string }>(
    `SELECT owner, title FROM policy_documents WHERE approval_state = 'NOT_SUPPLIED' LIMIT 1`);
  return row?.owner ? `${fallback} (registered owner: ${row.owner})` : fallback;
}

function severityRank(s: Recommendation['severity']): number {
  return s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1;
}

/** A review date `days` calendar days out, expressed as a business date. */
function nextReview(asOf: Instant, days: number): BusinessDate {
  return addDays(toBusinessDate(asOf), days);
}
