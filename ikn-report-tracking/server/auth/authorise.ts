/**
 * The authorisation gate.
 *
 * Every staff and finance route passes through `authorise`, which returns the
 * scope the caller holds for the permission, or throws. It writes an audit row for
 * every denial and for every access the matrix marks privileged. Route handlers
 * then use the returned scope to build the SQL predicate, so a scope is never
 * "applied" only in the view layer.
 */
import type { Handle } from '../db/database.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { forbidden, unauthorised } from '../http/errors.ts';
import type { Principal } from './session.ts';
import { scopeFor, type Permission, type Scope } from './permissions.ts';

/** Accesses that are always audited, whether or not they are granted. */
const ALWAYS_AUDITED: readonly Permission[] = [
  'metrics.drilldown', 'attachment.download', 'export.monthly', 'snapshot.freeze',
  'import.run', 'admin.users', 'admin.calendar', 'admin.rules', 'admin.integration',
  'admin.notification.adapter', 'claim.approve', 'payment.reconcile', 'payment.instruct',
  'application.extension.grant', 'application.reopen', 'policy.document.read',
];

export interface AuthorisedScope {
  scope: Scope;
  principal: Principal;
}

export interface AuditContext {
  requestMethod?: string;
  requestPath?: string;
  clientHint?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
}

export function authorise(
  handle: Handle, principal: Principal | null, permission: Permission, ctx: AuditContext = {},
): AuthorisedScope {
  if (!principal) {
    appendAuditEvent(handle, {
      action: 'AUTHORISE', outcome: 'DENIED', permission, ...auditFields(ctx),
      detail: { reason: 'no_session' },
    });
    throw unauthorised();
  }

  // A privileged account that has not cleared its second factor holds nothing.
  if (principal.mfaRequired && !principal.mfaSatisfied) {
    deny(handle, principal, permission, ctx, 'mfa_not_satisfied');
    throw forbidden('Second factor required before this action.');
  }

  const granted = scopeFor(principal.role, permission);
  if (!granted) {
    deny(handle, principal, permission, ctx, 'role_lacks_permission');
    throw forbidden();
  }

  // SUPERVISOR is ALL, but only for a Records officer flagged as a supervisor.
  if (granted === 'SUPERVISOR' && !principal.isSupervisor) {
    deny(handle, principal, permission, ctx, 'not_a_supervisor');
    throw forbidden('This action is restricted to a Records supervisor.');
  }

  // A department-scoped user with no department assigned holds nothing, rather
  // than falling through to an unfiltered query.
  if (granted === 'DEPARTMENT' && principal.departmentIds.length === 0) {
    deny(handle, principal, permission, ctx, 'no_department_assigned');
    throw forbidden();
  }

  // A doctor-scoped user must actually be linked to a doctor record.
  if (granted === 'OWN' && principal.role === 'doctor' && !principal.doctorId) {
    deny(handle, principal, permission, ctx, 'no_doctor_link');
    throw forbidden();
  }

  if (ALWAYS_AUDITED.includes(permission)) {
    appendAuditEvent(handle, {
      actorUserId: principal.userId, actorRole: principal.role, action: 'AUTHORISE',
      outcome: 'ALLOWED', permission, ...auditFields(ctx), detail: { scope: granted },
    });
  }

  return { scope: granted === 'SUPERVISOR' ? 'ALL' : granted, principal };
}

function deny(
  handle: Handle, principal: Principal, permission: Permission, ctx: AuditContext, reason: string,
): void {
  appendAuditEvent(handle, {
    actorUserId: principal.userId, actorRole: principal.role, action: 'AUTHORISE',
    outcome: 'DENIED', permission, ...auditFields(ctx), detail: { reason },
  });
}

function auditFields(ctx: AuditContext) {
  return {
    requestMethod: ctx.requestMethod ?? null,
    requestPath: ctx.requestPath ?? null,
    clientHint: ctx.clientHint ?? null,
    resourceType: ctx.resourceType ?? null,
    resourceId: ctx.resourceId ?? null,
  };
}

export interface SqlPredicate {
  /** SQL fragment, already parenthesised, safe to AND into a WHERE clause. */
  sql: string;
  params: (string | number)[];
}

/**
 * Builds the SQL predicate for a scope, given the column names that carry
 * department and doctor on the table being queried.
 *
 * `AGGREGATE` deliberately returns a predicate that matches everything: the
 * restriction on an aggregate grant is that row-level detail routes require
 * `metrics.drilldown` separately, not that the aggregate itself is filtered.
 */
export function scopePredicate(
  scope: Scope, principal: Principal,
  columns: { department?: string; doctor?: string },
): SqlPredicate {
  switch (scope) {
    case 'ALL':
    case 'AGGREGATE':
    case 'NOT_OWN_SUBMISSION':
      return { sql: '(1 = 1)', params: [] };
    case 'DEPARTMENT': {
      if (!columns.department) {
        throw new Error('department-scoped query has no department column to filter on');
      }
      const marks = principal.departmentIds.map(() => '?').join(',');
      return {
        sql: `(${columns.department} IN (${marks}))`,
        params: [...principal.departmentIds],
      };
    }
    case 'OWN': {
      if (!columns.doctor) {
        throw new Error('own-scoped query has no doctor column to filter on');
      }
      return { sql: `(${columns.doctor} = ?)`, params: [principal.doctorId ?? '\u0000'] };
    }
    case 'SUPERVISOR':
      return { sql: '(1 = 1)', params: [] };
    default: {
      const exhaustive: never = scope;
      throw new Error(`unhandled scope: ${String(exhaustive)}`);
    }
  }
}

/**
 * Asserts a specific record is inside the caller's scope. Used on single-record
 * routes, where a predicate cannot do the work.
 */
export function assertInScope(
  handle: Handle, scope: Scope, principal: Principal, permission: Permission,
  record: { departmentId?: string | null; doctorId?: string | null }, ctx: AuditContext = {},
): void {
  const ok = (() => {
    switch (scope) {
      case 'ALL': case 'AGGREGATE': case 'NOT_OWN_SUBMISSION': case 'SUPERVISOR': return true;
      case 'DEPARTMENT':
        return !!record.departmentId && principal.departmentIds.includes(record.departmentId);
      case 'OWN':
        return !!record.doctorId && record.doctorId === principal.doctorId;
      default: return false;
    }
  })();
  if (!ok) {
    deny(handle, principal, permission, ctx, 'record_outside_scope');
    throw forbidden();
  }
}

/**
 * Separation of duty for claim approval: the approver must not be the user who
 * submitted the claim, regardless of role.
 */
export function assertNotOwnSubmission(
  handle: Handle, principal: Principal, submittedBy: string | null, ctx: AuditContext = {},
): void {
  if (submittedBy && submittedBy === principal.userId) {
    deny(handle, principal, 'claim.approve', ctx, 'approver_is_submitter');
    throw forbidden('A claim cannot be approved by the person who submitted it.');
  }
}
