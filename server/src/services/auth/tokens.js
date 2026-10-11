import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// A sign-in is extended while it is used (GET /auth/me, see renewalDue), but never past this many
// days after the person last typed their password. The cap applies only to tokens that carry
// auth_ms: a token minted before auth_ms existed expires on its own exp, as it always did, so a long
// JWT_EXPIRES_IN can never turn a deploy into a mass sign-out. See docs/PROPOSAL_SESSION_EXPIRY.md.
export const SESSION_MAX_DAYS = 90;
export const SESSION_MAX_MS = SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;

// How many ended session ids a user keeps (POST /auth/logout). An ended session could only come
// back after this many later sign-outs by the same account within its cap.
export const ENDED_SESSIONS_KEPT = 200;

const secretOrThrow = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return secret;
};

// Every session token carries:
//   auth_ms — the moment the person typed their password (ms). Password-change revocation compares
//             it, so it survives extension: an extended token dies exactly when its parent would.
//   sid     — the session id. Extension carries it, and POST /auth/logout ends it, along with every
//             copy of the token.
// Login captures authMs BEFORE it reads the user, and change-password passes the exact instant it
// writes as passwordChangedAt; everything else (tests, mostly) gets "now" and a fresh sid.
export const signUserToken = (user, { authMs = Date.now(), sid = crypto.randomUUID() } = {}) => {
  const secret = secretOrThrow();
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
  return jwt.sign(
    {
      sub: String(user._id),
      email: user.email,
      isSuperAdmin: !!user.isSuperAdmin,
      auth_ms: authMs,
      sid,
    },
    secret,
    { expiresIn }
  );
};

// The extension path. Unlike signUserToken it has no defaults on purpose: an extension that fell
// back to "now" would reset the cap and outlive a password change made while it was in flight.
export const renewUserToken = (user, { authMs, sid } = {}) => {
  if (!Number.isFinite(authMs)) throw new Error('renewUserToken: authMs is required');
  if (typeof sid !== 'string' || !sid) throw new Error('renewUserToken: sid is required');
  return signUserToken(user, { authMs, sid });
};

// Due once a day for a normal 30-day token, and halfway through any shorter life (so a 2-minute
// test token renews after a minute).
export const renewalDue = (payload, nowSec = Math.floor(Date.now() / 1000)) => {
  const life = payload.exp - payload.iat;
  return nowSec - payload.iat >= Math.min(86400, life / 2);
};

// For tokens minted before sid existed: a stable id derived from the token's own signature, so every
// copy of one old token shares one session id and a sign-out ends all of them.
export const legacySessionId = (token) => {
  const signature = String(token).split('.')[2] || '';
  return `legacy:${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 32)}`;
};

// requireAuth's verifier. Never used for share tokens (verifyToken below keeps their 24h expiry).
// Expiry is checked by requireAuth itself, after the user lookup, so a deleted account reads
// "deleted" rather than "expired". Returns null for anything that isn't a readable, correctly signed
// token; throws only for a server fault (no secret), which the caller answers as 503.
export const verifySessionToken = (token) => {
  const secret = secretOrThrow();
  try {
    return jwt.verify(token, secret, { ignoreExpiration: true });
  } catch {
    return null;
  }
};

// The shape a session token must have before requireAuth spends a database read on it.
// ignoreExpiration also skips jsonwebtoken's own exp type check, so the integer exp test here is
// load-bearing. A NaN auth_ms would otherwise silently disable both revocation and the cap.
// Returns the normalized claims, or null.
export const sessionClaims = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if ('purpose' in payload || 'kind' in payload) return null; // bull board tickets, share unlocks
  const { sub, iat, exp } = payload;
  if (typeof sub !== 'string' || !mongoose.isObjectIdOrHexString(sub)) return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  const hasAuthMs = payload.auth_ms !== undefined;
  if (hasAuthMs && !Number.isFinite(payload.auth_ms)) return null;
  if (payload.sid !== undefined && (typeof payload.sid !== 'string' || !payload.sid)) return null;
  return {
    sub,
    iat,
    exp,
    hasAuthMs,
    // An old token's sign-in time is the last millisecond of its iat second, which makes
    // `authMs < passwordChangedAt` exactly today's whole-second rule for it.
    authMs: hasAuthMs ? payload.auth_ms : iat * 1000 + 999,
    sid: payload.sid ?? null,
  };
};

export const verifyToken = (token) => {
  const secret = secretOrThrow();
  return jwt.verify(token, secret);
};

// Short-lived access token issued after a correct share-link password, authorizing the public
// report reads for that one link. `kind: 'share'` distinguishes it from a user token.
export const signShareToken = ({ shareId, campaignId }) => {
  const secret = secretOrThrow();
  return jwt.sign(
    { kind: 'share', shareId: String(shareId), campaignId: String(campaignId) },
    secret,
    { expiresIn: '24h' }
  );
};
