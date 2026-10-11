import {
  verifySessionToken,
  sessionClaims,
  legacySessionId,
  SESSION_MAX_MS,
} from '../services/auth/tokens.js';
import { User } from '../models/User.js';
import { canManageCampaign } from '../services/authz/campaignManagement.js';
import { shouldStampLastSeen } from './lastSeen.js';

// Every way a session can end answers the SAME 401 code, SESSION_REVOKED, plus a `reason`. Reusing
// the code is deliberate: every phone bundle since 2026-07-18 and the web already turn it into "go
// to sign-in", so even apps that never update stop dead-ending on a Retry button. `reason` is
// additive. New clients pick their own copy from it (lib/sessionEnd.js on both); the `error` text
// is what an OLD app shows where it catches the 401 without signing out, so it never claims a
// sign-out happened. See docs/PROPOSAL_SESSION_EXPIRY.md section C.
const ENDED_TEXT = {
  missing: 'Sign in to continue.',
  expired: 'Your sign-in has ended. Sign in again to keep going.',
  invalid: 'Your sign-in has ended. Sign in again to keep going.',
  deleted: 'This account has been deleted.',
  inactive: "This account can't be used to sign in.",
  password_changed: 'Your password was changed — sign in again.',
};

const ended = (res, reason) =>
  res.status(401).json({ error: ENDED_TEXT[reason], code: 'SESSION_REVOKED', reason });

// A fault on OUR side (no JWT_SECRET, the user lookup threw) is a 503, never a 401: once a coded 401
// means "end the session", a database blip answered as 401 would end every phone's and browser's
// session at once. Both clients already treat a 5xx as "try again later". The original error is
// logged, never sent: error.js returns err.message in production.
const serverFault = (err, next) => {
  console.error('[requireAuth] sign-in check failed:', err?.message || err);
  next(Object.assign(new Error('Sign-in check unavailable. Try again.'), { status: 503 }));
};

export const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return ended(res, 'missing');

    // Any failure to read or check the token is `invalid`, whatever the error class (bad signature,
    // malformed, non-JSON payload, nbf in the future); verifySessionToken returns null for all of it
    // and throws only for a missing secret. Expiry is checked below, AFTER the user lookup.
    let payload;
    try {
      payload = verifySessionToken(token);
    } catch (err) {
      return serverFault(err, next);
    }
    const claims = payload && sessionClaims(payload);
    if (!claims) return ended(res, 'invalid');
    const sid = claims.sid ?? legacySessionId(token);

    let user;
    try {
      user = await User.findById(claims.sub).select('+endedSessionIds');
    } catch (err) {
      return serverFault(err, next);
    }
    if (!user) return ended(res, 'invalid');
    // Checked on every request, not just at login, because a session token lives on its own: a
    // deleted user holding one would otherwise keep recording knocks and reading voter PII until it
    // expired. Loading the user here IS the revocation.
    if (user.deletedAt) return ended(res, 'deleted');
    // Only legacy rows reach this: deletion sets deletedAt too, and the admin Deactivate/Remove
    // actions change the Membership, never User.isActive. Login refuses these rows, so the phone and
    // web treat it as a deliberate sign-out rather than asking for a password that can't work.
    if (!user.isActive) return ended(res, 'inactive');
    // A sign-in older than the user's last self-set password change is revoked: "I changed my
    // password" must end every other session. Compared in milliseconds against the moment the
    // person typed their password (auth_ms, carried through every extension); an old token without
    // auth_ms counts as the last millisecond of its iat second, which is exactly the old
    // whole-second rule. null passwordChangedAt = never changed (grandfathers old sessions).
    if (user.passwordChangedAt && claims.authMs < new Date(user.passwordChangedAt).getTime()) {
      return ended(res, 'password_changed');
    }
    // Signed out (POST /auth/logout): that session and every copy of its token are over.
    if (user.endedSessionIds?.includes(sid)) return ended(res, 'invalid');
    // jsonwebtoken's own rule, applied here because the token was verified with ignoreExpiration.
    const nowMs = Date.now();
    if (Math.floor(nowMs / 1000) >= claims.exp) return ended(res, 'expired');
    // The hard limit on an extended sign-in. Tokens without auth_ms (minted before it existed) are
    // never capped; they expire on their own exp.
    if (claims.hasAuthMs && nowMs - claims.authMs > SESSION_MAX_MS) return ended(res, 'expired');

    // Best-effort last-activity stamp. Placed HERE, after every 401 guard above, on purpose: a
    // deleted or deactivated account has already been refused, so a tombstone can never be
    // re-stamped by the deleted holder's still-valid token — which is what keeps the deletion
    // scrub in services/users/deleteAccount.js true. Fire-and-forget is mandatory, not stylistic:
    // an awaited write that rejected on a transient DB blip would fail a live request. timestamps:
    // false because the schema sets them — without it every active user's updatedAt would read
    // "~now" forever.
    if (shouldStampLastSeen(String(user._id))) {
      User.updateOne(
        { _id: user._id },
        { $set: { lastSeenAt: new Date() } },
        { timestamps: false }
      ).catch(() => {});
    }
    req.user = user;
    // For GET /auth/me's extension and POST /auth/logout.
    req.auth = { iat: claims.iat, exp: claims.exp, authMs: claims.authMs, hasAuthMs: claims.hasAuthMs, sid };
    next();
  } catch (err) {
    return serverFault(err, next);
  }
};

export function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
  next();
}

// The irreversible / authority-granting platform actions: deleting an organization, promoting staff,
// editing canonical voter identity.
//
// `requireSuperAdmin` means "is Doorline staff". This means "is Doorline staff WITH break-glass
// authority" — the distinction that exists so hiring a second person does not hand them an omniscient
// login. A `support` operator can still do the job (metadata dashboard, and voter content through a
// logged, time-boxed grant); they just cannot destroy a customer or make themselves more powerful.
//
// Existing super-admins default to break_glass, so nothing anyone can do today stops working.
export function requireBreakGlass(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
  if (req.user.platformRole !== 'break_glass') {
    return res.status(403).json({
      error: 'This action requires break-glass authority. Your account has support-level access.',
      code: 'BREAK_GLASS_REQUIRED',
    });
  }
  next();
}

export function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isSuperAdmin) return next();
    const role = req.activeMembership?.role;
    if (!role || !roles.includes(role)) {
      // Machine-readable so clients can tell "your ROLE is too low here" apart from "your
      // ORG context is invalid" (orgContext.js emits ORG_CONTEXT for that). Mobile uses it
      // to notice a mid-session demotion and re-derive its route from a fresh /auth/me; the
      // web client deliberately does NOT auto-recover on it — a lead calling an admin-only
      // endpoint is a bug to fix, not a reason to eject them from the org. Mirrors
      // passwordGate's code:'PASSWORD_CHANGE_REQUIRED'.
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
    }
    next();
  };
}

// denyVendorPrivilegeWrite used to live here — a blanket "no account/role creation under a support
// grant". Owner decision 2026-07-29: a grant now PERMITS user administration (every write is
// recorded by middleware/accessLog.js); the one surviving refusal — a membership targeting a staff
// account, which is the write that would END the logging — moved to
// services/memberships/vendorGuards.js, enforced by memberships.js and leadCrew.js on the resolved
// target rather than on the method.

export function requireOrgMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.isSuperAdmin) return next();
  if (!req.activeMembership) {
    return res.status(403).json({ error: 'No active org membership', code: 'FORBIDDEN_ROLE' });
  }
  next();
}

// Gate a campaign-nested route on management authority for req.params.campaignId:
// super/org-admin always pass; a team lead passes only for a campaign they were
// granted. Runs AFTER orgContext (needs req.activeMembership/activeOrg) and, on
// the campaign routers, BEFORE loadCampaign (which still enforces org ownership).
export function requireCampaignManager(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  Promise.resolve(canManageCampaign(req, req.params.campaignId))
    .then((ok) => {
      if (!ok) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
      next();
    })
    .catch(next);
}
