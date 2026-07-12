import { api } from './api';
import { saveCurrentUser, saveMemberships } from './cache';

// Mobile caches user + memberships at LOGIN ONLY (app/login.jsx) and never refetched them.
// If a role changes server-side mid-session — promoted to lead, demoted to canvasser,
// removed from an org — the app keeps rendering whatever the login snapshot said, and every
// admin query 403s onto a dead Retry button. This re-pulls the identity payload and re-saves
// it, so the role gates (app/index.jsx, admin/_layout.jsx, CanvasserDrawer) decide on fresh
// data.
//
// Cheap (one small request), idempotent, and safe offline: on any failure we keep the cached
// copy and try again next time, so a canvasser in a dead zone is never logged out or blocked.
let lastAt = 0;
const THROTTLE_MS = 60 * 1000;

export async function refreshSession({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastAt < THROTTLE_MS) return null;
  lastAt = now;
  try {
    const res = await api('/auth/me');
    if (res?.user) await saveCurrentUser(res.user);
    await saveMemberships(res?.memberships || []);
    return res;
  } catch {
    return null;
  }
}
