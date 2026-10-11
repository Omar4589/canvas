// What the phone does when the server says a session has ended, and the words it uses.
//
// PLAIN MODULE — no imports — so CI's test:mobile (plain node, no install) can run it. The web
// mirrors the copy in client/src/lib/sessionEnd.js, and a parity test there imports this file and
// checks every string matches. See docs/PROPOSAL_SESSION_EXPIRY.md.
//
// The server answers EVERY ended session as 401 { code: 'SESSION_REVOKED', reason }:
//   missing          — the request carried no token (on the phone: SecureStore lost it)
//   expired          — past its expiry, or past the 90-day cap on an extended sign-in
//   invalid          — unreadable, foreign, unknown user, or a session ended by signing out
//   deleted          — the account was deleted
//   inactive         — an old account switched off long ago (login refuses it too)
//   password_changed — the password was changed after this sign-in

export const REASONS = ['missing', 'expired', 'invalid', 'deleted', 'inactive', 'password_changed'];

// The reason for a 401 SESSION_REVOKED, or null for any other answer — including the 401s that
// are NOT session ends (a wrong typed password, FbTime's KEY_* passthroughs). A missing reason
// means an older server, where the code's only meaning was a password change; an unknown one
// (a newer server) is treated as `invalid`.
export const sessionEndReason = (status, data) => {
  if (status !== 401 || data?.code !== 'SESSION_REVOKED') return null;
  if (data.reason === undefined || data.reason === null) return 'password_changed';
  return REASONS.includes(data.reason) ? data.reason : 'invalid';
};

// 'reauth'  — ask for the password in place (nothing on screen is lost, nothing is deleted);
// 'signout' — a deliberate end: sign out fully, off the door, with a note on the sign-in screen.
// A password change while the password screen is already up stays in place — that is what
// "Forgot password?" from the screen leads to, and wiping the phone's houses there would punish
// the person for doing exactly what the screen suggested — but only within half an hour
// (resetWindowOpen) of the latest of: the screen going up; someone trying a password or tapping
// Forgot password?, Later, Go back or the notice (activeAt); and the screen first switching to ask
// for the NEW password (changeHeardAt — so the person who just reset it has half an hour to type
// it, and a repeat answer about the same change keeps the screen while they do). A phone left
// untouched on the screen longer is more likely lost or left behind, and its owner changing the
// password must sign it out and delete its houses — including a screen already asking for the new
// password, which would otherwise keep the houses forever.
export const RESET_WINDOW_MS = 30 * 60 * 1000;
const stamp = (value) => (Number.isFinite(value) ? value : 0);
export const resetWindowOpen = (reauth, nowMs) => {
  if (!reauth || !Number.isFinite(reauth.raisedAt)) return false;
  const since = Math.max(reauth.raisedAt, stamp(reauth.activeAt), stamp(reauth.changeHeardAt));
  return nowMs - since < RESET_WINDOW_MS;
};
// The decision app/_layout.jsx makes for a password-changed answer while the screen is up.
export const keepReauthInPlace = (reauth, nowMs) => resetWindowOpen(reauth, nowMs);

// The account id inside a token, read WITHOUT verifying (the server is the authority) — for telling
// whether the person typing on the password screen is the one the phone was signed in as. Null when
// it can't be read.
export const tokenSub = (token) => {
  try {
    const part = String(token || '').split('.')[1];
    if (!part || typeof atob !== 'function') return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const sub = JSON.parse(atob(padded))?.sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
};

export const phoneAction = (reason, { reauthUp = false } = {}) => {
  if (reason === 'expired' || reason === 'invalid' || reason === 'missing') return 'reauth';
  if (reason === 'password_changed' && reauthUp) return 'reauth';
  return 'signout';
};

// Which session an ended-session answer is about — or null when the answer is stale and must be
// ignored. api() reads the token from storage per request, so:
//   - a request that carried a token ends that token, when it is still the live one (or memory is
//     still hydrating);
//   - a request that carried NO token ends the session held in memory when it was sent, and only
//     while that same session is still held. That is the "storage lost the token" case. A bare
//     request from a previous session that lands after a new sign-in therefore never ends the new
//     one.
export const tokenToEnd = ({ sentToken, heldAtSend, current }) => {
  if (sentToken) return current === undefined || current === sentToken ? sentToken : null;
  return typeof heldAtSend === 'string' && current === heldAtSend ? heldAtSend : null;
};

// The door flow: screens whose typed input lives only in component memory (a survey, a note, a
// walk-up voter, a practice run). Nothing that would tear them down runs while one is open — not
// an OTA reload (components/OtaUpdatePrompt.jsx), not a sign-out, not the password screen.
export const CANVASS_FLOW = /^\/(household|voter|survey-practice)\//;
export const inCanvassFlow = (path) => CANVASS_FLOW.test(path || '');
export const shouldDefer = (path, inFlight) => inCanvassFlow(path) || !!inFlight;

// The field screens where a collapsed password screen becomes a notice in the top chrome.
const FIELD_SCREENS = /^\/(map|books|building)(\/|$)/;
export const isFieldScreen = (path) => FIELD_SCREENS.test(path || '');

// React Query's retry: the same single retry as before for everything, except a 401, which can't
// succeed a second later. failureCount starts at 0.
export const retryUnless401 = (failureCount, err) => err?.status !== 401 && failureCount < 1;

// May a walk-list snapshot be written to disk right now? Never once a sign-out has begun, and
// never while signed out — privacy.html promises the copy "is deleted when you sign out".
export const mayWriteRoster = ({ signedIn, ending }) => !!signedIn && !ending;

// ── Copy ─────────────────────────────────────────────────────────────────────────────────────
// Never "you've been signed out" for a reauth: the phone keeps its saved houses in that state,
// and the privacy policy says they are deleted when you sign out.

export const REAUTH_TITLE = 'Enter your password to keep going';

export const reauthBody = (reason) =>
  reason === 'password_changed'
    ? 'Your password was changed. Enter your new password to keep going.'
    : 'For security, Doorline asks for your password again from time to time. Nothing is wrong, and what you were doing is still here.';

// The note on the sign-in screen after a deliberate sign-out.
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

// Shown on the password screen, and on the sign-in note for a changed password. Never for an
// account that can't sign in again. An item is one queued save (a door result, one voter's survey,
// a walk-up voter, a pin fix) — the same count as the map's pending badge.
export const pendingLine = (n, reason) => {
  if (!n || reason === 'deleted' || reason === 'inactive') return null;
  if (n === 1) return "1 recorded item is saved on this phone. It'll be sent when you sign in as yourself.";
  return `${n} recorded items are saved on this phone. They'll be sent when you sign in as yourself.`;
};

// The collapsed password screen, as a notice on the map, books and building screens.
export const reauthNotice = (n) => {
  if (!n) return 'Password needed. Enter it to send new work.';
  if (n === 1) return 'Password needed. 1 item is waiting to send, and your team sees it once you enter your password.';
  return `Password needed. ${n} items are waiting to send, and your team sees them once you enter your password.`;
};

// The confirm behind "Not you? Sign out" when signing out would cost something.
export const notYouConfirm = ({ pending = 0, noSignal = false } = {}) => {
  let text = 'Signing out removes your saved houses from this phone.';
  if (pending === 1) text += ' 1 saved item will go up under whoever signs in next.';
  else if (pending > 1) text += ` ${pending} saved items will go up under whoever signs in next.`;
  if (noSignal) text += " You'll need signal to sign back in.";
  return `${text} Sign out anyway?`;
};
