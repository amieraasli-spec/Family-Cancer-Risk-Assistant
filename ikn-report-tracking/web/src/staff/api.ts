/**
 * Staff API client.
 *
 * Holds no key and no secret: the session is an HttpOnly cookie the browser sends
 * automatically, so nothing sensitive is reachable from this bundle.
 */

export interface ApiError { code: string; message: string; detail?: unknown }

export class RequestFailed extends Error {
  constructor(readonly status: number, readonly apiError: ApiError) {
    super(apiError.message);
    this.name = 'RequestFailed';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = (payload as { error?: ApiError } | null)?.error
      ?? { code: 'UNKNOWN', message: `Request failed with ${response.status}` };
    throw new RequestFailed(response.status, err);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    // A retried write carries the same key, so a double tap cannot act twice.
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  }),
};

/** A fresh idempotency key for one user intent. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface Principal {
  userId: string; username: string; displayName: string; role: string;
  isSupervisor: boolean; doctorId: string | null; departmentIds: string[];
}

export interface Session {
  principal: Principal;
  mfaPending: boolean;
  permissions: string[];
  dataClass: 'SYNTHETIC' | 'LIVE';
}

export const ROLE_LABEL: Record<string, string> = {
  records_officer: 'Records officer',
  doctor: 'Doctor',
  hod: 'Head of department',
  finance_officer: 'Finance officer',
  director: 'Director',
  system_admin: 'System administrator',
};

/** Builds the dashboard filter query string. */
export function filterQuery(f: {
  month: string; trailingMonths?: number; departments?: string[]; reportTypes?: string[];
  asOf?: string; page?: number; pageSize?: number;
}): string {
  const params = new URLSearchParams({ month: f.month });
  if (f.trailingMonths) params.set('trailingMonths', String(f.trailingMonths));
  if (f.departments && f.departments.length > 0) params.set('departments', f.departments.join(','));
  if (f.reportTypes && f.reportTypes.length > 0) params.set('reportTypes', f.reportTypes.join(','));
  if (f.asOf) params.set('asOf', f.asOf);
  if (f.page) params.set('page', String(f.page));
  if (f.pageSize) params.set('pageSize', String(f.pageSize));
  return params.toString();
}
