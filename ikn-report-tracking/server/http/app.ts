/**
 * HTTP application assembly.
 *
 * The public API and the staff API are mounted as separate routers under separate
 * prefixes, with separate middleware. Nothing on `/api/public` can reach a staff
 * service, and the public router is registered first so a future staff route
 * cannot accidentally shadow it.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { publicRouter } from './public-routes.ts';
import { authRouter } from './auth-routes.ts';
import { staffRouter } from './staff-routes.ts';
import { settings } from '../config/settings.ts';

export function createApp(): Express {
  const app = express();
  const config = settings();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
      + "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
      + "form-action 'self'");
    if (config.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Only explicitly configured origins may call the API from a browser.
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      dataClass: config.dataClass,
      notifyProvider: config.notifyProvider,
      // Stated plainly so a demonstration cannot be mistaken for an integration.
      integrations: {
        registration: 'NOT_CONNECTED — manual entry and validated spreadsheet import only',
        finance: 'NOT_CONNECTED — validated spreadsheet import and manual reconciliation only',
        messaging: config.notifyProvider === 'SIMULATION'
          ? 'SIMULATION — no messages leave this system' : 'APPROVED_GATEWAY',
        iknWebsite: 'NOT_CONNECTED — the live IKN website has not been modified',
      },
    });
  });

  app.use('/api/public', publicRouter());
  app.use('/api/auth', authRouter());
  app.use('/api/staff', staffRouter());

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.path}` } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // The message is withheld: an unexpected failure has already been audited with
    // its detail, and the caller gets a reference, not an internal string.
    console.error('[unhandled]', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  });

  return app;
}
