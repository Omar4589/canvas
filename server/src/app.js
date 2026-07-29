import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import {
  loginIpLimiter,
  loginEmailLimiter,
  forgotIpLimiter,
  forgotEmailLimiter,
  resetIpLimiter,
} from './middleware/loginRateLimit.js';
import { requireBullBoardAuth, createBullBoardRouter } from './queues/bullBoard.js';
import { WEB_SEGMENTS } from './webRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to <repo>/client/dist when running from server/src/. Overridable so the static +
// 404 routing can be exercised against a fixture dist in tests without a real client build.
const CLIENT_DIST = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.resolve(__dirname, '../../client/dist');
const HAS_CLIENT_DIST = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

// The committed static legal documents (client/public/*.html, copied into dist by the client
// build). Served at clean URLs ahead of the SPA fallback: a legal notice must render for curl,
// store-review bots and crawlers with ZERO JavaScript — the SPA shell used to answer /privacy
// with the homepage's markup and canonical tag. Checked once at boot (dist is immutable for the
// life of a dyno); a missing file falls through to the fallback rather than 500ing.
const STATIC_PAGES = [
  ['/privacy', 'privacy.html'],
  ['/terms', 'terms.html'],
  ['/delete-account', 'delete-account.html'],
  // Not a legal notice, but here for the same reason: /app has to be findable in search and
  // correct in a link preview, and the SPA shell would hand it the homepage's canonical tag and
  // OG copy. See the comment block in client/public/app.html.
  ['/app', 'app.html'],
];
// The zero-JS 404 document. If a stale dist lacks it, serve the SPA shell WITH a 404 status —
// App.jsx's catch-all renders its NotFoundPage, so the status code stays honest either way.
const NOT_FOUND_DOC = fs.existsSync(path.join(CLIENT_DIST, '404.html'))
  ? path.join(CLIENT_DIST, '404.html')
  : path.join(CLIENT_DIST, 'index.html');

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  // Custom-domain hosts: the API-only host (api.doorline.app) redirects non-API
  // paths to the web app at WEB_ORIGIN. Both come from config so nothing is
  // hardcoded; when API_HOST is unset the redirect guard below is a no-op.
  const API_HOST = process.env.API_HOST;
  const WEB_ORIGIN = process.env.WEB_ORIGIN || 'https://doorline.app';

  // Behind Heroku's single router/proxy — trust it so req.ip reflects the real
  // client IP (required for express-rate-limit to key correctly).
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Loosen CSP defaults so the React bundle and Mapbox tile fetches load.
      // For an internal admin tool this is acceptable; tighten if needed.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true,
      credentials: false,
    })
  );
  // Gzip every response — the API's JSON (admin map + reports especially)
  // compresses ~85-90%, and neither Express nor Heroku's router does this
  // for us (see docs/PERFORMANCE.md → Payload scaling).
  app.use(compression());
  // The Resend webhook's Svix signature covers the EXACT raw bytes, so that one path keeps a
  // raw Buffer body — mounted BEFORE express.json, whose parse would make byte-perfect
  // re-serialization impossible (body-parser sets req._body, so the JSON parser skips it).
  app.use('/api/webhooks/resend', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(isProd ? 'combined' : 'dev'));

  // Lock the API host to /api/* only. On api.doorline.app every non-API path
  // (web routes, static assets, even /admin/queues) belongs on the web app, so
  // redirect it to WEB_ORIGIN. Mounted before the API routes and Bull Board so
  // it catches every non-API path. 302 (not 301) keeps the behavior changeable
  // — a 301 would be cached near-permanently by browsers. No-op in local dev.
  if (API_HOST) {
    app.use((req, res, next) => {
      if (req.hostname === API_HOST && !req.path.startsWith('/api')) {
        return res.redirect(302, `${WEB_ORIGIN}${req.originalUrl}`);
      }
      next();
    });
  }

  // Login throttles (see middleware/loginRateLimit.js): per-IP + per-email, failed-attempts only,
  // with an env allowlist (LOGIN_RATELIMIT_ALLOWLIST) that bypasses both so an allowlisted
  // super-admin can never lock themselves out. The email key relies on express.json() above.
  app.use('/api/auth/login', loginIpLimiter, loginEmailLimiter);

  // Password-reset throttles (same module): forgot counts EVERY request on a store separate
  // from the login one — the endpoint always answers 200, and reset requests must never
  // contribute to (or be cleared with) login lockouts. Reset-password gets a per-IP cap only;
  // the token itself is the real gate.
  app.use('/api/auth/forgot-password', forgotIpLimiter, forgotEmailLimiter);
  app.use('/api/auth/reset-password', resetIpLimiter);

  app.use('/api', routes);

  // Bull Board (super-admin job console). Must be mounted BEFORE the SPA
  // fallback below, whose /^(?!\/api).*/ matcher would otherwise swallow it.
  app.use('/admin/queues', requireBullBoardAuth, createBullBoardRouter());

  // Serve the built React admin dashboard from the same origin in production.
  // Heroku's heroku-postbuild produces client/dist before the server boots.
  if (isProd && HAS_CLIENT_DIST) {
    // The clean URL is canonical for the static legal documents. Registered BEFORE
    // express.static, which would otherwise serve the .html twin at a duplicate, crawlable URL.
    app.get(['/privacy.html', '/terms.html', '/delete-account.html', '/app.html'], (req, res) => {
      res.redirect(301, req.path.replace(/\.html$/i, ''));
    });

    app.use(express.static(CLIENT_DIST));

    // The static legal pages at their clean URLs: real text, zero JS, self-canonical. Express's
    // default routing (non-strict, case-insensitive) makes one route cover /privacy, /privacy/
    // and /Privacy; app.get() also answers HEAD. maxAge 0 + ETag so a policy edit is visible on
    // the next request — these documents must never be cached past a deploy.
    for (const [route, file] of STATIC_PAGES) {
      const abs = path.join(CLIENT_DIST, file);
      if (!fs.existsSync(abs)) continue; // stale dist → fall through to the SPA fallback below
      app.get(route, (req, res, next) => {
        res.sendFile(abs, { maxAge: 0 }, (err) => (err ? next(err) : undefined));
      });
    }

    // Unknown /api paths still get the JSON 404.
    app.use('/api', notFound);

    // Everything else: the SPA shell for a known client route, a REAL 404 for anything else.
    // Unknown paths used to return the shell with a 200 and bounce to "/" client-side — a soft
    // 404. React Router matches case-insensitively, so the segment is lowercased to match.
    app.get(/^(?!\/api).*/, (req, res, next) => {
      const segment = (req.path.split('/')[1] || '').toLowerCase();
      const known = WEB_SEGMENTS.has(segment);
      res
        .status(known ? 200 : 404)
        .sendFile(known ? path.join(CLIENT_DIST, 'index.html') : NOT_FOUND_DOC, (err) =>
          err ? next(err) : undefined
        );
    });
  } else {
    app.use(notFound);
  }

  app.use(errorHandler);

  return app;
}
