import { api } from './api';
import { adoptRenewedToken, getCurrentToken } from './authState';
import { saveCurrentUser, saveMemberships } from './cache';

// Mobile caches user + memberships at LOGIN ONLY (app/login.jsx) and never refetched them.
// If a role changes server-side mid-session — promoted to lead, demoted to canvasser,
// removed from an org — the app keeps rendering whatever the login snapshot said, and every
// admin query 403s onto a dead Retry button. This re-pulls the identity payload and re-saves
// it, so the role gates (app/index.jsx, admin/_layout.jsx, CanvasserDrawer) decide on fresh
// data.
//
// It is also how a used sign-in stays alive: about once a day /auth/me answers with an
// extended token for this same session, which is adopted here (docs/PROPOSAL_SESSION_EXPIRY.md).
//
// Cheap (one small request), idempotent, and safe offline: on any failure we keep the cached
// copy and try again next time. Being offline never signs anyone out; only the server saying the
// session ended does, and that is handled centrally in lib/api.js.
let lastAt = 0;
const THROTTLE_MS = 60 * 1000;

export async function refreshSession({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastAt < THROTTLE_MS) return null;
  lastAt = now;
  const sent = getCurrentToken();
  try {
    const res = await api('/auth/me');
    // Answered for a session that is gone (signed out, or another person signed in meanwhile):
    // its identity must not be saved over the current one.
    if (getCurrentToken() !== sent) return null;
    if (res?.user) await saveCurrentUser(res.user);
    await saveMemberships(res?.memberships || []);
    // After the saves, on purpose: role recovery (app/_layout.jsx recoverRole) reads them, and a
    // storage hiccup adopting the token must never skip them.
    if (res?.token) {
      try {
        await adoptRenewedToken(sent, res.token);
      } catch {
        // the current token keeps working; the next foreground tries again
      }
    }
    return res;
  } catch {
    return null;
  }
}
