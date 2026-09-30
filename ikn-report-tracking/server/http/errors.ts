/** Errors the HTTP layer knows how to turn into a response, with no leakage. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, detail?: unknown) =>
  new HttpError(400, code, message, detail);
export const unauthorised = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Not permitted') =>
  new HttpError(403, 'FORBIDDEN', message);
export const conflict = (code: string, message: string, detail?: unknown) =>
  new HttpError(409, code, message, detail);
export const tooManyRequests = (message = 'Too many attempts. Please try again later.') =>
  new HttpError(429, 'RATE_LIMITED', message);
export const unprocessable = (code: string, message: string, detail?: unknown) =>
  new HttpError(422, code, message, detail);

/**
 * The single response used whenever a lookup fails for **any** reason on a public
 * route: unknown reference, revoked reference, or a reference that exists but
 * belongs to somebody else. Distinguishing them would let a caller enumerate.
 */
export const publicLookupFailed = () => new HttpError(
  404, 'NOT_FOUND',
  'We cannot show a status for that reference. Please check the reference on your '
  + 'receipt, or contact the Medical Records Unit.',
);
