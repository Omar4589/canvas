import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to <repo>/client/dist when running from server/src/.
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const HAS_CLIENT_DIST = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

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
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(isProd ? 'combined' : 'dev'));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/auth/login', authLimiter);

  app.use('/api', routes);

  // Serve the built React admin dashboard from the same origin in production.
  // Heroku's heroku-postbuild produces client/dist before the server boots.
  if (isProd && HAS_CLIENT_DIST) {
    app.use(express.static(CLIENT_DIST));
    // Unknown /api paths still 404; everything else falls back to the SPA.
    app.use('/api', notFound);
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else {
    app.use(notFound);
  }

  app.use(errorHandler);

  return app;
}
