import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWorkingAllReportsLink, linkStatusLine, opensLine, primaryLinkOf, takeDownLinksText, linksFor } from '../components/clientReports/linkState.js';

// The link words a report's row and the builder read (docs/PROPOSAL_CLIENT_REPORT_LINKS.md Part 1 §5,
// §D2, §D4; contract K11). Every report has one link of its own, so a row says how THAT link is doing —
// "Link: active · expires Jan 25", "No link of its own yet — Share makes one.", expired, locked, turned
// off, or on a taken-down report what its link shows — and nothing on a draft, where a link can never be
// (the publish-time "can a link open this report?" lines this file used to pin are gone, §D5). An old
// link to all your reports never makes a row say its link is fine; while one still works, a report with
// no link of its own reads quieter, since the client can still open it there. Take down's confirm names
// the report's link only when a client can still open it.

const NOW = Date.parse('2026-10-28T15:00:00Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const TZ = 'America/New_York';
const RID = '6a00000000000000000000aa';

// A share row as GET /admin/client-reports/shares sends it (contract K1).
const link = (over = {}) => ({
  id: 'l1',
  token: 'tok1',
  label: '',
  hasPassword: true,
  isActive: true,
  expiresAt: '2027-01-25T17:00:00Z',
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  createdAt: iso(NOW - 2 * DAY),
  reportId: RID,
  report: { id: RID, weekStart: '2026-10-19', weekEnd: '2026-10-25', scopeLabel: 'Whole campaign', takenDown: false, seriesId: 's1' },
  allReports: false,
  ...over,
});
const oldLink = (over = {}) => link({ id: 'old', label: 'Candidate', reportId: null, report: null, allReports: true, ...over });
const row = (over = {}) => ({ id: RID, status: 'published', takenDownAt: null, ...over });
const line = (shares, report = row(), opts = {}) => linkStatusLine({ shares, report, now: NOW, tz: TZ, ...opts });

test('a row’s link line, by its link’s state (Part 1 §5, K11)', () => {
  assert.deepEqual(line([link()]), { text: 'Link: active · expires Jan 25', tone: 'muted' });
  assert.deepEqual(line([link({ expiresAt: '2026-10-25T17:00:00Z' })]), { text: 'Link expired Oct 25 — Share to renew it.', tone: 'warning' });
  assert.deepEqual(line([link({ lock: { locked: true, until: iso(NOW + 3600000) } })]), { text: 'Link locked after 50 wrong passwords — Share to unlock it.', tone: 'danger' });
  assert.deepEqual(line([link({ isActive: false })]), { text: 'Link turned off — Share to turn it on.', tone: 'warning' });
  // A lock whose time has passed is over.
  assert.equal(line([link({ lock: { locked: true, until: iso(NOW - 1000) } })]).text, 'Link: active · expires Jan 25');
  // Turned off comes first (a client meets that before anything), then expired; an expired link wears no lock.
  assert.equal(line([link({ isActive: false, expiresAt: '2026-10-25T17:00:00Z' })]).text, 'Link turned off — Share to turn it on.');
  assert.equal(line([link({ expiresAt: '2026-10-25T17:00:00Z', lock: { locked: true, until: iso(NOW + 3600000) } })]).text, 'Link expired Oct 25 — Share to renew it.');
  // The day is the campaign's: 2am UTC on Jan 26 is still Jan 25 in New York.
  assert.equal(line([link({ expiresAt: '2027-01-26T02:00:00Z' })]).text, 'Link: active · expires Jan 25');
});

test('no link of its own: Share makes one — quieter while an old link to all your reports still shows the report (Part 1 §5)', () => {
  assert.deepEqual(line([]), { text: 'No link of its own yet — Share makes one.', tone: 'warning' });
  // Another report's link is never this report's.
  assert.deepEqual(line([link({ id: 'x', reportId: 'other', report: { id: 'other', weekStart: '2026-10-12', weekEnd: '2026-10-18', scopeLabel: 'Whole campaign' } })]), {
    text: 'No link of its own yet — Share makes one.',
    tone: 'warning',
  });
  // An old link to all your reports never counts as its link — but while one works, the client can still open the report.
  assert.deepEqual(line([oldLink()]), { text: 'No link of its own yet — Share makes one.', tone: 'muted' });
  assert.deepEqual(line([oldLink()], row(), { allReportsRetired: true }), { text: 'No link of its own yet — Share makes one.', tone: 'warning' }, 'the switch turned it off');
  assert.equal(line([oldLink({ isActive: false }), oldLink({ id: 'old2', expiresAt: iso(NOW - DAY) })]).tone, 'warning', 'old links that no longer open anything');
  assert.equal(hasWorkingAllReportsLink([oldLink()], false, NOW), true);
  // Its own link beside an old one: its own decides.
  assert.equal(line([oldLink(), link({ isActive: false })]).text, 'Link turned off — Share to turn it on.');
});

test('a taken-down report: its link shows “taken down”; without one, nothing to say; a draft never has a line (Part 1 §5)', () => {
  const down = row({ takenDownAt: iso(NOW - DAY) });
  assert.deepEqual(line([link()], down), { text: 'Its link shows “taken down” until you put it back up.', tone: 'muted' });
  assert.deepEqual(line([link({ lock: { locked: true, until: iso(NOW + 3600000) } })], down), { text: 'Its link shows “taken down” until you put it back up.', tone: 'muted' });
  // A link nobody can open shows nothing "taken down": its own state is the line.
  assert.equal(line([link({ isActive: false })], down).text, 'Link turned off — Share to turn it on.');
  assert.equal(line([link({ expiresAt: '2026-10-25T17:00:00Z' })], down).text, 'Link expired Oct 25 — Share to renew it.');
  assert.equal(line([], down), null, 'Share can’t make one until it’s back up');
  assert.equal(line([oldLink()], down), null);
  // Nothing on a draft, or before the list is in.
  assert.equal(line([link()], row({ status: 'draft' })), null);
  assert.equal(line(null), null);
  assert.equal(linkStatusLine({ shares: [link()], report: null, now: NOW, tz: TZ }), null);
});

test('the builder’s report (its id as _id) reads the same line; the main link is the newest usable one', () => {
  const { id, ...rest } = row(); // eslint-disable-line no-unused-vars
  assert.equal(line([link()], { ...rest, _id: RID }).text, 'Link: active · expires Jan 25');
  // Two links from before one link per report: the newest usable one speaks for the row.
  const newerOff = link({ id: 'n', isActive: false, createdAt: iso(NOW - DAY) });
  const olderOn = link({ id: 'o', createdAt: iso(NOW - 5 * DAY) });
  assert.equal(primaryLinkOf([newerOff, olderOn], RID, NOW).id, 'o');
  assert.equal(line([newerOff, olderOn]).text, 'Link: active · expires Jan 25');
});

test('Take down names the report’s link only when a client can still open it (§D2)', () => {
  const take = (shares) => takeDownLinksText(linksFor(shares, RID), NOW);
  assert.equal(take([link()]), 'Its link shows “taken down” until you put it back up.');
  assert.equal(take([link({ lock: { locked: true, until: iso(NOW + 3600000) } })]), 'Its link shows “taken down” until you put it back up.', 'a lock lifts');
  assert.equal(take([link({ isActive: false }), link({ id: 'e', expiresAt: iso(NOW - DAY) })]), '', 'nobody can open these already');
  assert.equal(take([oldLink()]), '', 'an old link to all your reports is never the report’s link');
  assert.equal(take([]), '');
  assert.equal(takeDownLinksText(undefined), '');
});

test('the opens line a row and the builder print sums every link’s visits (Part 1 §5)', () => {
  const report = { views: { byLink: { l1: { opens: 3 }, old: { opens: 2 } }, members: { admins: { opens: 2 } } } };
  assert.equal(opensLine(report), 'About 5 visits · your organization: 2 visits');
  assert.equal(opensLine({ views: null }), '');
});
