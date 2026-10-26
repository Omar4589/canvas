import { formatDateInTz, formatInTz } from '../../lib/datetime.js';
import { formatPeriod } from './reportDates.js';

// What a client link can do right now, in words (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §G5,
// §G6, §G7, as amended by §O7). One module for the links panel's badges, the Publish confirm's last
// line, the copy-ready message's link picker and the report rows, so "usable" means one thing
// everywhere: active, not expired, not locked.
//
// The row shape is the admin share list's (routes/admin/clientReports.js shareRow): expiresAt,
// lifetimeEndsAt, isActive, hasPassword, passwordMeetsRule (true | false | null = unknown),
// lock { locked, until }, failures { last24h, last7d, total }, rotateAdvice, and which reports it
// opens — reportId (null = all of the campaign's published reports) with report { id, weekStart,
// weekEnd, scopeLabel } for a link to one (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D). Old rows
// that predate a field read as "nothing to say" about it, never as a problem.

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

// ── Which links can open a report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, contract K8) ────────
// A link opens all of the campaign's published reports (reportId null, or absent on a link made before
// links to one report) or just one. Every place that asks "can a link open this report?" filters the
// campaign's links through linksFor FIRST, then asks usableLinks / noUsableLinkReason / linksLine as
// before — a link to another report never counts. The server's linkState filters the same way
// (reportId in [null, this report]).

const isAllReports = (s) => s?.reportId == null;

/** The links that can open this report: every all-reports link, and this report's own one-report links. */
export const linksFor = (shares, reportId) => (shares || []).filter((s) => isAllReports(s) || String(s.reportId) === String(reportId));

/** Only this report's one-report links — the ones its Take down and Delete confirms name. */
export const singleLinksOf = (shares, reportId) => (shares || []).filter((s) => !isAllReports(s) && String(s.reportId) === String(reportId));

/**
 * What a link opens, in the words the links list and Share name it by (§D): "opens all your reports";
 * "opens only the Oct 19 – Oct 25 report (Whole campaign)" — or, beside that report itself (Share,
 * `thisReportId`), "opens only this report". A link whose report was deleted a moment ago (the share
 * row's `report` is null — only reachable mid-race): "opens only a deleted report".
 */
export const linkOpens = (s, { thisReportId = null } = {}) => {
  if (isAllReports(s)) return 'opens all your reports';
  if (thisReportId != null && String(s.reportId) === String(thisReportId)) return 'opens only this report';
  if (!s.report) return 'opens only a deleted report';
  return `opens only the ${formatPeriod(s.report.weekStart, s.report.weekEnd)} report${s.report.scopeLabel ? ` (${s.report.scopeLabel})` : ''}`;
};

/** "Board — opens only the Oct 19 – Oct 25 report (Whole campaign)": who a link is for, and what it opens. */
export const linkName = (s, opts) => `${s.label || 'Unlabelled link'} — ${linkOpens(s, opts)}`;

/** "Board", "Board and Donor", "Board, Donor and Field". */
const andList = (xs) => (xs.length <= 1 ? xs[0] || '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Take down's line naming the report's one-report links (§D, from singleLinksOf): "Board, a link to
 * just this report, shows “taken down” until you put it back up." Only the ones a client can still
 * open — active and not expired (a locked one opens again once the lock lifts); the rest show nothing
 * already. '' when there are none.
 */
export const takeDownLinksText = (singles, now = Date.now()) => {
  const open = (singles || []).filter((s) => s.isActive && !isExpired(s, now));
  if (!open.length) return '';
  const names = andList(open.map((s) => s.label || 'Unlabelled link'));
  return open.length === 1
    ? `${names}, a link to just this report, shows “taken down” until you put it back up.`
    : `${names}, links to just this report, show “taken down” until you put it back up.`;
};

/**
 * Delete's line naming the report's one-report links (§D, from singleLinksOf) — deleting a report
 * deletes them: "Its link Board (just this report) stops working for good." Only the ones a client can
 * still open — active and not expired, as Take down's line (takeDownLinksText); '' when none.
 */
export const deleteLinksText = (singles, now = Date.now()) => {
  const open = (singles || []).filter((s) => s.isActive && !isExpired(s, now));
  if (!open.length) return '';
  const names = andList(open.map((s) => s.label || 'Unlabelled link'));
  return open.length === 1 ? `Its link ${names} (just this report) stops working for good.` : `Its links ${names} (just this report) stop working for good.`;
};

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

// ── Which links open THIS report, in words (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, contract K8) ──
// "Can a link open this report?" is asked of the links that can open it (linksFor) — a link to another
// report never counts. When none of them can be opened, the reason is theirs first — expired, locked or
// disabled, each with its fix (renew, unlock or rotate, enable) — and only when NO link of any state
// opens this report while the campaign has links to other reports do the words say so ('other_reports';
// Share makes one once the report is published); with no link at all, "No link yet". The server's
// linkState (services/reports/clientReportChecks.js, checks.links) follows the same rule (code review
// round 1, LINK-2: an expired all-reports link beside a working link to another report reads "renew it").

const OTHER_REPORTS_TEXT = {
  published: 'No link opens this report — your links open other reports. Share makes one.',
  draft: 'No link opens this report yet. After you publish, Share makes one.',
};
// No link at all, on a draft: nothing can be made from where this is read (Before you publish, the
// Publish confirm) — Share makes one once it is published (code review round 2, FRESH-8).
const NO_LINK_DRAFT = { code: 'no_link', text: 'No link yet — after you publish, Share makes one.' };

/**
 * Why no link can open this report — { code, text } — or null when one can. `shares` is the campaign's
 * links list, or null while it isn't loaded (or failed to load): then `server` decides, the checks'
 * count made when the report was read (checks.links: { usable, labels, reason }, which counts only the
 * links that can open this report too). The server doesn't say how many links there are, so a link
 * that can't be opened is worded for any number of them.
 */
export const reportLinkReason = ({ shares, reportId, published = false, server = null }) => {
  const otherReports = { code: 'other_reports', text: published ? OTHER_REPORTS_TEXT.published : OTHER_REPORTS_TEXT.draft };
  const noLink = published ? noUsableLinkReason([]) : NO_LINK_DRAFT;
  if (!shares) {
    if (!server || (server.usable ?? 0) > 0) return null;
    if (server.reason === 'other_reports') return otherReports;
    if (server.reason === 'no_link') return noLink;
    return { code: server.reason || 'mixed', text: 'None of your links can be opened right now — renew, unlock or enable one.' };
  }
  const mine = linksFor(shares, reportId);
  if (mine.length) return noUsableLinkReason(mine);
  return shares.length ? otherReports : noLink;
};

/**
 * The Publish confirm's link line (linksLine) for this report: "It shows on 1 link: Candidate." over
 * the links that can open it, or why none can, in reportLinkReason's words. Before the list loads, the
 * server's names for them (it counts no expiry, so none is said to be expiring soon); with neither,
 * no line (text '').
 */
export const reportLinksLine = ({ shares, reportId, published = false, server = null }) => {
  const reason = reportLinkReason({ shares, reportId, published, server });
  if (reason) return { ok: false, text: reason.text, expiringSoon: [] };
  if (!shares) {
    const labels = server?.labels || [];
    return labels.length ? linksLine(labels.map((label, i) => ({ id: `server-${i}`, label, isActive: true }))) : { ok: true, text: '', expiringSoon: [] };
  }
  return linksLine(linksFor(shares, reportId));
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
