/**
 * The permission model, in one place.
 *
 * `docs/03-permission-matrix.md` is the human-readable version of this file; the
 * two are kept in step, and `tests/permissions.test.ts` asserts the prohibitions
 * the document states as absolute.
 *
 * A role that holds no entry for a permission is denied it. There is no wildcard
 * and no implicit inheritance, so adding a role cannot accidentally widen access.
 */
import type { Role } from '../../shared/domain.ts';

export const PERMISSIONS = [
  'public.status.read', 'public.nextaction.detail',
  'application.register', 'application.read', 'application.completeness.set',
  'application.authority.verify', 'application.assign', 'application.reassign',
  'application.cancel', 'application.reopen', 'application.extension.grant',
  'task.read', 'task.acknowledge', 'task.progress.update', 'task.submit.signed',
  'task.completion.accept', 'task.return',
  'release.authorise', 'release.record.collection',
  'fee.set', 'fee.payment.record', 'fee.exemption.grant', 'fee.read',
  'claim.eligibility.assess', 'claim.submit', 'claim.withdraw', 'claim.read',
  'claim.verify', 'claim.return', 'claim.approve',
  'payment.instruct', 'payment.reconcile', 'payment.read',
  'metrics.read.hospital', 'metrics.drilldown', 'export.monthly', 'snapshot.freeze',
  'forecast.read', 'recommendations.read', 'recommendations.accept',
  'policy.document.read', 'attachment.download',
  'admin.users', 'admin.calendar', 'admin.rules', 'admin.integration',
  'admin.notification.adapter', 'import.run',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * How far a granted permission reaches.
 *
 *  ALL         — every record
 *  DEPARTMENT  — records in the acting user's departments
 *  OWN         — records belonging to the acting user (a doctor's own tasks/claims)
 *  AGGREGATE   — aggregate figures only; row-level detail needs a drill-down grant
 *  SUPERVISOR  — ALL, but only for a Records officer flagged as a supervisor
 *  NOT_OWN_SUBMISSION — ALL, minus anything this user submitted (separation of duty)
 */
export type Scope = 'ALL' | 'DEPARTMENT' | 'OWN' | 'AGGREGATE' | 'SUPERVISOR' | 'NOT_OWN_SUBMISSION';

type Grants = Partial<Record<Permission, Scope>>;

const RECORDS_OFFICER: Grants = {
  'application.register': 'ALL',
  'application.read': 'ALL',
  'application.completeness.set': 'ALL',
  'application.authority.verify': 'ALL',
  'application.assign': 'ALL',
  'application.reassign': 'ALL',
  'application.cancel': 'ALL',
  'application.reopen': 'SUPERVISOR',
  'task.read': 'ALL',
  'task.completion.accept': 'ALL',
  'task.return': 'ALL',
  'release.authorise': 'ALL',
  'release.record.collection': 'ALL',
  'fee.set': 'ALL',
  'fee.payment.record': 'ALL',
  'fee.exemption.grant': 'ALL',
  'fee.read': 'ALL',
  'claim.eligibility.assess': 'ALL',
  'metrics.read.hospital': 'ALL',
  'metrics.drilldown': 'ALL',
  'export.monthly': 'ALL',
  'forecast.read': 'ALL',
  'recommendations.read': 'ALL',
  'recommendations.accept': 'ALL',
  'policy.document.read': 'ALL',
  'attachment.download': 'ALL',
  'import.run': 'ALL',
};

/**
 * Doctors are scoped to OWN throughout. They hold no fee, payment-summary,
 * hospital-metric or other-doctor permission at all, so there is nothing for a
 * scope filter to get wrong.
 */
const DOCTOR: Grants = {
  'application.read': 'OWN',
  'task.read': 'OWN',
  'task.acknowledge': 'OWN',
  'task.progress.update': 'OWN',
  'task.submit.signed': 'OWN',
  'claim.submit': 'OWN',
  'claim.withdraw': 'OWN',
  'claim.read': 'OWN',
  'payment.read': 'OWN',
  'policy.document.read': 'ALL',
  'attachment.download': 'OWN',
};

const HOD: Grants = {
  'application.read': 'DEPARTMENT',
  'application.assign': 'DEPARTMENT',
  'application.reassign': 'DEPARTMENT',
  'task.read': 'DEPARTMENT',
  'claim.read': 'DEPARTMENT',
  'metrics.read.hospital': 'DEPARTMENT',
  'metrics.drilldown': 'DEPARTMENT',
  'export.monthly': 'DEPARTMENT',
  'forecast.read': 'DEPARTMENT',
  'recommendations.read': 'DEPARTMENT',
  'recommendations.accept': 'DEPARTMENT',
  'policy.document.read': 'ALL',
  'attachment.download': 'DEPARTMENT',
};

const FINANCE_OFFICER: Grants = {
  'application.read': 'AGGREGATE',
  'fee.payment.record': 'ALL',
  'fee.read': 'ALL',
  'claim.eligibility.assess': 'ALL',
  'claim.read': 'ALL',
  'claim.verify': 'ALL',
  'claim.return': 'ALL',
  // Separation of duty: a finance officer cannot approve a claim they submitted.
  'claim.approve': 'NOT_OWN_SUBMISSION',
  'payment.instruct': 'ALL',
  'payment.reconcile': 'ALL',
  'payment.read': 'ALL',
  'metrics.read.hospital': 'AGGREGATE',
  'metrics.drilldown': 'AGGREGATE',
  'export.monthly': 'ALL',
  'recommendations.read': 'ALL',
  'recommendations.accept': 'ALL',
  'policy.document.read': 'ALL',
  'attachment.download': 'ALL',
  'import.run': 'ALL',
};

const DIRECTOR: Grants = {
  'application.read': 'AGGREGATE',
  'application.extension.grant': 'ALL',
  'task.read': 'AGGREGATE',
  'fee.read': 'AGGREGATE',
  'claim.read': 'AGGREGATE',
  'payment.read': 'AGGREGATE',
  'metrics.read.hospital': 'ALL',
  // Authorised drill-down only, and every use is written to the audit trail.
  'metrics.drilldown': 'ALL',
  'export.monthly': 'ALL',
  'snapshot.freeze': 'ALL',
  'forecast.read': 'ALL',
  'recommendations.read': 'ALL',
  'recommendations.accept': 'ALL',
  'policy.document.read': 'ALL',
  'attachment.download': 'ALL',
};

/**
 * The system administrator manages users, calendars, configuration and technical
 * operations, and holds **no** patient content, clinical approval or payment
 * approval permission. That absence is the point of the role.
 */
const SYSTEM_ADMIN: Grants = {
  'admin.users': 'ALL',
  'admin.calendar': 'ALL',
  'admin.rules': 'ALL',
  'admin.integration': 'ALL',
  'admin.notification.adapter': 'ALL',
  'import.run': 'ALL',
};

export const GRANTS: Record<Role, Grants> = {
  records_officer: RECORDS_OFFICER,
  doctor: DOCTOR,
  hod: HOD,
  finance_officer: FINANCE_OFFICER,
  director: DIRECTOR,
  system_admin: SYSTEM_ADMIN,
};

/**
 * Permissions no staff role may ever hold. Asserted by the test suite against
 * `GRANTS`, so a future edit that quietly widens the model fails the build.
 */
export const FORBIDDEN_BY_ROLE: Partial<Record<Role, readonly Permission[]>> = {
  system_admin: [
    'application.read', 'application.register', 'task.read', 'fee.read', 'claim.read',
    'claim.approve', 'payment.read', 'payment.reconcile', 'attachment.download',
    'public.status.read', 'public.nextaction.detail', 'metrics.drilldown', 'snapshot.freeze',
  ],
  doctor: [
    'fee.read', 'fee.set', 'fee.payment.record', 'claim.approve', 'claim.verify',
    'payment.reconcile', 'payment.instruct', 'metrics.read.hospital', 'export.monthly',
    'application.assign', 'application.reassign', 'task.completion.accept',
  ],
  hod: ['claim.approve', 'claim.verify', 'payment.reconcile', 'fee.read', 'snapshot.freeze'],
  finance_officer: [
    'application.assign', 'task.completion.accept', 'release.authorise',
    'application.cancel', 'claim.submit',
  ],
};

export function scopeFor(role: Role, permission: Permission): Scope | undefined {
  return GRANTS[role][permission];
}
