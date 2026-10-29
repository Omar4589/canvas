import { formatDateInTz, formatInTz } from '../../lib/datetime.js';
import { formatDayOf, formatPeriod } from './reportDates.js';

// What a report's link can do right now, in words (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1, §D2, §D6;
// first written for docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §G5–§G7). One module for Share's
// badges, advice and confirms, the report rows' and the builder's link line and opens line, and the
// old-links card, so "usable" means one thing everywhere: active, not expired, not locked.
//
// Every report has ONE link of its own (§C2) — Share makes it and from then on shows that same link. A
// link to ALL of a campaign's reports (reportId null, or missing on a link made before links to one
// report) is an old link: it never counts as opening a report (linksFor, primaryLinkOf), and it is
// listed only on the old-links card (allReportsLinksOf) until a Heroku setting turns them all off
// (`allReportsRetired`, §C1). A report that got two links before this change keeps both: Share manages
// the primary one and lists the rest (extraLinksOf).
//
// The row shape is GET /admin/client-reports/shares's (contract K1): expiresAt, lifetimeEndsAt,
// isActive, hasPassword, passwordMeetsRule (true | false | null = unknown), lock { locked, until },
// failures { last24h, since, last7d, total }, rotateAdvice, lastAccessedAt, createdAt, and the report
// it opens — reportId with report { id, weekStart, weekEnd, scopeLabel, takenDown, seriesId } — plus
// allReports, passwordCopyable, passwordViewable, passwordHiddenReason ('staff' | 'unavailable' | null),
// samePasswordCount and samePasswordTabs. Old rows that predate a field read as "nothing to say" about
// it, never as a problem.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Create, Renew and Extend offer these lifetimes (§F6); a new link defaults to 90 days. */
export const EXPIRY_CHOICES = [30, 90, 180, 365];
export const DEFAULT_EXPIRY_DAYS = 90;
/** A password the operator types needs at least this many characters (§F6). */
export const PASSWORD_MIN = 12;
/** "Expires in 5 days" is warned this many days ahead. */
export const EXPIRING_SOON_DAYS = 7;

const ms = (d) => (d ? new Date(d).getTime() : null);

export const isExpired = (s, now = Date.now()) => !!s?.expiresAt && ms(s.expiresAt) <= now;
export const isLocked = (s, now = Date.now()) => !!s?.lock?.locked && (!s.lock.until || ms(s.lock.until) > now);
export const isUsable = (s, now = Date.now()) => !!s?.isActive && !isExpired(s, now) && !isLocked(s, now);
export const usableLinks = (shares, now = Date.now()) => (shares || []).filter((s) => isUsable(s, now));

// ── Which links are a report's (§C2, §D6) ──────────────────────────────────────────────────────────

const isAllReports = (s) => s?.reportId == null;

// Newest first, by when each link was made; the list's own order (the server's, newest first) breaks
// ties and places a row without a date.
const newestFirst = (links) =>
  links
    .map((s, i) => ({ s, i, at: ms(s.createdAt) ?? -Infinity }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map((x) => x.s);

/** This report's own links — never a link to all your reports (§D6), never another report's. */
export const linksFor = (shares, reportId) => (shares || []).filter((s) => !isAllReports(s) && String(s.reportId) === String(reportId));

/** The same list, by the name Take down's callers know it by. */
export const singleLinksOf = linksFor;

/**
 * The link Share manages for a report (§C2): its newest usable one, else its newest — the server's
 * "primary" (POST answers REPORT_HAS_LINK with the same one). Null when the report has no link of its own.
 */
export const primaryLinkOf = (shares, reportId, now = Date.now()) => {
  const own = newestFirst(linksFor(shares, reportId));
  return own.find((s) => isUsable(s, now)) || own[0] || null;
};

/** A report's other links, made before one link per report (§C2): Share lists each, with Delete. */
export const extraLinksOf = (shares, reportId, now = Date.now()) => {
  const primary = primaryLinkOf(shares, reportId, now);
  return newestFirst(linksFor(shares, reportId)).filter((s) => s !== primary);
};

/** The campaign's old links to all your reports (§C1), newest first — the old-links card's rows. */
export const allReportsLinksOf = (shares) => newestFirst((shares || []).filter(isAllReports));

/**
 * Does an old link to all your reports still open this campaign's reports (§D2, §D5)? Active and not
 * expired — a locked one still serves the devices signed in to it — and never once the switch
 * (RETIRE_ALL_REPORTS_LINKS) has turned them off.
 */
export const hasWorkingAllReportsLink = (shares, allReportsRetired = false, now = Date.now()) =>
  !allReportsRetired && allReportsLinksOf(shares).some((s) => s.isActive && !isExpired(s, now));

/**
 * The report row's (and the builder's) line about its link (Part 1 §5), from its primary link — or null
 * when there's nothing to say: a draft, a list not loaded yet (`shares` null), a taken-down report with
 * no link (Share can't make one until it's back up).
 *
 *   "Link: active · expires Jan 25"                       (muted)
 *   "No link of its own yet — Share makes one."           (warning; muted while an old link to all your
 *                                                          reports still shows the report)
 *   "Link expired Jan 25 — Share to renew it."            (warning)
 *   "Link locked after 50 wrong passwords — Share to unlock it."   (danger)
 *   "Link turned off — Share to turn it on."              (warning)
 *   "Its link shows “taken down” until you put it back up."        (muted, a taken-down report)
 *
 * Turned off and expired come first — a client opening the link meets those before the report — then
 * taken down, then the lock (signed-in devices still read the report).
 */
export const linkStatusLine = ({ shares, report, now = Date.now(), tz, allReportsRetired = false }) => {
  if (!report || report.status !== 'published' || !shares) return null;
  const link = primaryLinkOf(shares, report.id ?? report._id, now);
  if (!link) {
    if (report.takenDownAt) return null;
    return { text: 'No link of its own yet — Share makes one.', tone: hasWorkingAllReportsLink(shares, allReportsRetired, now) ? 'muted' : 'warning' };
  }
  if (!link.isActive) return { text: 'Link turned off — Share to turn it on.', tone: 'warning' };
  if (isExpired(link, now)) return { text: `Link expired ${formatDayOf(link.expiresAt, tz)} — Share to renew it.`, tone: 'warning' };
  if (report.takenDownAt) return { text: 'Its link shows “taken down” until you put it back up.', tone: 'muted' };
  if (isLocked(link, now)) return { text: 'Link locked after 50 wrong passwords — Share to unlock it.', tone: 'danger' };
  return { text: link.expiresAt ? `Link: active · expires ${formatDayOf(link.expiresAt, tz)}` : 'Link: active', tone: 'muted' };
};

/**
 * What Share says in place of the message while the report's link can't be opened (code review CC-1):
 * the message is built only from a link the client can open — on, not expired, not locked (isUsable) —
 * so this says what to do first, in the order the row's link line reads them. Null when it can be sent.
 */
export const beforeSendText = (s, now = Date.now()) => {
  if (!s || isUsable(s, now)) return null;
  if (!s.isActive) return 'Turn it on before you send it.';
  if (isExpired(s, now)) return 'Renew it before you send it.';
  return 'Unlock it before you send it.';
};

/**
 * Take down's line (§D2): "Its link shows “taken down” until you put it back up." — when the report has
 * a link of its own a client can still open (active and not expired; a locked one opens again once the
 * lock lifts). '' when it has none: nothing to say. `singles` is the report's own links (linksFor).
 */
export const takeDownLinksText = (singles, now = Date.now()) =>
  (singles || []).some((s) => s.isActive && !isExpired(s, now)) ? 'Its link shows “taken down” until you put it back up.' : '';

const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * "About 5 visits · your organization: 2 visits" (Part 1 §5): every visit the report ever had through
 * any link — its own, an extra one, an old link to all your reports, a link since deleted — summed, then
 * the organization's own people apart, so the operator checking their own work never inflates the
 * client's count. Doorline staff's visits, and a report's views from before per-link counts, are said
 * only when there are any. '' when there are none.
 */
export const opensLine = (report) => {
  const visits = Object.values(report?.views?.byLink || {}).reduce((n, c) => n + (Number(c?.opens) || 0), 0);
  const m = report?.views?.members || {};
  const team = (m.admins?.opens || 0) + (m.leads?.opens || 0) + (m.others?.opens || 0);
  const staff = m.staff?.opens || 0;
  const legacy = report?.viewCount || 0;
  const parts = [];
  if (visits) parts.push(`about ${plural(visits, 'visit')}`);
  if (team) parts.push(`your organization: ${plural(team, 'visit')}`);
  if (staff) parts.push(`Doorline staff: ${plural(staff, 'visit')}`);
  if (legacy) parts.push(`${plural(legacy, 'view')} before per-link counts`);
  if (!parts.length) return '';
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
};

// ── A link's state, in Share (§D1 "Status"): one vocabulary — turned off, turn on, new address ────

/** Whole days left before a link expires (0 = later today), or null when it never expires. */
export const daysLeft = (s, now = Date.now()) => (s?.expiresAt ? Math.max(0, Math.floor((ms(s.expiresAt) - now) / DAY_MS)) : null);

/**
 * The badges a link wears (§G7), in the order they read. Each is { key, variant, label, detail? }; `detail`
 * is the sentence printed under the badges. `tz` formats the lock's end.
 */
export const linkBadges = (s, { now = Date.now(), tz } = {}) => {
  const out = [];
  const expired = isExpired(s, now);
  // An expired link wears no lock: nobody can open it (the server answers 410 before any password,
  // so it can't lock anew), and Renew clears the wrong passwords with the new address (ADMINUX-8).
  const locked = !expired && isLocked(s, now);
  if (!s.isActive) out.push({ key: 'off', variant: 'neutral', label: 'Turned off', detail: 'Nobody can open it until you turn it on.' });
  if (expired) {
    out.push({ key: 'expired', variant: 'danger', label: 'Expired', detail: 'Renew gives this link a new address — send your client the new link.' });
  }
  if (locked) {
    out.push({
      key: 'locked',
      variant: 'danger',
      label: 'Locked',
      // Turning a link off signed every device out, so "still work" is said only of a link that's on.
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
  // The badge is for the last 24 hours. The counts themselves are not a badge's: Share prints
  // failureLine whenever there are any (WALK-2), locked and expired links included.
  const f = s.failures || {};
  if (!locked && !expired && (f.last24h || 0) > 0) out.push({ key: 'wrong', variant: 'warning', label: 'Wrong passwords' });
  // Flagged only when KNOWN to be short (§F6): an older link's length is unknown until its next
  // successful unlock, and a nag on every existing link would be noise.
  if (s.passwordMeetsRule === false) {
    out.push({ key: 'short', variant: 'warning', label: 'Short password', detail: `This link’s password is shorter than ${PASSWORD_MIN} characters — change it.` });
  }
  return out;
};

/**
 * What a lock, or a week of wrong passwords, says to do (§O7): 50 wrong passwords is never the client,
 * so give the link a new address. { text, tone } or null — never on an expired link, which Renew gives
 * a new address anyway.
 */
export const lockAdvice = (s, now = Date.now()) => {
  if (!s || isExpired(s, now)) return null;
  if (isLocked(s, now)) {
    return s.rotateAdvice === false ? null : { text: 'Someone else has this link — 50 wrong passwords is never your client. Give it a new address.', tone: 'danger' };
  }
  if (s.rotateAdvice) return { text: '50 or more wrong passwords this week — someone else may have this link. Give it a new address.', tone: 'warning' };
  return null;
};

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
  return parts.map(([n, when], i) => `${i === 0 ? plural(n, 'wrong password') : Number(n).toLocaleString('en-US')} ${when}`).join(' · ');
};

// ── What each confirm promises, true to routes/admin/clientReportShares.js (ADMINUX-8) ──────────────

export const NEW_ADDRESS_TITLE = 'Give this link a new address?';
export const DELETE_LINK_TITLE = 'Delete this link?';
export const DELETE_LINK_TEXT = 'Anyone using it loses access for good. This can’t be undone.';

/**
 * New address's confirm, as two paragraphs: a new address and everyone signed out; the password, the
 * expiry and the one-year life kept (so it is never offered on an EXPIRED link — its new address would
 * be dead on arrival; Renew is the fix there); the lock and the week's wrong passwords cleared; a link
 * that's turned off left turned off.
 */
export const rotateConfirmLines = (s, { now = Date.now(), tz } = {}) => [
  `It gets a new address, and everyone using the old one is signed out.${s.hasPassword !== false ? ' The password stays the same.' : ''}${
    s.expiresAt ? ` It still expires ${formatDateInTz(s.expiresAt, tz)}.` : ''
  }${!isExpired(s, now) && isLocked(s, now) ? ' It also lifts the lock.' : ''}`,
  s.isActive ? 'Send your client the new link afterwards.' : 'It stays turned off — nobody can open the new address until you turn it on.',
];

/** Renew's line: a new address, the password kept, and a link that's turned off left turned off (renew touches neither). */
export const renewText = (s) =>
  `${
    s?.isActive === false
      ? 'Renew gives this link a new address. It stays turned off until you turn it on — then send your client the new link.'
      : 'Renew gives this link a new address — send your client the new link.'
  }${s?.hasPassword === false ? '' : ' The password stays the same.'}`;

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

// ── Passwords in Share (§C3, §D1) ──────────────────────────────────────────────────────────────────

/** "Paid team · Oct 12 – Oct 18": the tab and dates a link's report is known by. */
const reportNameOf = (r) => `${r.scopeLabel || 'Whole campaign'} · ${formatPeriod(r.weekStart, r.weekEnd)}`;

// The same tab: the report's series (seriesId); a report from before series (none) by its old series
// key — which a link's row carries only if the server sends it, so without it such a link is offered,
// never picked.
const onSameTab = (linked, report) => {
  if (report?.seriesId) return !!linked?.seriesId && String(linked.seriesId) === String(report.seriesId);
  return !linked?.seriesId && !!report?.seriesKey && linked?.seriesKey === report.seriesKey;
};

/**
 * Same as …'s source for a report's new link (§C3, §D1): the newest link whose password Doorline kept
 * (passwordCopyable) — this report's tab's, picked for you: "Same as your last link (Paid team · Oct 12 –
 * Oct 18)"; else the campaign's newest on another tab, offered but not picked, since that tab may go to
 * someone else: "Same as the Whole campaign · Oct 12 – Oct 18 link". Never a link to all your reports (no
 * such password is kept), never one whose report is gone. { link, sameTab, label } or null.
 */
export const sameAsSourceOf = (shares, report) => {
  const kept = newestFirst((shares || []).filter((s) => !isAllReports(s) && s.passwordCopyable === true && s.report));
  const mine = kept.find((s) => onSameTab(s.report, report));
  if (mine) return { link: mine, sameTab: true, label: `Same as your last link (${reportNameOf(mine.report)})` };
  if (kept[0]) return { link: kept[0], sameTab: false, label: `Same as the ${reportNameOf(kept[0].report)} link` };
  return null;
};

/** Create link's refusals that Share words itself (§D1); null for the rest, which read the server's sentence. */
export const createErrorText = (err) =>
  err?.code === 'PASSWORD_NOT_VIEWABLE' || err?.code === 'SOURCE_NOT_FOUND'
    ? 'Your last link’s password can’t be copied any more — choose Make one up for me or Type my own.'
    : null;

/**
 * Change password's offer (§C3, §D1): "Also change it on the 3 other links that use this password
 * (Whole campaign, Paid team)" — the campaign's other links with the same password, and the tabs they're
 * on. Null when there are none (links to all your reports are never counted).
 */
export const alsoChangeLine = (s) => {
  const n = Number(s?.samePasswordCount) || 0;
  if (n <= 0) return null;
  const tabs = [...new Set((s.samePasswordTabs || []).filter(Boolean))];
  return `Also change it on the ${n === 1 ? '1 other link that uses' : `${n.toLocaleString('en-US')} other links that use`} this password${tabs.length ? ` (${tabs.join(', ')})` : ''}`;
};

/**
 * "Changed on 1 of the 3 other links — the rest were changed by someone else a moment ago; check their
 * passwords." — when the change reached fewer links than the line offered (`changed` from the answer
 * against the count offered: two overlapping changes can skip links without either seeing a skip). None
 * reached reads as that, never "Changed on 0" (code review CC-7): "It wasn’t changed on the other link —
 * someone changed it a moment ago; check its password.", or "…on the other 3 links — someone changed them
 * a moment ago; check their passwords." One offered is never partly changed. Null otherwise, or when the
 * answer didn't say.
 */
export const fewerChangedLine = (offered, changed) => {
  if (!(offered > 0) || changed == null || changed >= offered) return null;
  if (changed <= 0) {
    return offered === 1
      ? 'It wasn’t changed on the other link — someone changed it a moment ago; check its password.'
      : `It wasn’t changed on the other ${offered} links — someone changed them a moment ago; check their passwords.`;
  }
  return `Changed on ${changed} of the ${offered} other links — the rest were changed by someone else a moment ago; check their passwords.`;
};

// ── The old-links card (§C1, Part 1 §3) ────────────────────────────────────────────────────────────

/** "Candidate", or "A link made Jul 3" for one without a label — never "Unlabelled link". */
const linkNameOf = (s, tz) => s.label || (s.createdAt ? `A link made ${formatDayOf(s.createdAt, tz)}` : 'A link');

/**
 * Share's line for a report's extra link (§C2): "Also opens this report: Board · made Oct 25", or
 * "Also opens this report: a link made Oct 25" without a label.
 */
export const extraLinkLine = (s, tz) => {
  const made = s.createdAt ? formatDayOf(s.createdAt, tz) : '';
  if (s.label) return `Also opens this report: ${s.label}${made ? ` · made ${made}` : ''}`;
  return `Also opens this report: ${made ? `a link made ${made}` : 'a link'}`;
};

/** An old link that still opens every report: before the switch, turned on and not expired. */
export const isWorkingOldLink = (s, { now = Date.now(), allReportsRetired = false } = {}) => !allReportsRetired && !!s?.isActive && !isExpired(s, now);

/**
 * An old link's row on the card, saying what it does now: "Candidate · still opens every report · last
 * opened Oct 26", "A link made Jul 3 · expired Oct 30", "Board · turned off". Once the switch has turned
 * them all off, the card's own words say so, and a row is the link and when it was last opened.
 */
export const oldLinkLine = (s, { now = Date.now(), tz, allReportsRetired = false } = {}) => {
  const name = linkNameOf(s, tz);
  const opened = s.lastAccessedAt ? ` · last opened ${formatDayOf(s.lastAccessedAt, tz)}` : '';
  if (allReportsRetired) return `${name}${opened}`;
  if (!s.isActive) return `${name} · turned off`;
  if (isExpired(s, now)) return `${name} · expired ${formatDayOf(s.expiresAt, tz)}`;
  return `${name} · still opens every report${opened}`;
};

/** Delete's confirm on the card, by the link's state (Part 1 §3). */
export const oldLinkDeleteText = (s, { now = Date.now(), allReportsRetired = false } = {}) => {
  if (allReportsRetired) return 'It no longer works. This removes it from your list.';
  if (isWorkingOldLink(s, { now })) {
    return 'Your client loses every report on it now, not on the day Doorline turns these off. Send them each report’s own link first. This can’t be undone.';
  }
  return 'Nobody can open it. This removes it from your list.';
};

// ── Addresses ──────────────────────────────────────────────────────────────────────────────────────

/** The address a client opens: /r/<token> — a report's own link opens that report (§D1). */
export const shareUrl = (origin, token) => `${origin}/r/${token}`;

/** A long URL shortened for a narrow row: 'doorline.app/r/e67Tq…'. */
export const shortUrl = (url) => {
  const bare = String(url || '').replace(/^https?:\/\//, '');
  const cut = bare.indexOf('/r/');
  if (cut === -1) return bare;
  const head = bare.slice(0, cut + 3);
  const token = bare.slice(cut + 3);
  return token.length > 6 ? `${head}${token.slice(0, 5)}…` : bare;
};
