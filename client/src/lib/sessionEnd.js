// What the web console does when the server says a session has ended, and the words it uses.
//
// Plain module (no imports), tested by sessionEnd.test.js. The copy mirrors the phone's
// mobile/lib/sessionEnd.js word for word; sessionEnd.parity.test.js imports that file and fails if
// any string drifts. See docs/PROPOSAL_SESSION_EXPIRY.md section E.
//
// The server answers EVERY ended session as 401 { code: 'SESSION_REVOKED', reason }:
//   missing          — the request carried no token (on the web: signed out in another tab)
//   expired          — past its expiry, or past the 90-day cap on an extended sign-in
//   invalid          — unreadable, foreign, unknown user, or a session ended by signing out
//   deleted          — the account was deleted
//   inactive         — an old account switched off long ago (login refuses it too)
//   password_changed — the password was changed after this sign-in

export const REASONS = ['missing', 'expired', 'invalid', 'deleted', 'inactive', 'password_changed'];

// The reason for a 401 SESSION_REVOKED, or null for any other answer — including the 401s that
// are NOT session ends (a wrong typed password, a share-link password, FbTime's KEY_* passthroughs).
export const sessionEndReason = (status, data) => {
  if (status !== 401 || data?.code !== 'SESSION_REVOKED') return null;
  if (data.reason === undefined || data.reason === null) return 'password_changed';
  return REASONS.includes(data.reason) ? data.reason : 'invalid';
};

// 'reauth'  — ask for the password in place: nothing navigates, so unsaved edits survive;
// 'signout' — a deliberate end: go to the sign-in page with a note.
// A password change while the password prompt is up stays in place — the person's own reset from
// the prompt — within half an hour (resetWindowOpen; the same rule as the phone) of the latest of:
// the prompt going up; someone using it (a sign-in attempt, "Forgot password?": activeAt); and the
// prompt first switching to ask for the NEW password (changeHeardAt, so there is half an hour to
// type it). A tab left untouched on the prompt longer may be on a forgotten shared computer, and its
// owner changing the password must sign it out — a prompt already asking for the new password
// included. Signing out in another tab (`missing`) is deliberate.
export const RESET_WINDOW_MS = 30 * 60 * 1000;
const stamp = (value) => (Number.isFinite(value) ? value : 0);
export const resetWindowOpen = (reauth, nowMs) => {
  if (!reauth || !Number.isFinite(reauth.raisedAt)) return false;
  const since = Math.max(reauth.raisedAt, stamp(reauth.activeAt), stamp(reauth.changeHeardAt));
  return nowMs - since < RESET_WINDOW_MS;
};
// The decision AuthContext makes for a password-changed answer while the prompt is up.
export const keepReauthInPlace = (reauth, nowMs) => resetWindowOpen(reauth, nowMs);

export const webAction = (reason, { reauthUp = false } = {}) => {
  if (reason === 'expired' || reason === 'invalid') return 'reauth';
  if (reason === 'password_changed' && reauthUp) return 'reauth';
  return 'signout';
};

// An ended-session answer is acted on only when it is about the session this tab still holds.
// A request that carried no token is live only while no token is stored (signed out in another
// tab); a request that carried one, only while that same token is still the stored one (a request
// that left before a token change must never end the new session).
export const sessionEndDecision = ({ status, data, sentToken, storedToken }) => {
  const reason = sessionEndReason(status, data);
  if (!reason) return null;
  const live = sentToken ? sentToken === storedToken : !storedToken;
  return live ? { reason } : null;
};

// Pages that work without a session. No password prompt, no redirect, ever, on these.
const PUBLIC_BASES = ['/login', '/forgot-password', '/reset-password', '/r', '/privacy', '/terms', '/delete-account', '/update-required'];
export const isPublicPath = (pathname) =>
  pathname === '/' || PUBLIC_BASES.some((base) => pathname === base || pathname.startsWith(`${base}/`));

// Allowlisted ?signedOut= values for the sign-in page's note.
export const parseSignedOut = (value) => (REASONS.includes(value) ? value : null);

// The token's own claims, read WITHOUT verifying — for scheduling a renewal check and telling
// whether a token another tab stored belongs to the same person. The server stays the authority.
export const tokenClaims = (token) => {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = JSON.parse(atob(padded));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
};

// Whether an open tab should ask GET /auth/me for an extended sign-in now:
//   - the token is old enough to be extended (a day, or half its life if shorter — the server's
//     own renewalDue rule);
//   - someone has used this tab since the token was issued (an unattended wall display never
//     extends itself, and runs out like any idle sign-in);
//   - and the last check was long enough ago (6 hours, or a quarter of a short life), whatever
//     it answered — a staff tab, which is never extended, must not ask every minute.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
export const renewCheckDue = ({ token, now, lastCheckAt = 0, lastInteractionAt = 0 }) => {
  const claims = tokenClaims(token);
  if (!claims || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return false;
  const lifeMs = (claims.exp - claims.iat) * 1000;
  const issuedMs = claims.iat * 1000;
  if (now - issuedMs < Math.min(86400 * 1000, lifeMs / 2)) return false;
  if (lastInteractionAt <= issuedMs) return false;
  return now - lastCheckAt >= Math.min(SIX_HOURS_MS, lifeMs / 4);
};

// Adopt a renewed token only for the session that asked (never after a sign-out or another
// tab's sign-in).
export const shouldAdoptRenewedToken = ({ sentToken, currentToken, newToken }) =>
  !!newToken && !!sentToken && currentToken === sentToken && newToken !== sentToken;

// React Query's retry: the same single retry as before, except a 401, which can't succeed a
// second later. failureCount starts at 0.
export const retryUnless401 = (failureCount, err) => err?.status !== 401 && failureCount < 1;

// ── Copy (identical on the phone — see sessionEnd.parity.test.js) ──────────────────────────────
// Never "you've been signed out" for the password prompt: it is not a sign-out.

export const REAUTH_TITLE = 'Enter your password to keep going';

export const reauthBody = (reason) =>
  reason === 'password_changed'
    ? 'Your password was changed. Enter your new password to keep going.'
    : 'For security, Doorline asks for your password again from time to time. Nothing is wrong, and what you were doing is still here.';

export const signedOutNote = (reason) => {
  if (reason === 'password_changed') {
    return 'Your password was changed, so you were signed out here. Sign in with your new password.';
  }
  if (reason === 'deleted') return "This account has been deleted, so it can't be used to sign in.";
  if (reason === 'inactive') {
    return "This account can't be used to sign in. Ask your organization's admin if that's a mistake.";
  }
  return "You've been signed out. Sign in again to keep going.";
};
