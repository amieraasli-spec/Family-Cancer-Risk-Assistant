/**
 * Parses and validates the shared dashboard filter, and resolves it against the
 * caller's scope.
 *
 * A department-scoped caller who asks for a department they do not hold gets a 403
 * rather than a silently narrowed answer: quietly changing the question is how a
 * dashboard ends up showing one thing and meaning another.
 */
import type { Request } from 'express';
import { z } from 'zod';
import type { Handle } from '../db/database.ts';
import type { Principal } from '../auth/session.ts';
import type { Scope } from '../auth/permissions.ts';
import { scopePredicate } from '../auth/authorise.ts';
import { monthKey, nowInstant, toBusinessDate } from '../domain/time.ts';
import { badRequest, forbidden } from './errors.ts';
import type { PanelRequest } from '../analytics/panels.ts';

const filterSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  trailingMonths: z.coerce.number().int().min(1).max(36).optional(),
  departments: z.string().optional(),
  reportTypes: z.string().optional(),
  /** Overriding the cutoff is allowed so a past snapshot can be reproduced exactly. */
  asOf: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export interface ParsedFilter {
  request: PanelRequest;
  page: number;
  pageSize: number;
}

export function parseFilter(
  handle: Handle, req: Request, principal: Principal, scope: Scope,
): ParsedFilter {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('INVALID_FILTER', 'The filter parameters are not valid.',
      parsed.error.flatten().fieldErrors);
  }
  const q = parsed.data;
  const cutoff = q.asOf ?? nowInstant();
  const month = q.month ?? monthKey(toBusinessDate(cutoff));

  const requested = q.departments ? q.departments.split(',').map((d) => d.trim()).filter(Boolean) : [];
  const departmentIds = resolveDepartments(requested, principal, scope);
  const reportTypes = q.reportTypes
    ? q.reportTypes.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const predicate = scopePredicate(scope, principal, {
    department: 'a.department_id', doctor: 't.doctor_id',
  });

  const request: PanelRequest = {
    month,
    trailingMonths: q.trailingMonths ?? 12,
    cutoff,
    departmentLabel: departmentLabel(handle, departmentIds),
    policyClearance: principal.policyClearance,
  };
  if (departmentIds.length > 0) {
    (request as { departmentIds?: readonly string[] }).departmentIds = departmentIds;
  }
  if (reportTypes.length > 0) {
    (request as { reportTypes?: readonly string[] }).reportTypes = reportTypes;
  }
  if (predicate.sql !== '(1 = 1)') {
    (request as { scope?: { sql: string; params: (string | number)[] } }).scope = predicate;
  }
  const claimPredicate = claimScopePredicate(scope, principal);
  if (claimPredicate) {
    (request as { claimScope?: { sql: string; params: (string | number)[] } })
      .claimScope = claimPredicate;
  }

  return { request, page: q.page ?? 1, pageSize: q.pageSize ?? 5 };
}

function resolveDepartments(
  requested: readonly string[], principal: Principal, scope: Scope,
): string[] {
  if (scope !== 'DEPARTMENT') return [...requested];
  if (requested.length === 0) return [...principal.departmentIds];
  const outside = requested.filter((d) => !principal.departmentIds.includes(d));
  if (outside.length > 0) {
    throw forbidden('That department is outside your scope.');
  }
  return [...requested];
}

/**
 * Claim-item scope predicate. Kept separate from the application predicate because
 * the column names differ, and passing the wrong one is the sort of mistake that
 * silently widens a query.
 */
export function claimScopePredicate(scope: Scope, principal: Principal) {
  const predicate = scopePredicate(scope, principal, {
    department: 'ci.department_id', doctor: 'ci.doctor_id',
  });
  return predicate.sql === '(1 = 1)' ? undefined : predicate;
}

function departmentLabel(handle: Handle, departmentIds: readonly string[]): string {
  if (departmentIds.length === 0) return 'all departments';
  const names = handle.all<{ name: string }>(
    `SELECT name FROM departments WHERE department_id IN (${departmentIds.map(() => '?').join(',')})
     ORDER BY name`, ...departmentIds).map((r) => r.name);
  if (names.length === 0) return 'all departments';
  if (names.length === 1) return names[0]!;
  return `${names.length} departments (${names.join(', ')})`;
}
