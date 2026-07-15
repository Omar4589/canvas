import { Router } from 'express';
import rateLimit from 'express-rate-limit';

// "Is this installed BINARY current?" — the store-build twin of minClientApiVersion.
//
// The two gates answer different questions and both exist on purpose:
//   · minClientApiVersion (config/clientVersion.js) — "is this JS BUNDLE too old for the API
//     contract?" An OTA can fix that. Bumping it requires a code deploy.
//   · this endpoint — "is this NATIVE BUILD too old?" An OTA can NEVER fix that: under
//     runtimeVersion.policy "fingerprint", a superseded binary stops receiving updates entirely,
//     so the only path forward is the app store. The phone can't know it's been superseded (EAS
//     just returns "no update" — same answer a fully current build gets), so the server has to
//     be the one to say so.
//
// Config is env vars read PER-REQUEST (house convention — see middleware/loginRateLimit.js), so
// flipping the nag on Heroku is `config:set`, no code deploy:
//   MOBILE_CURRENT_RUNTIME_ANDROID  comma-separated runtimeVersions considered current. A build
//   MOBILE_CURRENT_RUNTIME_IOS      reporting anything else is "outdated". Unset/empty = feature
//                                   off for that platform — everyone reads "ok".
//   MOBILE_UPDATE_MODE              "hard" = blocking wall; anything else = dismissible banner.
//   MOBILE_UPDATE_NOTE              optional one-line copy shown on the nag (e.g. a deadline).
//
// The runtimeVersion to set after a build: `eas build:list` → the build's "Runtime Version".
//
// UI-only enforcement, deliberately. This endpoint never blocks API requests and no middleware
// consults it: a 4xx thrown at an old build mid-sync is exactly the offline-queue-eating failure
// the queue was hardened against. The phone keeps working; the gate is drawn by the client.
//
// Public (mounted before the auth gate): the wall must be able to cover the login screen, and
// the response leaks nothing — it echoes a verdict about strings the caller itself supplied.

const CURRENT_BY_PLATFORM = {
  android: 'MOBILE_CURRENT_RUNTIME_ANDROID',
  ios: 'MOBILE_CURRENT_RUNTIME_IOS',
};

function currentRuntimes(platform) {
  const envName = CURRENT_BY_PLATFORM[platform];
  if (!envName) return null;
  const raw = String(process.env[envName] || '').trim();
  if (!raw) return null;
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

// Generous: phones check once per launch plus a slow interval, but a whole crew can share one
// venue IP at shift start. The client fails open on any error, so a 429 just means "no nag".
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.', code: 'rate-limited' },
});

const router = Router();

router.get('/', limiter, (req, res) => {
  const platform = String(req.query.platform || '');
  const runtimeVersion = String(req.query.runtimeVersion || '');
  const current = currentRuntimes(platform);

  // Fail open on anything unexpected — a malformed request or an unconfigured platform must
  // read as "ok", never as a nag. The cost of a wrong "outdated" is a fleet-wide false alarm.
  if (!current || !runtimeVersion || current.includes(runtimeVersion)) {
    return res.json({ status: 'ok' });
  }

  const mode =
    String(process.env.MOBILE_UPDATE_MODE || '').trim().toLowerCase() === 'hard' ? 'hard' : 'soft';
  const note = String(process.env.MOBILE_UPDATE_NOTE || '').trim() || null;
  res.json({ status: 'outdated', mode, note });
});

export default router;
