import { formatDateInTz, formatInTz } from '../../lib/datetime.js';

// What a client link can do right now, in words (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §G5,
// §G6, §G7, as amended by §O7). One module for the links panel's badges, the Publish confirm's last
// line, the copy-ready message's link picker and the report rows, so "usable" means one thing
// everywhere: active, not expired, not locked.
//
// The row shape is the admin share list's (routes/admin/clientReports.js shareRow): expiresAt,
// lifetimeEndsAt, isActive, hasPassword, passwordMeetsRule (true | false | null = unknown),
// lock { locked, until }, failures { last24h, last7d, total }, rotateAdvice. Old rows that predate a
// field read as "nothing to say" about it, never as a problem.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Create, Renew and Extend offer these lifetimes (§F6); a new link defaults to 90 days. */
export const EXPIRY_CHOICES = [30, 90, 180, 365];
export const DEFAULT_EXPIRY_DAYS = 90;
/** An operator-set password needs at least this many characters (§F6). */
export const PASSWORD_MIN = 12;
/** "Expires in 5 days" is warned this many days ahead. */
export const EXPIRING_SOON_DAYS = 7;

const ms = (d) => (d ? new Date(d).getTime() : null);

export const isExpired = (s, now = Date.now()) => !!s?.expiresAt && ms(s.expiresAt) <= now;
export const isLocked = (s, now = Date.now()) => !!s?.lock?.locked && (!s.lock.until || ms(s.lock.until) > now);
export const isUsable = (s, now = Date.now()) => !!s?.isActive && !isExpired(s, now) && !isLocked(s, now);
export const usableLinks = (shares, now = Date.now()) => (shares || []).filter((s) => isUsable(s, now));

/** Whole days left before a link expires (0 = later today), or null when it never expires. */
export const daysLeft = (s, now = Date.now()) => (s?.expiresAt ? Math.max(0, Math.floor((ms(s.expiresAt) - now) / DAY_MS)) : null);

const whyUnusable = (s, now) => {
  if (!s.isActive) return 'disabled';
  if (isExpired(s, now)) return 'expired';
  if (isLocked(s, now)) return 'locked';
  return null;
};

/**
 * When no link can be opened, why — and the fix (§G5): "No link yet — create one", "Your only link
 * expired — renew it", "Your only link is locked — unlock or rotate it", "Your only link is disabled —
 * enable it". Null while at least one link is usable.
 */
export const noUsableLinkReason = (shares, now = Date.now()) => {
  const list = shares || [];
  if (!list.length) return { code: 'no_link', text: 'No link yet — create one.' };
  const reasons = list.map((s) => whyUnusable(s, now));
  if (reasons.some((r) => r === null)) return null;
  const same = reasons.every((r) => r === reasons[0]) ? reasons[0] : null;
  if (list.length === 1 || same) {
    const only = list.length === 1;
    if (same === 'expired') return { code: 'expired', text: only ? 'Your only link expired — renew it.' : 'Every link has expired — renew one.' };
    if (same === 'locked') return { code: 'locked', text: only ? 'Your only link is locked — unlock or rotate it.' : 'Every link is locked — unlock or rotate one.' };
    return { code: 'disabled', text: only ? 'Your only link is disabled — enable it.' : 'Every link is disabled — enable one.' };
  }
  return { code: 'mixed', text: 'None of your links can be opened right now — renew, unlock or enable one.' };
};

/** "It shows on 2 links: Candidate, Consultant." (§G5) — or the reason none can open it. */
export const linksLine = (shares, now = Date.now()) => {
  const usable = usableLinks(shares, now);
  if (!usable.length) return { ok: false, text: noUsableLinkReason(shares, now)?.text || 'No link can open it right now.' };
  const names = usable.map((s) => s.label || 'Unlabelled link');
  return {
    ok: true,
    text: usable.length === 1 ? `It shows on 1 link: ${names[0]}.` : `It shows on ${usable.length} links: ${names.join(', ')}.`,
    expiringSoon: usable.filter((s) => {
      const d = daysLeft(s, now);
      return d != null && d < EXPIRING_SOON_DAYS;
    }),
  };
};

const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The badges a link row wears (§G7), in the order they read. Each is { key, variant, label, detail? }.
 * `detail` is the sentence the row prints under its badges. `tz` formats the lock's end.
 */
export const linkBadges = (s, { now = Date.now(), tz } = {}) => {
  const out = [];
  const expired = isExpired(s, now);
  // An expired link wears no lock: nobody can open it (the server answers 410 before any password,
  // so it can't lock anew), and Renew clears the wrong passwords with the new address (ADMINUX-8).
  const locked = !expired && isLocked(s, now);
  if (!s.isActive) out.push({ key: 'disabled', variant: 'neutral', label: 'Disabled', detail: 'Nobody can open it until you enable it.' });
  if (expired) {
    out.push({
      key: 'expired',
      variant: 'danger',
      label: 'Expired',
      detail: 'Renew gives this link a new address — send your client the new link.',
    });
  }
  if (locked) {
    out.push({
      key: 'locked',
      variant: 'danger',
      label: 'Locked',
      // A disable signed every device out, so "still work" is said only of an active link.
      detail: `${s.lock?.until ? `Locked until ${formatInTz(s.lock.until, tz)}` : 'Locked'} after 50 wrong passwords.${s.isActive ? ' Devices already signed in still work.' : ''}`,
    });
  }
  if (s.isActive && !expired && !locked) {
    const left = daysLeft(s, now);
    if (left != null && left < EXPIRING_SOON_DAYS) {
      out.push({ key: 'expiring', variant: 'warning', label: left === 0 ? 'Expires today' : `Expires in ${plural(left, 'day')}` });
    } else {
      out.push({ key: 'active', variant: 'success', label: 'Active' });
    }
  }
  // The badge is for the last 24 hours. The counts themselves are not a badge's: the row prints
  // failureLine whenever there are any (WALK-2), locked and expired links included.
  const f = s.failures || {};
  if (!locked && !expired && (f.last24h || 0) > 0) {
    out.push({ key: 'wrong', variant: 'warning', label: 'Wrong passwords' });
  }
  // Flagged only when KNOWN to be short (§F6): an older link's length is unknown until its next
  // successful unlock, and a nag on every existing link would be noise.
  if (s.passwordMeetsRule === false) {
    out.push({
      key: 'short',
      variant: 'warning',
      label: 'Short password',
      detail: `This link’s password is shorter than ${PASSWORD_MIN} characters — change it.`,
    });
  }
  // Legacy links, made before passwords and expiry were required.
  if (s.hasPassword === false) out.push({ key: 'nopw', variant: 'warning', label: 'No password', detail: 'Add a password.' });
  if (!s.expiresAt) out.push({ key: 'noexp', variant: 'warning', label: 'Never expires', detail: 'Set an expiry.' });
  return out;
};

// ── What the panel's confirms promise, true to routes/admin/clientReportShares.js (ADMINUX-8) ────

/**
 * Rotate's confirm, as two paragraphs: a new address and everyone signed out; the password, the expiry
 * and the one-year life kept (so it is never offered on an EXPIRED link — its new address would be dead
 * on arrival; Renew is the fix there); the lock and the week's wrong passwords cleared; a disabled link
 * left disabled.
 */
export const rotateConfirmLines = (s, { now = Date.now(), tz } = {}) => [
  `It gets a new address, and everyone using the old one is signed out.${s.hasPassword !== false ? ' The password stays the same.' : ''}${
    s.expiresAt ? ` It still expires ${formatDateInTz(s.expiresAt, tz)}.` : ''
  }${!isExpired(s, now) && isLocked(s, now) ? ' It also lifts the lock.' : ''}`,
  s.isActive
    ? 'Send your client the new link afterwards.'
    : 'It stays disabled — nobody can open the new address until you enable it. Then send your client the new link.',
];

/** Disable's confirm. A disable signs every device out for good: enabling it again asks for the password again. */
export const disableConfirmText = (s) =>
  `Nobody can open it until you enable it again.${s.hasPassword !== false ? ' Everyone using it now is signed out — once you enable it, they need the password again.' : ''}`;

/** Renew's line: a new address, the password kept, and a disabled link left disabled (renew touches neither). */
export const renewText = (s) =>
  `${
    s?.isActive === false
      ? 'Renew gives this link a new address. It stays disabled until you enable it — then send your client the new link.'
      : 'Renew gives this link a new address — send your client the new link.'
  }${s?.hasPassword === false ? '' : ' The password stays the same.'}`;

/**
 * "12 wrong passwords since Oct 24, 9:12 AM EDT · 30 this week · 41 in total" — only the counts above
 * zero, the first one saying what they count: "3 wrong passwords this week · 41 in total", "41 wrong
 * passwords in total". '' when there are none. `since` is the oldest wrong password in the current 24
 * hours (the server's failures.since).
 */
export const failureLine = (failures, tz) => {
  const f = failures || {};
  const parts = [];
  if (f.last24h) parts.push([f.last24h, f.since ? `since ${formatInTz(f.since, tz)}` : 'in the last day']);
  if (f.last7d) parts.push([f.last7d, 'this week']);
  if (f.total) parts.push([f.total, 'in total']);
  return parts
    .map(([n, when], i) => `${i === 0 ? plural(n, 'wrong password') : Number(n).toLocaleString('en-US')} ${when}`)
    .join(' · ');
};

/**
 * Extend's choices (§F6, §G7): the resulting date for each lifetime — max(current expiry, now + days),
 * capped at a year from when the link was made — and only the ones that make the link last LONGER.
 * Choices that cap to the same date collapse into one. Each is { days, until: Date, capped }.
 */
export const extendChoices = (s, now = Date.now()) => {
  const current = ms(s?.expiresAt);
  const cap = ms(s?.lifetimeEndsAt);
  const out = [];
  for (const days of EXPIRY_CHOICES) {
    let until = now + days * DAY_MS;
    if (current && current > until) until = current;
    let capped = false;
    if (cap && until > cap) {
      until = cap;
      capped = true;
    }
    if (current && until <= current) continue;
    if (out.some((c) => c.until.getTime() === until)) continue;
    out.push({ days, until: new Date(until), capped });
  }
  return out;
};

/** The hub URL a client opens, and a report's deep link. */
export const shareUrl = (origin, token) => `${origin}/r/${token}`;
export const reportUrl = (origin, token, reportId) => `${origin}/r/${token}/reports/${reportId}`;

/** A long URL shortened for a narrow row: 'doorline.app/r/e67Tq…'. */
export const shortUrl = (url) => {
  const bare = String(url || '').replace(/^https?:\/\//, '');
  const cut = bare.indexOf('/r/');
  if (cut === -1) return bare;
  const head = bare.slice(0, cut + 3);
  const token = bare.slice(cut + 3);
  return token.length > 6 ? `${head}${token.slice(0, 5)}…` : bare;
};

/**
 * "Opened via Candidate: about 2 visits" (§F7). `views.byLink` maps a link id to its counts; a link
 * since deleted keeps its counts under "a deleted link". People signed in to the organization and
 * Doorline staff are listed apart, and the pre-upgrade view counter is kept as its own line.
 */
export const opensSummary = (report, shares) => {
  const byId = new Map((shares || []).map((s) => [String(s.id), s.label || 'Unlabelled link']));
  const byLink = Object.entries(report?.views?.byLink || {})
    .map(([id, c]) => ({ id, label: byId.get(String(id)) || 'a deleted link', opens: c?.opens || 0, lastOpenedAt: c?.lastOpenedAt || null }))
    .filter((x) => x.opens > 0)
    .sort((a, b) => b.opens - a.opens);
  const m = report?.views?.members || {};
  const team = (m.admins?.opens || 0) + (m.leads?.opens || 0) + (m.others?.opens || 0);
  const staff = m.staff?.opens || 0;
  const legacy = report?.viewCount || 0;
  return { byLink, team, staff, legacy };
};

/** The one-line form of opensSummary for a row: "Opened via Candidate: about 2 visits · Consultant: about 1". */
export const opensLine = (report, shares) => {
  const o = opensSummary(report, shares);
  const parts = o.byLink.map((x, i) => (i === 0 ? `Opened via ${x.label}: about ${plural(x.opens, 'visit')}` : `${x.label}: about ${x.opens.toLocaleString('en-US')}`));
  if (o.team) parts.push(`your organization: ${plural(o.team, 'visit')}`);
  if (o.staff) parts.push(`Doorline staff: ${plural(o.staff, 'visit')}`);
  if (o.legacy) parts.push(`${plural(o.legacy, 'view')} before per-link counts`);
  if (!parts.length) return '';
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
};
