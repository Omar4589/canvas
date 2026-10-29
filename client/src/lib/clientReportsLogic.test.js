import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, periodDays, formatPeriod, gapBetween, gapsAbove } from '../components/clientReports/reportDates.js';
import { buildStateOf, displayStatusOf, buildPollInterval, isLiveBuild, freshestBuild } from '../components/clientReports/buildState.js';
import {
  linkBadges,
  lockAdvice,
  extendChoices,
  usableLinks,
  failureLine,
  opensLine,
  shortUrl,
  shareUrl,
  rotateConfirmLines,
  renewText,
  linksFor,
  singleLinksOf,
  primaryLinkOf,
  extraLinksOf,
  allReportsLinksOf,
  hasWorkingAllReportsLink,
  beforeSendText,
  fewerChangedLine,
} from '../components/clientReports/linkState.js';
import * as linkStateModule from '../components/clientReports/linkState.js';
import * as copyMessageModule from '../components/clientReports/copyMessage.js';
import { copyMessageFor, messageReportOf } from '../components/clientReports/copyMessage.js';
import { allTimeChoice, choiceText, dateChoices, duplicateText, monthsLabel, totalsSentence, weekName, weekNudge } from '../components/clientReports/newReportChoices.js';
import { GOT_IT, GUIDE_TITLE, HELP_LINE, HELP_PATH, HOW_IT_WORKS_LINK, INTRO, PHONE_STEPS, STEPS } from '../components/clientReports/howItWorksCopy.js';
import { rowsFor, toggleChart, toggleMap, setHeadline, showAll, showNone, depsMapOf, closeUnderDeps } from '../components/clientReports/questionRules.js';
import { clientReportHistoryLine, isClientReportField, earlierTextSummary, labelForField, reportRowName } from './campaignHistory.js';

// The Client Reports pages' rules, run without React (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G1-§G8):
// the dates a row and the New report dialog read, the build states, what makes a link usable and how
// each link state reads, the copy-ready message, the per-question rules, and the History's words.
// Since docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md: New report's dated choices and the week nudge (§C), the
// duplicate prompt's words (§E), links to one report and the message's endings (§D), and the guide's
// one copy source (§B). The week math itself (reportDates.js, contract K1) is pinned by its fixture
// table in reportPeriods.parity.test.js. Since docs/PROPOSAL_CLIENT_REPORT_LINKS.md: one link per report
// (§C2) — a link to all your reports never counts as a report's — the link words in one vocabulary
// (turned off, new address), the summed opens line, and the message's endings by what Share just did (§D1).

const NOW = Date.parse('2026-10-24T15:00:00Z');
const DAY = 86400000;

test('dates: civil arithmetic, a DST week is 7 days, gaps only between reports', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(periodDays('2026-11-01', '2026-11-07'), 7, 'the week the clocks change is still 7 days');
  assert.equal(daysBetween('2026-03-08', '2026-03-15'), 7);
  assert.equal(formatPeriod('2026-10-13', '2026-10-19'), 'Oct 13 – Oct 19');
  assert.equal(formatPeriod('2026-10-13', '2026-10-13'), 'Oct 13');
  assert.equal(formatPeriod('2025-12-29', '2026-01-04'), 'Dec 29, 2025 – Jan 4, 2026');
  assert.deepEqual(gapBetween({ weekStart: '2026-10-13' }, { weekEnd: '2026-10-07' }), { start: '2026-10-08', end: '2026-10-12' });
  assert.equal(gapBetween({ weekStart: '2026-10-13' }, { weekEnd: '2026-10-12' }), null, 'touching reports leave no gap');
  assert.equal(gapBetween({ weekStart: '2026-10-10' }, { weekEnd: '2026-10-12' }), null, 'overlapping reports leave no gap');
});

// New report's dated choices (SIMPLIFY §C): [label, skipped days] per choice, in order.
const MON = '2026-10-26'; // a Monday
const L = (weekStart, weekEnd) => ({ weekStart, weekEnd });
const listed = (args) => dateChoices({ s: 1, ...args }).choices.map((c) => [choiceText(c), c.skipped ? `${c.skipped.start}..${c.skipped.end}` : null]);
const LAST_WEEK = ['Last week · Oct 19 – Oct 25', null];
const THIS_WEEK = ['This week, not over yet · Oct 26 – Nov 1 — refresh it once the week ends', null];

test('New report: what follows each kind of last report, labelled by its kind and branch (SIMPLIFY §C, the round-1 scenarios)', () => {
  // Whole weeks on the organization's weekday: last week, "after your last report"; This week follows.
  assert.deepEqual(listed({ last: L('2026-10-12', '2026-10-18'), today: MON }), [['Last week · Oct 19 – Oct 25 — the week after your last report', null], THIS_WEEK]);
  // Any other length: the catch-up to the end of last week, then the presets.
  assert.deepEqual(listed({ last: L('2026-10-01', '2026-10-13'), today: MON }), [
    ['Oct 14 – Oct 25 · 12 days — from the day after your last report to the end of last week, so your next report covers a full Monday – Sunday week', null],
    LAST_WEEK,
    THIS_WEEK,
  ]);
  // …or, when the last report already reaches into this week, to the end of this week.
  assert.deepEqual(listed({ last: L('2026-10-01', '2026-10-13'), today: '2026-10-14' })[0], [
    'Oct 14 – Oct 18 · 5 days — from the day after your last report to the end of this week, so your next report covers a full Monday – Sunday week',
    null,
  ]);
  // A Sunday – Saturday series carries on Sunday – Saturday.
  assert.deepEqual(listed({ last: L('2026-10-18', '2026-10-24'), today: MON })[0], ['Oct 25 – Oct 31 — the week after your last report', null]);
  // Two weeks are followed by two weeks; a month by a month; a quarter by a quarter.
  assert.deepEqual(listed({ last: L('2026-10-12', '2026-10-25'), today: MON })[0], ['Oct 26 – Nov 8 · 2 weeks — the two weeks after your last report', null]);
  assert.deepEqual(listed({ last: L('2026-09-01', '2026-09-30'), today: '2026-11-10' })[0], ['October — the month after your last report', null]);
  assert.deepEqual(listed({ last: L('2026-07-01', '2026-09-30'), today: MON })[0], ['October – December — the three months after your last report', null]);
  // Round 2: a 12-day catch-up then one missed Monday is followed by ONE week, never 14 days.
  assert.deepEqual(listed({ last: L('2026-10-14', '2026-10-25'), today: '2026-11-02' })[0], ['Last week · Oct 26 – Nov 1 — the week after your last report', null]);
  // A first choice that is this week (not over yet) hides This week; Last week is still offered.
  assert.deepEqual(listed({ last: L('2026-10-19', '2026-10-25'), today: '2026-10-28' }), [['Oct 26 – Nov 1 — the week after your last report', null], LAST_WEEK]);
  // No report yet: last week — or this week, for a campaign whose first doors were knocked this week.
  assert.deepEqual(listed({ last: null, today: MON }), [LAST_WEEK, THIS_WEEK]);
  assert.deepEqual(listed({ last: null, today: MON, knockedBeforeThisWeek: false }), [THIS_WEEK, LAST_WEEK]);
});

test('New report after a long gap: the series’ own cadence, no "after your last report", and the days no report covers (SIMPLIFY §C)', () => {
  // Weekly, two weeks behind: last week, naming the week between.
  assert.deepEqual(listed({ last: L('2026-10-05', '2026-10-11'), today: MON }), [['Last week · Oct 19 – Oct 25', '2026-10-12..2026-10-18'], THIS_WEEK]);
  // Two-week runs stay on their own grid (Mon Nov 30: the run Nov 9 – Nov 22, not last week).
  assert.deepEqual(listed({ last: L('2026-10-12', '2026-10-25'), today: '2026-11-30' })[0], ['Nov 9 – Nov 22 · 2 weeks', '2026-10-26..2026-11-08']);
  // Monthly, a month behind: the last whole month.
  assert.deepEqual(listed({ last: L('2026-08-01', '2026-08-31'), today: '2026-11-10' })[0], ['October', '2026-09-01..2026-09-30']);
  // A catch-up longer than 14 days: last week instead.
  assert.deepEqual(listed({ last: L('2026-09-01', '2026-09-09'), today: MON })[0], ['Last week · Oct 19 – Oct 25', '2026-09-10..2026-10-18']);
  // A Wednesday – Tuesday tab long behind: its own most recent complete week.
  assert.deepEqual(listed({ last: L('2026-09-02', '2026-09-08'), today: MON })[0], ['Oct 14 – Oct 20', '2026-09-09..2026-10-13']);
  // Across a year: the year is named when it isn't this year's.
  assert.deepEqual(listed({ last: L('2025-12-15', '2025-12-21'), today: '2026-01-05' })[0], ['Last week · Dec 29, 2025 – Jan 4, 2026', '2025-12-22..2025-12-28']);
  assert.equal(monthsLabel('2025-12-01', '2025-12-31', '2026-01-10'), 'December 2025');
  assert.equal(monthsLabel('2025-11-01', '2026-01-31', '2026-02-10'), 'November 2025 – January 2026');
  assert.equal(monthsLabel('2026-10-01', '2026-12-31', '2026-10-26'), 'October – December');
});

test('New report on every report week: Last week, This week and the catch-up words follow the organization’s week', () => {
  const names = ['Sunday – Saturday', 'Monday – Sunday', 'Tuesday – Monday', 'Wednesday – Tuesday', 'Thursday – Wednesday', 'Friday – Thursday', 'Saturday – Friday'];
  let catchUps = 0;
  for (let s = 0; s <= 6; s += 1) {
    assert.equal(weekName(s), names[s]);
    const [first, second] = dateChoices({ last: null, s, today: MON }).choices;
    assert.equal(first.key, 'first');
    assert.equal(new Date(`${first.weekStart}T00:00:00Z`).getUTCDay(), s, `s=${s}: last week starts on the organization's day`);
    assert.equal(periodDays(first.weekStart, first.weekEnd), 7);
    assert.ok(daysBetween(first.weekEnd, MON) >= 1, `s=${s}: last week is over`);
    assert.ok(second.head.startsWith('This week, not over yet · ') && daysBetween(second.weekStart, MON) >= 0 && daysBetween(MON, second.weekEnd) >= 0, `s=${s}: this week holds today`);
    // An irregular report ending mid-week: the catch-up names this organization's week.
    // (Wednesday weeks: Oct 14 starts one, so a normal week follows instead — rule 3a — and on Mon Oct 26
    // that week is last week.)
    const catchUp = dateChoices({ last: L('2026-10-01', '2026-10-13'), s, today: MON }).choices[0];
    if (catchUp.kind === 'catch_up') {
      catchUps += 1;
      assert.ok(choiceText(catchUp).endsWith(`so your next report covers a full ${names[s]} week`), `s=${s}`);
    } else {
      assert.equal(choiceText(catchUp), 'Last week · Oct 14 – Oct 20 — the week after your last report', `s=${s}`);
    }
  }
  assert.equal(catchUps, 6);
});

test('the week nudge: only a whole-weeks tab on another weekday; Move this tab selects the catch-up (SIMPLIFY §C)', () => {
  const wedTue = weekNudge({ last: L('2026-10-14', '2026-10-20'), s: 1, today: MON });
  assert.equal(wedTue.tabWeek, 'Wednesday – Tuesday');
  assert.equal(wedTue.tabDay, 3);
  assert.equal(wedTue.orgWeek, 'Monday – Sunday');
  assert.equal(choiceText(wedTue.move), 'Oct 21 – Oct 25 · 5 days — from the day after your last report to the end of last week, so your next report covers a full Monday – Sunday week');
  assert.equal(wedTue.move.key, 'move');
  // A Sunday – Saturday series: a one-day catch-up first.
  assert.equal(choiceText(weekNudge({ last: L('2026-10-18', '2026-10-24'), s: 1, today: MON }).move), 'Oct 25 · 1 day — from the day after your last report to the end of last week, so your next report covers a full Monday – Sunday week');
  // Long behind: the catch-up would run past 14 days, so Move picks last week and names the days no report covers.
  const behind = weekNudge({ last: L('2026-09-02', '2026-09-08'), s: 1, today: MON });
  assert.equal(choiceText(behind.move), 'Last week · Oct 19 – Oct 25');
  assert.deepEqual(behind.move.skipped, { start: '2026-09-09', end: '2026-10-18' });
  // No nudge: the organization's own weekday; no report yet; a month — even a February that is four whole
  // Sunday-to-Saturday weeks; an irregular report ending on a week end (its next is a normal week).
  assert.equal(weekNudge({ last: L('2026-10-12', '2026-10-18'), s: 1, today: MON }), null);
  assert.equal(weekNudge({ last: L('2026-10-18', '2026-10-24'), s: 0, today: MON }), null, 'Sunday weeks in a Sunday organization');
  assert.equal(weekNudge({ last: null, s: 1, today: MON }), null);
  assert.equal(weekNudge({ last: L('2026-02-01', '2026-02-28'), s: 1, today: '2026-03-10' }), null);
  assert.equal(weekNudge({ last: L('2026-10-01', '2026-10-18'), s: 1, today: MON }), null);
});

test('New report says what the dates decide: totals from the campaign’s first door through the last day picked, for what the report covers (SIMPLIFY §M)', () => {
  assert.equal(
    totalsSentence({ wholeCampaign: true, phrase: 'this week' }),
    'Your report shows totals for the whole campaign, from its first door through the last day you pick. The first day only decides what shows as new, like “+412 this week”.'
  );
  assert.equal(
    totalsSentence({ label: 'Paid team', phrase: 'in these 14 days' }),
    'Your report shows totals for Paid team, from the campaign’s first door through the last day you pick. The first day only decides what shows as new, like “+412 in these 14 days”.'
  );
  // Its team or walk list not picked yet: no name to give.
  assert.equal(
    totalsSentence({ phrase: 'that day' }),
    'Your report shows totals from the campaign’s first door through the last day you pick. The first day only decides what shows as new, like “+412 that day”.'
  );
});

test('the duplicate prompt names the tab’s report for those dates, by its state (SIMPLIFY §E)', () => {
  const d = { reportId: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' };
  assert.equal(duplicateText({ ...d, status: 'draft' }, { today: MON }), 'You already have a draft Whole campaign report for Oct 19 – Oct 25.');
  assert.equal(
    duplicateText({ ...d, status: 'published', takenDown: false }, { today: MON }),
    'You already published a Whole campaign report for Oct 19 – Oct 25. To bring its numbers up to date, open it and press Refresh numbers.'
  );
  assert.equal(duplicateText({ ...d, status: 'published', takenDown: true }, { today: MON }), 'You already published a Whole campaign report for Oct 19 – Oct 25, taken down.');
  assert.equal(
    duplicateText({ ...d, status: 'published', takenDown: true, scopeLabel: 'East side' }, { today: MON }),
    'You already published an East side report for Oct 19 – Oct 25, taken down.'
  );
  // The refusal without a scope label: the dialog's own name for the tab. Another year: its year.
  assert.equal(duplicateText({ ...d, status: 'draft', scopeLabel: undefined, weekStart: '2025-10-13', weekEnd: '2025-10-19' }, { today: MON, scopeLabel: 'Paid team' }), 'You already have a draft Paid team report for Oct 13 – Oct 19, 2025.');
});

test('build states: every state reads as §G1 names it, and only live ones poll', () => {
  assert.equal(buildStateOf({ status: 'queued', queuePosition: 2 }).label, 'Queued (2 ahead)');
  assert.equal(buildStateOf({ status: 'queued', queuePosition: 0 }).label, 'Queued');
  assert.equal(buildStateOf({ status: 'queued' }).canCancel, true);
  const waiting = buildStateOf({ status: 'waiting', waitingFor: 'for the answer edit on this campaign to finish' });
  assert.equal(waiting.label, 'Waiting');
  assert.equal(waiting.detail, 'Waiting for the answer edit on this campaign to finish.');
  assert.equal(waiting.canCancel, true);
  assert.equal(buildStateOf({ status: 'running', progress: 41.6 }).label, 'Building 42%');
  assert.equal(buildStateOf({ status: 'running', progress: 10 }, { hasSnapshot: false }).label, 'Building the first numbers 10%');
  assert.equal(buildStateOf({ status: 'running', kind: 'remap', progress: 5 }).label, 'Building areas 5%');
  assert.equal(buildStateOf({ status: 'running', progress: 50 }).canCancel, true, 'Cancel is offered while running too');
  assert.equal(buildStateOf({ status: 'ready', kind: 'refresh' }).label, 'New numbers ready to review');
  const failed = buildStateOf({ status: 'failed', error: { code: 'CHANGED_DURING_BUILD', message: 'The campaign’s records changed twice.' } });
  assert.equal(failed.label, 'Failed');
  assert.equal(failed.canRetry, true);
  assert.equal(failed.detail, 'The campaign’s records changed twice.');
  assert.equal(buildStateOf({ status: 'failed', error: { code: 'DELETING' } }).canRetry, false);
  const team = buildStateOf({ status: 'failed', error: { code: 'TEAM_CHANGED', seriesId: 's1' } });
  assert.equal(team.label, 'Team changed');
  assert.equal(team.teamChanged, true);
  assert.ok(!team.canRetry, 'the team card, never Retry');
  assert.equal(buildStateOf({ status: 'stalled' }).label, 'Stalled');
  assert.equal(buildStateOf({ status: 'stalled' }).canRetry, true);
  // A queued build the server judged dead (a lost job) reads Stalled.
  assert.equal(displayStatusOf({ status: 'queued', live: false }), 'stalled');
  assert.equal(displayStatusOf({ status: 'queued', live: null }), 'queued', 'a list row (live unknown) is trusted');
  assert.equal(buildStateOf({ status: 'idle' }), null);
  assert.equal(buildPollInterval({ status: 'running' }), 3000);
  assert.equal(buildPollInterval({ status: 'waiting' }), 15000);
  assert.equal(buildPollInterval({ status: 'ready' }), false);
  assert.equal(buildPollInterval({ status: 'queued', live: false }), false, 'a dead build is not polled');
  assert.equal(isLiveBuild({ status: 'failed' }), false);
});

test('build views: the newer one wins, but a poll that found this build dead outranks a newer list copy of it', () => {
  const listCopy = { kind: 'recompute', status: 'queued', live: null, startedAt: '2026-10-24T10:00:00Z' };
  const deadPoll = { ...listCopy, live: false };
  // A lost job: the list refetched after the poll, yet the poll's verdict stands — no poll ⇄ refetch loop.
  const shown = freshestBuild({ polled: deadPoll, polledAt: 100, source: listCopy, sourceAt: 200 });
  assert.equal(displayStatusOf(shown), 'stalled');
  assert.equal(isLiveBuild(shown), false);
  // A NEW claim (Retry) is a different build: the newer copy wins and polling resumes.
  const retried = { ...listCopy, startedAt: '2026-10-24T11:00:00Z' };
  assert.equal(freshestBuild({ polled: deadPoll, polledAt: 100, source: retried, sourceAt: 200 }), retried);
  // Otherwise simply the newer.
  const running = { ...listCopy, status: 'running', progress: 40 };
  assert.equal(freshestBuild({ polled: running, polledAt: 300, source: listCopy, sourceAt: 200 }), running);
  assert.equal(freshestBuild({ polled: running, polledAt: 100, source: listCopy, sourceAt: 200 }), listCopy);
  assert.equal(freshestBuild({ source: listCopy }), listCopy);
});

const link = (over = {}) => ({
  id: 'l1',
  token: 'tok1',
  label: 'Candidate',
  isActive: true,
  hasPassword: true,
  expiresAt: new Date(NOW + 60 * DAY).toISOString(),
  lifetimeEndsAt: new Date(NOW + 300 * DAY).toISOString(),
  passwordMeetsRule: true,
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  ...over,
});
const keys = (s) => linkBadges(s, { now: NOW, tz: 'America/New_York' }).map((b) => b.key);

test('links: every row state from §G7, and the short-password flag only when known', () => {
  assert.deepEqual(keys(link()), ['active']);
  assert.deepEqual(keys(link({ isActive: false })), ['off']);
  // One vocabulary (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1): turned off, turn on.
  assert.deepEqual(linkBadges(link({ isActive: false }), { now: NOW })[0], { key: 'off', variant: 'neutral', label: 'Turned off', detail: 'Nobody can open it until you turn it on.' });
  assert.deepEqual(keys(link({ expiresAt: new Date(NOW + 5 * DAY + 1000).toISOString() })), ['expiring']);
  assert.equal(linkBadges(link({ expiresAt: new Date(NOW + 5 * DAY + 1000).toISOString() }), { now: NOW })[0].label, 'Expires in 5 days');
  assert.deepEqual(keys(link({ expiresAt: new Date(NOW - DAY).toISOString() })), ['expired']);
  assert.match(linkBadges(link({ expiresAt: new Date(NOW - DAY).toISOString() }), { now: NOW })[0].detail, /new address — send your client the new link/);
  assert.deepEqual(keys(link({ failures: { last24h: 12, last7d: 12, total: 12 } })), ['active', 'wrong']);
  const locked = link({ lock: { locked: true, until: new Date(NOW + 3 * 3600000).toISOString() }, failures: { last24h: 50, last7d: 50, total: 50 } });
  assert.deepEqual(keys(locked), ['locked'], 'a lock replaces the wrong-password badge');
  assert.match(linkBadges(locked, { now: NOW, tz: 'America/New_York' })[0].detail, /after 50 wrong passwords\. Devices already signed in still work\./);
  assert.deepEqual(keys(link({ passwordMeetsRule: false })), ['active', 'short']);
  assert.deepEqual(keys(link({ passwordMeetsRule: null })), ['active'], 'unknown is never flagged');
  // A link with no password or no expiry is an old link to all your reports — on the old-links card,
  // never in Share — so the badges have nothing to add about either.
  assert.deepEqual(keys(link({ hasPassword: false, expiresAt: null, lifetimeEndsAt: null })), ['active']);
  assert.equal(failureLine({ last24h: 12, last7d: 30, total: 41 }), '12 wrong passwords in the last day · 30 this week · 41 in total');
  // With the window's first wrong password (the server's failures.since): "since Oct 24, 9:12 AM EDT".
  assert.match(failureLine({ last24h: 12, since: '2026-10-24T13:12:00Z', last7d: 12, total: 12 }, 'America/New_York'), /^12 wrong passwords since Oct 24, 9:12\sAM EDT · 12 this week · 12 in total$/);
  assert.equal(shortUrl('https://doorline.app/r/e67TqWZpXk'), 'doorline.app/r/e67Tq…');
});

test('links: the wrong-password counts show whenever there are any; the warning badge is for the last day (WALK-2)', () => {
  // None in the last day: no badge, but the week and the total still read — the first part says what they count.
  assert.deepEqual(keys(link({ failures: { last24h: 0, last7d: 3, total: 41 } })), ['active']);
  assert.equal(failureLine({ last24h: 0, last7d: 3, total: 41 }), '3 wrong passwords this week · 41 in total');
  assert.equal(failureLine({ last24h: 0, last7d: 0, total: 41 }), '41 wrong passwords in total');
  assert.equal(failureLine({ last24h: 0, last7d: 1, total: 1 }), '1 wrong password this week · 1 in total');
  assert.equal(failureLine({ last24h: 0, last7d: 0, total: 0 }), '', 'nothing to say');
  assert.equal(failureLine(undefined), '');
  // The badge is the last day's, and it carries no sentence of its own: the counts line is the row's.
  const wrong = linkBadges(link({ failures: { last24h: 2, last7d: 5, total: 9 } }), { now: NOW, tz: 'America/New_York' }).find((b) => b.key === 'wrong');
  assert.deepEqual(wrong, { key: 'wrong', variant: 'warning', label: 'Wrong passwords' });
  // Locked and expired links wear no wrong-password badge, but their counts still read.
  const fails = { last24h: 50, last7d: 50, total: 50 };
  assert.deepEqual(keys(link({ lock: { locked: true, until: new Date(NOW + 3600000).toISOString() }, failures: fails })), ['locked']);
  assert.deepEqual(keys(link({ expiresAt: new Date(NOW - 1000).toISOString(), failures: fails })), ['expired']);
  assert.equal(failureLine(fails), '50 wrong passwords in the last day · 50 this week · 50 in total');
});

test('links: an expired link points only at Renew, and "devices still work" is said only when true (ADMINUX-8)', () => {
  const lock = { locked: true, until: new Date(NOW + 3 * 3600000).toISOString() };
  const fails = { last24h: 50, last7d: 50, total: 50 };
  // Expired a moment after it locked: nobody can open it (410), and Renew clears the wrong passwords.
  assert.deepEqual(keys(link({ expiresAt: new Date(NOW - 1000).toISOString(), lock, failures: fails })), ['expired'], 'no lock, no wrong-password badge');
  // Locked while turned off: turning it off signed every device out.
  const off = linkBadges(link({ isActive: false, lock, failures: fails }), { now: NOW, tz: 'America/New_York' });
  assert.deepEqual(off.map((b) => b.key), ['off', 'locked']);
  assert.match(off[1].detail, /after 50 wrong passwords\.$/);
  assert.ok(!off[1].detail.includes('still work'));
});

test('links: each confirm promises what the share routes do — New address and Renew, in one vocabulary (ADMINUX-8, LINKS §D1)', () => {
  const tz = 'America/New_York';
  const [rotated, after] = rotateConfirmLines(link({ expiresAt: '2026-12-01T17:00:00Z' }), { now: NOW, tz });
  assert.equal(rotated, 'It gets a new address, and everyone using the old one is signed out. The password stays the same. It still expires Dec 1, 2026.');
  assert.equal(after, 'Send your client the new link afterwards.');
  // A locked link: a new address clears the wrong passwords with the old one.
  const lock = { locked: true, until: new Date(NOW + 3600000).toISOString() };
  assert.match(rotateConfirmLines(link({ lock }), { now: NOW, tz })[0], / It also lifts the lock\.$/);
  // A link that's turned off stays turned off, so its new address opens nothing yet.
  assert.equal(rotateConfirmLines(link({ isActive: false }), { now: NOW, tz })[1], 'It stays turned off — nobody can open the new address until you turn it on.');
  // A legacy open link (an old link to all your reports): no password to keep, no expiry to keep.
  assert.equal(rotateConfirmLines(link({ hasPassword: false, expiresAt: null }), { now: NOW, tz })[0], 'It gets a new address, and everyone using the old one is signed out.');
  assert.equal(renewText(link()), 'Renew gives this link a new address — send your client the new link. The password stays the same.');
  assert.equal(
    renewText(link({ isActive: false })),
    'Renew gives this link a new address. It stays turned off until you turn it on — then send your client the new link. The password stays the same.'
  );
  // There is no Turn off any more — Take down does that job for one report — so no confirm words for it.
  assert.equal(linkStateModule.disableConfirmText, undefined);
  // What a lock says to do: a new address, never "rotate".
  const fails = { last24h: 50, last7d: 50, total: 50 };
  assert.deepEqual(lockAdvice(link({ lock, failures: fails, rotateAdvice: true }), NOW), {
    text: 'Someone else has this link — 50 wrong passwords is never your client. Give it a new address.',
    tone: 'danger',
  });
  assert.deepEqual(lockAdvice(link({ failures: { last24h: 0, last7d: 52, total: 52 }, rotateAdvice: true }), NOW), {
    text: '50 or more wrong passwords this week — someone else may have this link. Give it a new address.',
    tone: 'warning',
  });
  assert.equal(lockAdvice(link({ expiresAt: new Date(NOW - 1000).toISOString(), lock, rotateAdvice: true }), NOW), null, 'an expired link is renewed instead');
  assert.equal(lockAdvice(link(), NOW), null);
});

test('links: usable means active, unexpired and unlocked; the publish-time link words are gone (LINKS §D5)', () => {
  assert.equal(usableLinks([link(), link({ id: 'l2', isActive: false }), link({ id: 'l3', expiresAt: new Date(NOW - 1).toISOString() })], NOW).length, 1);
  assert.equal(usableLinks([link({ lock: { locked: true, until: new Date(NOW + 1000).toISOString() } })], NOW).length, 0);
  // A lock whose time has passed no longer counts.
  assert.equal(usableLinks([link({ lock: { locked: true, until: new Date(NOW - 1000).toISOString() } })], NOW).length, 1);
  // A draft can never have a link, so nothing asks "can a link open it?" before publishing: the reasons,
  // the Publish confirm's line, the expiring-soon warning and the Link ready dialog's message went.
  for (const gone of ['noUsableLinkReason', 'linksLine', 'reportLinkReason', 'reportLinksLine', 'linkOpens', 'linkName', 'deleteLinksText', 'reportUrl']) {
    assert.equal(linkStateModule[gone], undefined, gone);
  }
  assert.equal(copyMessageModule.linkMessageFor, undefined, 'the Link ready dialog went with the links panel');
});

test('links: Extend shows the resulting date and offers only later ones, capped a year from creation', () => {
  const s = link({ expiresAt: new Date(NOW + 60 * DAY).toISOString(), lifetimeEndsAt: new Date(NOW + 200 * DAY).toISOString() });
  const choices = extendChoices(s, NOW);
  assert.deepEqual(choices.map((c) => c.days), [90, 180, 365], 'never a choice that ends sooner than now');
  assert.equal(choices[0].until.getTime(), NOW + 90 * DAY);
  assert.equal(choices[2].capped, true);
  assert.equal(choices[2].until.getTime(), NOW + 200 * DAY, 'capped at the link’s one-year life');
  assert.equal(choices.length, 3, 'two choices that cap to the same date collapse');
  // Already at its cap: nothing to offer.
  assert.deepEqual(extendChoices(link({ expiresAt: new Date(NOW + 200 * DAY).toISOString(), lifetimeEndsAt: new Date(NOW + 200 * DAY).toISOString() }), NOW), []);
});

test('links: opens read "About N visits" — every link summed, old and deleted ones too — with the organization apart (LINKS Part 1 §5)', () => {
  // Its own link, a link since deleted and an old link to all your reports: one count.
  const r = { views: { byLink: { l1: { opens: 2 }, gone: { opens: 1 }, all: { opens: 2 } }, members: { admins: { opens: 1 }, leads: { opens: 1 } } } };
  assert.equal(opensLine(r), 'About 5 visits · your organization: 2 visits');
  assert.equal(opensLine({ views: { byLink: { l1: { opens: 1 } } } }), 'About 1 visit');
  // Only the organization's own people: said, with a capital.
  assert.equal(opensLine({ views: { byLink: {}, members: { others: { opens: 3 } } } }), 'Your organization: 3 visits');
  // Doorline staff, and the views from before per-link counts, only when there are any.
  assert.equal(
    opensLine({ views: { byLink: { l1: { opens: 1200 } }, members: { admins: { opens: 3 }, staff: { opens: 1 } } }, viewCount: 4 }),
    'About 1,200 visits · your organization: 3 visits · Doorline staff: 1 visit · 4 views before per-link counts'
  );
  assert.equal(opensLine({}), '');
  assert.equal(opensLine(null), '');
});

test('the copy-ready message names the scope and dates, gives the link’s short address, and never carries the password', () => {
  const row = {
    id: 'r9',
    weekStart: '2026-10-13',
    weekEnd: '2026-10-19',
    scope: { kind: 'team', label: 'Volunteer team' },
    seriesLabel: 'Volunteer team',
    headline: { cumulative: { doorsKnocked: 3412, surveysTaken: 1980 }, period: { doorsKnocked: 412, surveysTaken: 260 } },
  };
  const msg = copyMessageFor({ report: { ...messageReportOf(row), campaignType: 'survey' }, link: link(), origin: 'https://doorline.app' });
  assert.equal(
    msg,
    'The Volunteer team report for Oct 13 – Oct 19 is up: 3,412 doors knocked so far (+412 in that period) and 1,980 surveys (+260). ' +
      'Open it here: https://doorline.app/r/tok1 — use the password I sent you.'
  );
  // The short address: a report's own link opens that report (LINKS §D1).
  assert.equal(shareUrl('https://doorline.app', 'tok1'), 'https://doorline.app/r/tok1');
  // The tab the report is on rides along, for Share's Same as … (contract K11).
  assert.deepEqual(
    [messageReportOf({ ...row, seriesId: 's-vol', seriesKey: 'kV' }).seriesId, messageReportOf({ ...row, seriesId: 's-vol', seriesKey: 'kV' }).seriesKey],
    ['s-vol', 'kV']
  );
  assert.equal(messageReportOf({ ...row, scope: { ...row.scope, seriesKey: 'kS' } }).seriesKey, 'kS', 'a shaped report carries its key in its scope');
  assert.deepEqual([messageReportOf(row).seriesId, messageReportOf(row).seriesKey], [null, null]);
  const whole = copyMessageFor({
    report: { ...messageReportOf({ ...row, scope: { kind: 'campaign', label: 'Whole campaign' }, seriesLabel: null }), campaignType: 'lit_drop' },
    link: link({ hasPassword: false }),
    origin: 'https://doorline.app',
  });
  assert.match(whole, /^The report for Oct 13 – Oct 19 is up: 3,412 doors knocked so far \(\+412 in that period\) and 0 lit dropped \(\+0\)\./);
  assert.ok(!/password/.test(whole), 'an open link’s message says nothing about a password');
});

// A link to one report (SIMPLIFY §D): the share row's reportId and report.
const oneReport = (over = {}) =>
  link({ id: 'b1', token: 'tokB', label: 'Board', reportId: 'r1', report: { id: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign' }, ...over });

test('one link per report: a report’s links are its own — a link to all your reports never counts as opening it (LINKS §C2, §D6)', () => {
  const legacy = link({ id: 'old', label: 'Old' }); // no reportId field at all: made before links to one report
  const all = link({ id: 'all', label: 'Candidate', reportId: null, report: null });
  const board = oneReport();
  const donor = oneReport({ id: 'd2', label: 'Donor', reportId: 'r2', report: { id: 'r2', weekStart: '2026-10-12', weekEnd: '2026-10-18', scopeLabel: 'Paid team' } });
  const shares = [legacy, all, board, donor];
  assert.deepEqual(linksFor(shares, 'r1').map((s) => s.id), ['b1']);
  assert.deepEqual(linksFor(shares, 'r3'), [], 'old links to all your reports never count; nor does another report’s link');
  assert.deepEqual(singleLinksOf(shares, 'r1').map((s) => s.id), ['b1'], 'the same list, by its older name');
  assert.deepEqual(linksFor(null, 'r1'), []);
  assert.equal(usableLinks(linksFor([donor, link({ id: 'x', isActive: false })], 'r2'), NOW).length, 1);
  // The old links, for the card: newest first, with or without the reportId field.
  assert.deepEqual(allReportsLinksOf([board, { ...legacy, createdAt: new Date(NOW - 9 * DAY).toISOString() }, { ...all, createdAt: new Date(NOW - DAY).toISOString() }]).map((s) => s.id), ['all', 'old']);
  assert.deepEqual(allReportsLinksOf(null), []);
  // Still working: turned on and not expired (a locked one serves the devices signed in to it), and
  // never once the switch is on.
  assert.equal(hasWorkingAllReportsLink([all, board], false, NOW), true);
  assert.equal(hasWorkingAllReportsLink([{ ...all, lock: { locked: true, until: new Date(NOW + 3600000).toISOString() } }], false, NOW), true);
  assert.equal(hasWorkingAllReportsLink([all], true, NOW), false, 'the switch turned them off');
  assert.equal(hasWorkingAllReportsLink([{ ...all, isActive: false }, { ...legacy, expiresAt: new Date(NOW - DAY).toISOString() }, board], false, NOW), false);
  assert.equal(hasWorkingAllReportsLink([board], false, NOW), false, 'a report’s own link isn’t one');
});

test('a report that got two links before one link per report: the main one is the newest usable, else the newest; the rest are extras (LINKS §C2)', () => {
  const at = (d) => new Date(NOW - d * DAY).toISOString();
  const older = oneReport({ id: 'o', label: 'Board', createdAt: at(3) });
  const newer = oneReport({ id: 'n', label: '', createdAt: at(1) });
  assert.equal(primaryLinkOf([older, newer], 'r1', NOW).id, 'n', 'the newest');
  assert.deepEqual(extraLinksOf([older, newer], 'r1', NOW).map((s) => s.id), ['o']);
  // The newest can't be opened (expired, turned off, locked): the newest usable one is the main one.
  for (const broken of [{ expiresAt: at(0.5) }, { isActive: false }, { lock: { locked: true, until: new Date(NOW + 3600000).toISOString() } }]) {
    const b = { ...newer, ...broken };
    assert.equal(primaryLinkOf([older, b], 'r1', NOW).id, 'o', JSON.stringify(broken));
    assert.deepEqual(extraLinksOf([older, b], 'r1', NOW).map((s) => s.id), ['n']);
  }
  // None usable: the newest, still.
  assert.equal(primaryLinkOf([{ ...older, isActive: false }, { ...newer, isActive: false }], 'r1', NOW).id, 'n');
  // The server's own order (newest first) decides between rows without a date.
  assert.equal(primaryLinkOf([oneReport({ id: 'first' }), oneReport({ id: 'second' })], 'r1', NOW).id, 'first');
  // No link of its own: nothing — an old link to all your reports is never a report's main link.
  assert.equal(primaryLinkOf([link({ id: 'all', reportId: null })], 'r1', NOW), null);
  assert.deepEqual(extraLinksOf([link({ id: 'all', reportId: null })], 'r1', NOW), []);
  assert.equal(primaryLinkOf(null, 'r1', NOW), null);
});

test('Share’s message waits for a link the client can open — what to do first, turned off before expired before locked (code review CC-1)', () => {
  const gone = new Date(NOW - DAY).toISOString();
  const lock = { locked: true, until: new Date(NOW + 3600000).toISOString() };
  assert.equal(beforeSendText(link(), NOW), null, 'on, not expired, not locked: send it');
  assert.equal(beforeSendText(link({ isActive: false }), NOW), 'Turn it on before you send it.');
  assert.equal(beforeSendText(link({ expiresAt: gone }), NOW), 'Renew it before you send it.');
  assert.equal(beforeSendText(link({ lock }), NOW), 'Unlock it before you send it.');
  // Two at once: in the order the row's link line reads them — a client meets turned off, then expired.
  assert.equal(beforeSendText(link({ isActive: false, expiresAt: gone, lock }), NOW), 'Turn it on before you send it.');
  assert.equal(beforeSendText(link({ expiresAt: gone, lock }), NOW), 'Renew it before you send it.');
  // A lock whose time has passed no longer holds it.
  assert.equal(beforeSendText(link({ lock: { locked: true, until: new Date(NOW - 1000).toISOString() } }), NOW), null);
  assert.equal(beforeSendText(null, NOW), null);
});

test('Change password’s other links changed fewer than offered: none reads as none, one is never partly changed (code review CC-7)', () => {
  assert.equal(fewerChangedLine(1, 0), 'It wasn’t changed on the other link — someone changed it a moment ago; check its password.');
  assert.equal(fewerChangedLine(3, 0), 'It wasn’t changed on the other 3 links — someone changed them a moment ago; check their passwords.');
  assert.equal(fewerChangedLine(3, 1), 'Changed on 1 of the 3 other links — the rest were changed by someone else a moment ago; check their passwords.');
  assert.equal(fewerChangedLine(3, 2), 'Changed on 2 of the 3 other links — the rest were changed by someone else a moment ago; check their passwords.');
  // Every one offered changed (or more), nothing offered, or an answer that didn't say: no line.
  for (const [offered, changed] of [[1, 1], [3, 3], [2, 5], [0, 0], [3, null], [3, undefined]]) {
    assert.equal(fewerChangedLine(offered, changed), null, `${offered} offered, ${changed} changed`);
  }
});

test('gap lines: the days no dated report covers, over the whole tab — overlapping reports and all-time ones never make a false gap (SIMPLIFY §N, code review)', () => {
  const r = (id, weekStart, weekEnd, extra = {}) => ({ id, weekStart, weekEnd, ...extra });
  // Weekly reports, one week skipped: the line sits above the report before the gap.
  assert.deepEqual([...gapsAbove([r('w3', '2026-10-19', '2026-10-25'), r('w1', '2026-10-05', '2026-10-11')])], [['w1', { start: '2026-10-12', end: '2026-10-18' }]]);
  assert.equal(gapsAbove([r('w2', '2026-10-12', '2026-10-18'), r('w1', '2026-10-05', '2026-10-11')]).size, 0, 'back to back: no gap');
  // Listed by last day, a month with a week inside it: only Sep 28 – Sep 30 is uncovered (row by row, the
  // week beside Sep 21 – Sep 27 read "Sep 28 – Oct 18").
  const month = [r('m', '2026-10-01', '2026-10-31'), r('wk', '2026-10-19', '2026-10-25'), r('sep', '2026-09-21', '2026-09-27')];
  assert.deepEqual([...gapsAbove(month)], [['sep', { start: '2026-09-28', end: '2026-09-30' }]]);
  // An all-time report covers every day up to its last, but the lines are about the dated reports.
  assert.deepEqual(
    [...gapsAbove([r('a', '2026-09-14', '2026-10-28', { allTime: true }), r('w3', '2026-10-19', '2026-10-25'), r('w1', '2026-10-05', '2026-10-11')])],
    [['w1', { start: '2026-10-12', end: '2026-10-18' }]]
  );
  assert.equal(gapsAbove([r('a', '2026-09-14', '2026-10-28', { allTime: true })]).size, 0);
  assert.equal(gapsAbove([]).size, 0);
  // Two ending the same day: the line goes above the one listed first (the list's order: last day, then
  // made last), right under the report after the gap.
  assert.deepEqual(
    [...gapsAbove([r('nov', '2026-11-09', '2026-11-15'), r('late', '2026-10-25', '2026-10-31'), r('month', '2026-10-01', '2026-10-31')])],
    [['late', { start: '2026-11-01', end: '2026-11-08' }]]
  );
});

test('Latest progress (SIMPLIFY §N): its choice, its line, its duplicate prompt and its message carry no "+N"', () => {
  // The choice carries only its last day: the server works out where an all-time report starts.
  assert.deepEqual(allTimeChoice('2026-10-28'), {
    key: 'all_time',
    kind: 'all_time',
    allTime: true,
    weekStart: null,
    weekEnd: '2026-10-28',
    head: 'Latest progress · all time, through today',
    tail: null,
    skipped: null,
  });
  assert.equal(
    totalsSentence({ wholeCampaign: true, phrase: 'in this period', allTime: true, through: 'today' }),
    'Your report shows totals for the whole campaign, from its first door through today, with no “+412 this week” figures.'
  );
  assert.equal(
    totalsSentence({ label: 'Paid team', phrase: 'in this period', allTime: true, through: 'Oct 18' }),
    'Your report shows totals for Paid team, from the campaign’s first door through Oct 18, with no “+412 this week” figures.'
  );
  assert.equal(
    totalsSentence({ phrase: 'in this period', allTime: true }),
    'Your report shows totals from the campaign’s first door through the last day you pick, with no “+412 this week” figures.',
    'no last day picked yet'
  );
  // The duplicate prompt names an all-time report by its last day.
  const d = { weekStart: '2026-09-14', weekEnd: '2026-10-28', allTime: true, scopeLabel: 'Whole campaign' };
  assert.equal(duplicateText({ ...d, status: 'draft' }, { today: '2026-10-28' }), 'You already have a draft all-time Whole campaign report through Oct 28.');
  assert.equal(duplicateText({ ...d, status: 'published', takenDown: true }, { today: '2026-10-28' }), 'You already published an all-time Whole campaign report through Oct 28, taken down.');
  assert.equal(
    duplicateText({ ...d, status: 'published', takenDown: false }, { today: '2026-10-28' }),
    'You already published an all-time Whole campaign report through Oct 28. To bring its numbers up to date, open it and press Refresh numbers.'
  );
  // The Share message quotes its totals only.
  const row = {
    id: 'r9',
    weekStart: '2026-09-14',
    weekEnd: '2026-10-28',
    allTime: true,
    scope: { kind: 'campaign', label: 'Whole campaign' },
    headline: { cumulative: { doorsKnocked: 3412, surveysTaken: 1980, litKnocks: 900 }, period: { doorsKnocked: 3412, surveysTaken: 1980 } },
  };
  assert.equal(
    copyMessageFor({ report: { ...messageReportOf(row), campaignType: 'survey' }, link: link(), origin: 'https://doorline.app' }),
    'The report through Oct 28 is up: 3,412 doors knocked so far and 1,980 surveys. Open it here: https://doorline.app/r/tok1 — use the password I sent you.'
  );
  assert.equal(
    copyMessageFor({ report: { ...messageReportOf({ ...row, scope: { kind: 'team', label: 'Paid team' }, seriesLabel: 'Paid team' }), campaignType: 'lit_drop' }, link: link(), origin: 'https://doorline.app' }),
    'The Paid team report through Oct 28 is up: 3,412 doors knocked so far and 900 lit dropped. Open it here: https://doorline.app/r/tok1 — use the password I sent you.'
  );
});

test('the copy-ready message ends by what Share just did: made up or typed, changed, or Same as … and opened again later (LINKS §D1, the owner’s rule)', () => {
  const report = { id: 'r1', weekStart: '2026-10-19', weekEnd: '2026-10-25', campaignType: 'survey', scope: { kind: 'campaign', label: 'Whole campaign' }, cumulative: { doorsKnocked: 3412, surveysTaken: 1980 }, period: { doorsKnocked: 412, surveysTaken: 260 } };
  const msg = (l, ending) => copyMessageFor({ report, link: l, origin: 'https://doorline.app', ending });
  // Same as …, or the link opened again later (the default): the client has the password.
  assert.equal(
    msg(oneReport()),
    'The report for Oct 19 – Oct 25 is up: 3,412 doors knocked so far (+412 in that period) and 1,980 surveys (+260). Open it here: https://doorline.app/r/tokB — use the password I sent you.'
  );
  assert.equal(msg(oneReport(), 'sent'), msg(oneReport()));
  // A password made up or typed in this Share: sent separately.
  assert.ok(msg(oneReport(), 'new').endsWith('Open it here: https://doorline.app/r/tokB — I’ll send you its password separately.'));
  // Right after Change password: the new one, sent separately.
  assert.ok(msg(oneReport(), 'changed').endsWith('Open it here: https://doorline.app/r/tokB — I’ll send you the new password separately.'));
  // No longer by the link's kind: the "…for this report" ending is gone.
  assert.ok(!msg(oneReport()).includes('for this report'));
  assert.ok(msg(link({ hasPassword: false }), 'new').endsWith('Open it here: https://doorline.app/r/tok1.'), 'no password, no words about one');
  for (const ending of ['new', 'changed', 'sent']) assert.ok(!/k7Hq/.test(msg(oneReport(), ending)), 'never the password');
  assert.ok(msg(oneReport(), 'nonsense').endsWith('— use the password I sent you.'), 'an unknown ending reads as the default');
});

test('the guide’s words live in one place, as Part 1 words them (SIMPLIFY §B) — the Help Center quotes these', () => {
  assert.equal(
    INTRO,
    'Make reports for your client here. Each one shows the campaign’s running totals and what was added in the dates you pick. Share it with a link and its password, or download a PDF.'
  );
  assert.equal(HOW_IT_WORKS_LINK, 'How it works');
  assert.equal(GUIDE_TITLE, 'How client reports work');
  assert.deepEqual(
    STEPS.map((s) => `${s.title} — ${s.body}`),
    [
      'Make a report — press New report and pick the dates, usually Last week. After that, Next report on your newest report makes the following one in one click, with your settings and notes copied.',
      'Check it, then publish — the preview is exactly what your client will see. Once it’s published, its numbers stay as they are until you press Refresh numbers.',
      'Share it — Share makes the report’s link and a message to paste into your email or text. Next week’s link keeps this week’s password, so you send a password only the first time, or after you change it. Or open the report and press Download PDF.',
    ]
  );
  assert.deepEqual(PHONE_STEPS, ['Make a report — usually Last week; then Next report each week.', 'Check the preview, then publish.', 'Share its link; send the password the first time.']);
  assert.equal(HELP_LINE, 'More in the Help Center →');
  assert.equal(HELP_PATH, '/help/client-reports');
  assert.equal(GOT_IT, 'Got it');
});

const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support for Smith?', type: 'single_choice' },
  { questionKey: 'recall', questionLabel: 'Back the recall?', type: 'single_choice' },
  { questionKey: 'sign', questionLabel: 'Yard sign?', type: 'multiple_choice' },
  { questionKey: 'why', questionLabel: 'Why not?', type: 'single_choice' },
];
// "Yard sign?" follows "Back the recall?"; "Why not?" follows a written answer (not in the breakdowns).
const deps = depsMapOf([['sign', ['recall']], ['why', ['comment']]]);
const settings = (vis, support = null) => ({
  title: '',
  observations: [],
  supportQuestionKey: support,
  visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true, visibleTags: [], showGoal: false, mapMode: 'pins', areaSize: 'small', ...vis },
});

test('questions: a follow-up maps only with its parent, a written parent never, and None means none', () => {
  const s = settings({ visibleQuestionKeys: ['support', 'recall', 'sign', 'why'], mapAnswerKeys: ['support'] }, 'support');
  const rows = rowsFor({ breakdowns, settings: s, deps });
  const sign = rows.find((r) => r.key === 'sign');
  assert.equal(sign.isFollowUp, true);
  assert.equal(sign.followUp, 'Asked only on some paths through “Back the recall?” — mapping it shows who took that path.');
  assert.equal(sign.mapDisabled, true, 'its parent is off the map');
  assert.match(sign.mapBlocked, /only with “Back the recall\?”, so it’s best left off/);
  const why = rows.find((r) => r.key === 'why');
  assert.equal(why.textParent, true);
  assert.equal(why.mapBlocked, 'Asked only after a written answer, so it can’t go on the map.');
  // The parent mapped: the follow-up can be ticked, and the copy still says what it shows.
  const s2 = toggleMap(s, 'recall', deps).settings;
  assert.equal(rowsFor({ breakdowns, settings: s2, deps }).find((r) => r.key === 'sign').mapDisabled, false);
  // toggleMap refuses a follow-up whose parent isn't mapped (closed under deps).
  assert.deepEqual(toggleMap(s, 'sign', deps).settings.visibility.mapAnswerKeys, ['support']);
  const s3 = toggleMap(s2, 'sign', deps).settings;
  assert.deepEqual(s3.visibility.mapAnswerKeys.sort(), ['recall', 'sign', 'support']);
  // Unticking the parent's Map takes the follow-up with it, and says which.
  const off = toggleMap(s3, 'recall', deps);
  assert.deepEqual(off.settings.visibility.mapAnswerKeys, ['support']);
  assert.deepEqual(off.removedFromMap, ['sign']);
  // Unticking a chart takes the question off the map and out of the headline.
  const noChart = toggleChart(s3, 'support', deps);
  assert.ok(!noChart.settings.visibility.mapAnswerKeys.includes('support'));
  assert.equal(noChart.settings.supportQuestionKey, null);
  assert.deepEqual(noChart.removedFromMap, ['support']);
  // A hidden chart can't be the headline.
  assert.equal(setHeadline(noChart.settings, 'support').supportQuestionKey, null);
  // None: no chart, nothing on the map, no headline. All: every chart.
  const none = showNone(s3);
  assert.deepEqual(none.visibility.visibleQuestionKeys, []);
  assert.deepEqual(none.visibility.mapAnswerKeys, []);
  assert.equal(none.supportQuestionKey, null);
  assert.deepEqual(showAll(none, breakdowns).visibility.visibleQuestionKeys, ['support', 'recall', 'sign', 'why']);
  assert.deepEqual(closeUnderDeps(['sign', 'support'], deps), ['support']);
});

test('questions: on a published report the map only shrinks in place — an addition is Refresh numbers', () => {
  const s = settings({ visibleQuestionKeys: ['support', 'recall'], mapAnswerKeys: ['support'] });
  const rows = rowsFor({ breakdowns, settings: s, deps, published: true, liveMapKeys: ['support'] });
  assert.equal(rows.find((r) => r.key === 'recall').mapBlocked, 'Add this with Refresh numbers.');
  assert.equal(rows.find((r) => r.key === 'support').mapDisabled, false, 'unticking is always allowed');
  // Map off: the column explains itself.
  const off = rowsFor({ breakdowns, settings: settings({ visibleQuestionKeys: ['support'], showMap: false }), deps });
  assert.equal(off[0].mapBlocked, 'Turn on the map to use questions as map filters.');
});

test('History: every client-report row reads in words, naming the period, never a title', () => {
  const line = (field, extra = {}) => clientReportHistoryLine({ field, periodLabel: 'Oct 13 – Oct 19', ...extra });
  assert.deepEqual(line('clientReport.published'), { headline: 'Published', subject: 'Oct 13 – Oct 19 report', detail: '' });
  assert.equal(line('clientReport.edited', { fromValue: { title: 'Week 3', observations: [{ heading: 'A', body: 'b' }] } }).detail, 'Earlier title: “Week 3” · Earlier notes: 1 section');
  assert.equal(line('clientReport.edited', { fromValue: null, erasedAt: '2026-10-22' }).detail, 'Earlier text erased');
  assert.match(line('clientReport.edited', { fromValue: null }).detail, /no text was replaced/);
  assert.equal(
    line('clientReport.numbersRefreshed', { fromValue: { doorsKnocked: 3412, surveysTaken: 1980 }, toValue: { doorsKnocked: 3420, surveysTaken: 1980 } }).detail,
    'Doors 3,412 → 3,420'
  );
  assert.equal(line('clientReport.remapped', { toValue: { mapMode: 'area', areaSize: 'large' } }).detail, 'Large areas');
  assert.deepEqual(clientReportHistoryLine({ field: 'clientReportSeries.renamed', fromValue: 'Team A', toValue: 'Paid team' }), {
    headline: 'Renamed',
    subject: 'Paid team',
    detail: '“Team A” → “Paid team”',
  });
  assert.equal(
    clientReportHistoryLine({ field: 'clientReportSeries.crewsChanged', fromValue: { coordinatorIds: ['a'] }, toValue: { coordinatorIds: ['a', 'b'], pastCoordinatorIds: ['c'] } }).detail,
    '1 crew → 2 crews · past doors kept for 1 crew'
  );
  assert.equal(clientReportHistoryLine({ field: 'reportLink.rotated', toValue: { label: 'Candidate' } }).subject, 'Candidate');
  assert.equal(clientReportHistoryLine({ field: 'reportLink.wrongPasswords', toValue: { count: 12 } }).detail, '12 wrong passwords');
  for (const f of ['clientReport.created', 'clientReportSeries.ended', 'reportLink.locked']) assert.ok(isClientReportField(f), f);
  assert.ok(!isClientReportField('doorGoal'));
  // The general feed's labels are untouched.
  assert.equal(labelForField('doorGoal'), 'Door goal');
  assert.equal(earlierTextSummary({ title: '' }), 'Earlier title: none');
});

test('History names the tab and the team (WALK-3): four tabs’ publishes of one week read apart; old rows still read', () => {
  const seriesLabels = new Map([['s-paid', 'Paid team'], ['s-camp', 'Whole campaign'], ['s-vol', 'Volunteer team']]);
  const row = (field, extra = {}) => clientReportHistoryLine({ field, periodLabel: 'Oct 12 – Oct 18, 2026', ...extra }, { seriesLabels });
  assert.equal(row('clientReport.published', { seriesId: 's-paid' }).subject, 'Oct 12 – Oct 18, 2026 · Paid team report');
  assert.equal(row('clientReport.published', { seriesId: 's-camp' }).subject, 'Oct 12 – Oct 18, 2026 · Whole campaign report');
  assert.equal(row('clientReport.edited', { seriesId: 's-paid', fromValue: { title: 'x' } }).subject, 'Oct 12 – Oct 18, 2026 · Paid team report');
  // A row from before series, a series the list doesn't hold, or no list yet: the period alone.
  assert.equal(row('clientReport.published').subject, 'Oct 12 – Oct 18, 2026 report');
  assert.equal(row('clientReport.published', { seriesId: 's-gone' }).subject, 'Oct 12 – Oct 18, 2026 report');
  assert.equal(clientReportHistoryLine({ field: 'clientReport.published', periodLabel: 'Oct 12 – Oct 18, 2026', seriesId: 's-paid' }).subject, 'Oct 12 – Oct 18, 2026 report');
  assert.equal(clientReportHistoryLine({ field: 'clientReport.published', seriesId: 's-paid' }, { seriesLabels }).subject, 'Paid team report');
  assert.equal(clientReportHistoryLine({ field: 'clientReport.published' }, { seriesLabels }).subject, 'A report');
  assert.equal(reportRowName({ periodLabel: 'Oct 12 – Oct 18, 2026', seriesId: 's-vol' }, seriesLabels), 'Oct 12 – Oct 18, 2026 · Volunteer team');
  assert.equal(reportRowName({ periodLabel: null, seriesId: null }, seriesLabels), null);

  // Team rows name the team they were written with — and the newer name never rewrites an older row.
  const team = (field, extra = {}) => clientReportHistoryLine({ field, seriesId: 's-paid', ...extra }, { seriesLabels });
  assert.deepEqual(team('clientReportSeries.ended', { toValue: { label: 'Paid canvassers' } }), { headline: 'Team ended', subject: 'Paid canvassers', detail: '' });
  assert.deepEqual(team('clientReportSeries.continued', { toValue: { label: 'Paid team', coordinatorIds: ['a', 'b'] } }), {
    headline: 'Team continued',
    subject: 'Paid team',
    detail: '2 crews',
  });
  assert.deepEqual(
    team('clientReportSeries.crewsChanged', { fromValue: { coordinatorIds: ['a'] }, toValue: { label: 'Paid team', coordinatorIds: ['a', 'b'], pastCoordinatorIds: [] } }),
    { headline: 'Crews changed', subject: 'Paid team', detail: '1 crew → 2 crews' }
  );
  // Rows written before they named the team: its current name, else "A team".
  assert.equal(team('clientReportSeries.ended', { toValue: null }).subject, 'Paid team');
  assert.equal(team('clientReportSeries.crewsChanged', { fromValue: { coordinatorIds: ['a'] }, toValue: { coordinatorIds: ['b'] } }).subject, 'Paid team');
  assert.equal(clientReportHistoryLine({ field: 'clientReportSeries.ended', seriesId: 's-paid' }).subject, 'A team');
  assert.ok(isClientReportField('clientReportSeries.continued'));
});
