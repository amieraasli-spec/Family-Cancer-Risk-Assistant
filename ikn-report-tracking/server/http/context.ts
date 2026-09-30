/**
 * Request plumbing shared by every route module: cookie reading, the client hint
 * used for rate limiting, and the wrapper that turns a thrown `HttpError` into a
 * response without leaking internals.
 */
import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { db, readOnly, type Handle } from '../db/database.ts';
import { resolveSession, SESSION_COOKIE, type Principal } from '../auth/session.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { HttpError } from './errors.ts';

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * A stable, non-reversible handle for the caller, used for rate-limit buckets.
 *
 * It mixes the remote address and user agent and is immediately hashed, so no
 * request path stores or logs a raw IP address.
 */
export function clientHint(req: Request): string {
  const raw = `${req.ip ?? 'unknown'}|${req.headers['user-agent'] ?? ''}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function principalOf(req: Request): Principal | null {
  return resolveSession(db(), readCookie(req, SESSION_COOKIE));
}

export function sessionIdOf(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

/** Read/write handle. Staff and finance routes only. */
export function writeHandle(): Handle {
  return db();
}

/**
 * Read-only handle for public routes.
 *
 * Rate limiting and one-time codes do need to write, so those two use the write
 * handle explicitly and touch only their own tables. Everything a patient's view
 * reads goes through this handle, which makes "patient viewing never mutates case
 * status" a property of the connection rather than a convention.
 */
export function publicReadHandle(): Handle {
  return readOnly();
}

export type AsyncHandler = (req: Request, res: Response) => void | Promise<void>;

/** Wraps a handler so a thrown HttpError becomes a clean response. */
export function handler(fn: AsyncHandler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({
          error: { code: err.code, message: err.message, detail: err.detail ?? undefined },
        });
        return;
      }
      // An unexpected failure is audited and reported without its stack, so an
      // internal message never reaches a patient or an unauthenticated caller.
      try {
        appendAuditEvent(db(), {
          action: 'REQUEST_ERROR', outcome: 'ERROR', requestMethod: req.method,
          requestPath: req.path, clientHint: clientHint(req),
          detail: { message: err instanceof Error ? err.message : String(err) },
        });
      } catch { /* auditing must never mask the original failure */ }
      next(err);
    }
  };
}
