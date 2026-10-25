import { verifySessionToken, sessionClaims, legacySessionId, SESSION_MAX_MS } from './tokens.js';
import { User } from '../../models/User.js';

// Who holds this Doorline session token — WITHOUT answering a request and WITHOUT stamping "last
// seen". For the one place a public page may say who is looking: a client-report open counts a
// signed-in member of the organization, or Doorline staff, apart from the link's own visits
// (routes/public/share.js, services/reports/reportOpens.js — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md
// §F7). It never grants or refuses anything; it only names a bucket.
//
// Every check here is requireAuth's (middleware/auth.js), in requireAuth's order and built from the
// same primitives, so a token requireAuth would refuse never names a member here: an ended session, a
// password changed since sign-in, a deleted or inactive account, a token past its exp or past the
// 90-day cap all come back with requireAuth's own `reason` and no user. resolveSessionUser.int.test.js
// runs the two over the same matrix of tokens and asserts the same verdict for each — if requireAuth
// gains a check, that test is where this one learns of it.
//
// Returns { user, reason }: `user` (hydrated, like requireAuth's req.user) when requireAuth would let
// the request through, else null with the reason requireAuth would answer — or 'fault' where
// requireAuth answers 503 (no secret, the lookup threw). Never throws.
export const resolveSessionUser = async (token) => {
  if (typeof token !== 'string' || !token) return { user: null, reason: 'missing' };
  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    return { user: null, reason: 'fault' };
  }
  const claims = payload && sessionClaims(payload);
  if (!claims) return { user: null, reason: 'invalid' };
  const sid = claims.sid ?? legacySessionId(token);

  let user;
  try {
    user = await User.findById(claims.sub).select('+endedSessionIds');
  } catch {
    return { user: null, reason: 'fault' };
  }
  if (!user) return { user: null, reason: 'invalid' };
  if (user.deletedAt) return { user: null, reason: 'deleted' };
  if (!user.isActive) return { user: null, reason: 'inactive' };
  if (user.passwordChangedAt && claims.authMs < new Date(user.passwordChangedAt).getTime()) {
    return { user: null, reason: 'password_changed' };
  }
  if (user.endedSessionIds?.includes(sid)) return { user: null, reason: 'invalid' };
  const nowMs = Date.now();
  if (Math.floor(nowMs / 1000) >= claims.exp) return { user: null, reason: 'expired' };
  if (claims.hasAuthMs && nowMs - claims.authMs > SESSION_MAX_MS) return { user: null, reason: 'expired' };
  return { user, reason: null };
};
