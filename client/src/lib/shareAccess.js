// Per-share unlock token (issued after a correct share-link password), and the report pages'
// once-a-day "opened" marker. Every read and write is wrapped: storage throws in some private
// windows and with site data blocked, and the pages must still work without it.
//
// Where the token lives follows "Keep me signed in on this device" (docs/PROPOSAL_CLIENT_REPORTS_
// UPGRADE.md §F6): unticked, sessionStorage — this tab only, gone when it closes; ticked,
// localStorage — as long as the token's own 30 days (some phones clear it sooner). Only one copy is
// ever kept, so signing in one way replaces the other, and signing out clears both.
const keyFor = (token) => `doorline.share.${token}`;
const openedKeyFor = (token) => `doorline.share.opened.${token}`;

export const shareAccessKey = keyFor;

const storageOf = (kind) => {
  try {
    return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
};
const read = (kind, key) => {
  try {
    return storageOf(kind)?.getItem(key) || null;
  } catch {
    return null;
  }
};
const write = (kind, key, value) => {
  try {
    if (value) storageOf(kind)?.setItem(key, value);
    else storageOf(kind)?.removeItem(key);
  } catch {
    /* ignore */
  }
};

// This tab's sign-in wins over a remembered one: it is the more recent choice on this tab.
export const getShareAccess = (token) => read('session', keyFor(token)) || read('local', keyFor(token));

/** Whether the token this tab would use is the remembered one (localStorage). */
export const isShareAccessRemembered = (token) => !read('session', keyFor(token)) && !!read('local', keyFor(token));

export const setShareAccess = (token, accessToken, { remember = false } = {}) => {
  write('session', keyFor(token), accessToken && !remember ? accessToken : null);
  write('local', keyFor(token), accessToken && remember ? accessToken : null);
};

export const clearShareAccess = (token) => setShareAccess(token, null);

// ── "Opened" (§F7): one ping per report per browser per day ─────────────────────────────────
// One key per link — { day, reports: [ids] } — so the list empties itself when the day turns
// instead of piling up a key per report forever. The day is this browser's own calendar day.
export const localDay = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const openedToday = (token, now) => {
  try {
    const v = JSON.parse(read('local', openedKeyFor(token)) || 'null');
    return v && v.day === localDay(now) && Array.isArray(v.reports) ? v.reports : [];
  } catch {
    return [];
  }
};

export const wasOpenedToday = (token, reportId, now = new Date()) => openedToday(token, now).includes(String(reportId));

export const markOpenedToday = (token, reportId, now = new Date()) => {
  const reports = openedToday(token, now);
  if (reports.includes(String(reportId))) return;
  write('local', openedKeyFor(token), JSON.stringify({ day: localDay(now), reports: [...reports, String(reportId)] }));
};
