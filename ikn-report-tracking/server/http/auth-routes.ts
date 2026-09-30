/** Staff sign-in, second factor, sign-out and "who am I". */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.ts';
import { login, logout, satisfyMfa, SESSION_COOKIE } from '../auth/session.ts';
import { GRANTS } from '../auth/permissions.ts';
import { badRequest, unauthorised } from './errors.ts';
import { clientHint, handler, principalOf, sessionIdOf } from './context.ts';
import { enforce, PUBLIC_LIMITS } from './rate-limit.ts';
import { settings } from '../config/settings.ts';

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});
const mfaSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export function authRouter(): Router {
  const router = Router();
  const secure = settings().nodeEnv === 'production';

  router.post('/login', handler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'Username and password are required.');
    enforce(db(), 'auth.login', clientHint(req), PUBLIC_LIMITS.login);

    const result = login(db(), parsed.data.username, parsed.data.password, clientHint(req));
    // One message for an unknown account and for a wrong password.
    if (!result) throw unauthorised('Sign-in failed. Check the username and password.');

    res.cookie(SESSION_COOKIE, result.sessionId, {
      httpOnly: true, sameSite: 'strict', secure, path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json({
      principal: publicPrincipal(result.principal),
      mfaPending: result.mfaPending,
    });
  }));

  router.post('/mfa', handler(async (req, res) => {
    const parsed = mfaSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A six-digit code is required.');
    const sessionId = sessionIdOf(req);
    if (!sessionId) throw unauthorised();
    if (!satisfyMfa(db(), sessionId, parsed.data.code)) {
      throw unauthorised('That code was not accepted.');
    }
    const principal = principalOf(req);
    if (!principal) throw unauthorised();
    res.json({ principal: publicPrincipal(principal), mfaPending: false });
  }));

  router.post('/logout', handler(async (req, res) => {
    logout(db(), sessionIdOf(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  }));

  /**
   * The session description the staff frontend renders its navigation from.
   *
   * The permission list is included so the interface can hide what the caller
   * cannot use — but the server checks every request regardless, so this list is a
   * convenience, never the control.
   */
  router.get('/me', handler(async (req, res) => {
    const principal = principalOf(req);
    if (!principal) throw unauthorised();
    res.json({
      principal: publicPrincipal(principal),
      mfaPending: principal.mfaRequired && !principal.mfaSatisfied,
      permissions: Object.keys(GRANTS[principal.role]),
      dataClass: settings().dataClass,
    });
  }));

  return router;
}

function publicPrincipal(p: { userId: string; username: string; displayName: string;
  role: string; isSupervisor: boolean; doctorId: string | null;
  departmentIds: readonly string[] }) {
  return {
    userId: p.userId, username: p.username, displayName: p.displayName, role: p.role,
    isSupervisor: p.isSupervisor, doctorId: p.doctorId, departmentIds: p.departmentIds,
  };
}
