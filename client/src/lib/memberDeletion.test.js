import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETED_ACCOUNT,
  deletionLine,
  viewerHasBillingAccess,
  billingLocked,
  canOfferDelete,
  confirmMatches,
  sentAgo,
  reviewLines,
  deletedNotice,
  goneNotice,
  goneOutcome,
  afterFailedDelete,
  reloadNote,
  fullName,
  roleLabel,
  deleteAccountMutationKey,
} from './memberDeletion.js';
import { formatDateInTz } from './datetime.js';

// The copy in these sentences is the owner-approved mockup copy (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md,
// Part 1 "What you'll see"), so the two mockup variants are pinned word for word.

const NOW = Date.parse('2026-10-24T18:00:00Z');
const HOUR = 60 * 60 * 1000;
const TZ = 'America/Chicago';

const SAM = { id: 'u7', firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com' };
const JORDAN = { id: 'u8', firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' };

const usedCheck = (over = {}) => ({
  canDelete: true,
  blockers: [],
  confirmEmail: 'sam@example.com',
  kind: 'used',
  usage: {
    signedIn: true,
    fieldRecordsHere: true,
    fbtimeHours: false,
    crew: { people: 6, campaigns: 2 },
    wasCoordinator: true,
    ...over.usage,
  },
  holding: {
    campaigns: 2,
    books: { soleHolder: 2, shared: 1 },
    effortCrews: 0,
    leadGrants: 0,
    membershipActive: true,
    retained: { days: 180 },
    ...over.holding,
  },
});

const unusedCheck = (over = {}) => ({
  canDelete: true,
  blockers: [],
  confirmEmail: 'jordan@example.com',
  kind: 'unused',
  usage: { signedIn: false, fieldRecordsHere: false, fbtimeHours: false, crew: { people: 0, campaigns: 0 }, wasCoordinator: false, ...over.usage },
  holding: {
    campaigns: 1,
    books: { soleHolder: 2, shared: 0 },
    effortCrews: 0,
    leadGrants: 0,
    membershipActive: true,
    retained: { days: 180 },
    ...over.holding,
  },
  ...over.top,
});

const SAM_STATS = { doorsKnocked: 1200, restricted: 84, surveysSubmitted: 312, lastActivityAt: new Date(NOW - 2 * HOUR).toISOString() };
const NO_STATS = { doorsKnocked: 0, restricted: 0, surveysSubmitted: 0, lastActivityAt: null };

test('the review for someone who did work here reads as the mockup', () => {
  const lines = reviewLines({ user: SAM, check: usedCheck(), stats: SAM_STATS, now: NOW });
  assert.equal(lines.didWork, true);
  assert.deepEqual(lines.callout, [
    "Sam's phone sent doors 2 hours ago. Ask them to open the app with signal first, so it sends everything it's still holding.",
  ]);
  assert.equal(lines.intro, null);
  assert.deepEqual(lines.bullets, [
    `Their ${(1284).toLocaleString()} door results and 312 surveys stay. Nothing on your reports or your bill changes.`,
    'Their login and contact details are erased now. Doorline keeps their name privately for 180 days, so it still shows on canvasser reports, team labels, the GPS audit and exports; then it shows "Deleted user". The map and door history show "Deleted user" right away.',
    'They coordinate a crew of 6 on 2 campaigns. Those people will have no coordinator until you set one.',
    '2 books go back to unassigned; 1 stays with the other canvassers on it. They come off 2 campaigns.',
    "If they come back, they'll need a new account.",
  ]);
  assert.equal(lines.removeHint, true, '"Usually you want Remove from org instead." closes this variant');
});

test('a USED account with no work here keeps its name: only an unused one is told the name is erased', () => {
  // A crew coordinator who never knocked: signed in, so 'used', and the record keeps their name.
  const lines = reviewLines({
    user: JORDAN,
    check: usedCheck({ usage: { fieldRecordsHere: false, crew: { people: 2, campaigns: 1 } }, holding: { campaigns: 1, books: { soleHolder: 0, shared: 0 } } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.equal(lines.didWork, false);
  assert.equal(lines.intro, 'They coordinate a crew of 2 on 1 campaign. Those people will have no coordinator until you set one.');
  assert.equal(
    lines.bullets[0],
    'Their email, phone and password are erased, and any invite we emailed stops working. Doorline keeps their name privately for 180 days.'
  );
  assert.equal(lines.bullets.at(-1), 'Their row stays as Deleted account.');
});

test('the review for someone with no work here reads as the mockup', () => {
  const lines = reviewLines({ user: JORDAN, check: unusedCheck(), stats: NO_STATS, now: NOW });
  assert.equal(lines.didWork, false);
  assert.deepEqual(lines.callout, [], 'nobody ever signed in, so there is no phone to ask about');
  assert.equal(lines.intro, 'Jordan has no door results or surveys on your records.');
  assert.deepEqual(lines.bullets, [
    'Their name, email, phone and password are erased, and any invite we emailed stops working.',
    'They come off 1 campaign; 2 books go back to unassigned.',
    'jordan@example.com is freed, so you can add it again as a new account.',
    'They disappear from your Users list.',
  ]);
  assert.equal(lines.removeHint, false);
});

test('no work here, but used: the row stays, the phone is asked about, a crew line replaces the intro', () => {
  // Signed in, never recorded anything: still a used account.
  const signedIn = reviewLines({
    user: JORDAN,
    check: unusedCheck({ top: { kind: 'used' }, usage: { signedIn: true } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.equal(signedIn.bullets.at(-1), 'Their row stays as Deleted account.');
  assert.deepEqual(signedIn.callout, [
    "Ask Jordan to open the app with signal first, so their phone sends everything it's still holding.",
  ]);

  const coordinator = reviewLines({
    user: JORDAN,
    check: unusedCheck({ top: { kind: 'used' }, usage: { crew: { people: 1, campaigns: 1 }, wasCoordinator: true } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.equal(coordinator.intro, 'They coordinate a crew of 1 on 1 campaign. That person will have no coordinator until you set one.');
  assert.ok(!coordinator.bullets.some((b) => /no door results/.test(b)));
});

test('the sync line is the stronger one only within the last 7 days', () => {
  const at = (ms) => ({ ...SAM_STATS, lastActivityAt: new Date(NOW - ms).toISOString() });
  const line = (ms) => reviewLines({ user: SAM, check: usedCheck(), stats: at(ms), now: NOW }).callout[0];
  assert.equal(
    line(6 * 24 * HOUR),
    "Sam's phone sent doors 6 days ago. Ask them to open the app with signal first, so it sends everything it's still holding."
  );
  assert.equal(line(8 * 24 * HOUR), "Ask Sam to open the app with signal first, so their phone sends everything it's still holding.");
  const never = reviewLines({ user: SAM, check: usedCheck(), stats: { ...SAM_STATS, lastActivityAt: null }, now: NOW });
  assert.equal(never.callout[0], "Ask Sam to open the app with signal first, so their phone sends everything it's still holding.");
});

test('a switched-off account gets the deactivated line after the sync line', () => {
  const lines = reviewLines({ user: SAM, check: usedCheck({ holding: { membershipActive: false } }), stats: SAM_STATS, now: NOW });
  assert.equal(lines.callout.length, 2);
  assert.equal(
    lines.callout[1],
    "Sam is switched off (deactivated), so their phone can't send anything: whatever it already tried to send while switched off was refused and thrown away. Switch them back on first if the doors it still holds matter (once billing is sorted, if it's paused)."
  );
  const unused = reviewLines({ user: JORDAN, check: unusedCheck({ holding: { membershipActive: false } }), stats: NO_STATS, now: NOW });
  assert.deepEqual(unused.callout, [], 'an account nobody used has no phone queue to warn about');
});

test('counts read naturally at 1, at 0, and with only part of the picture', () => {
  const one = reviewLines({
    user: SAM,
    check: usedCheck({ holding: { campaigns: 1, books: { soleHolder: 1, shared: 0 } }, usage: { crew: { people: 0, campaigns: 0 } } }),
    stats: { doorsKnocked: 1, restricted: 0, surveysSubmitted: 0, lastActivityAt: null },
    now: NOW,
  });
  assert.equal(one.bullets[0], 'Their 1 door result stays. Nothing on your reports or your bill changes.');
  assert.ok(one.bullets.includes('1 book goes back to unassigned. They come off 1 campaign.'));
  assert.ok(!one.bullets.some((b) => /coordinate/.test(b)), 'no crew, no crew line');

  const sharedOnly = reviewLines({
    user: SAM,
    check: usedCheck({ holding: { campaigns: 0, books: { soleHolder: 0, shared: 3 }, effortCrews: 1, leadGrants: 2 } }),
    stats: SAM_STATS,
    now: NOW,
  });
  assert.ok(
    sharedOnly.bullets.includes('3 books stay with the other canvassers on them. They come off 1 effort crew and 2 team-lead grants.')
  );

  const nothingHeld = reviewLines({
    user: JORDAN,
    check: unusedCheck({ holding: { campaigns: 0, books: { soleHolder: 0, shared: 0 } } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.deepEqual(nothingHeld.bullets, [
    'Their name, email, phone and password are erased, and any invite we emailed stops working.',
    'jordan@example.com is freed, so you can add it again as a new account.',
    'They disappear from your Users list.',
  ]);

  const shared = reviewLines({
    user: JORDAN,
    check: unusedCheck({ holding: { campaigns: 2, books: { soleHolder: 2, shared: 1 } } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.equal(shared.bullets[1], 'They come off 2 campaigns; 2 books go back to unassigned, and 1 stays with the other canvassers on it.');

  const hoursOnly = reviewLines({
    user: SAM,
    check: usedCheck({ usage: { fieldRecordsHere: false, fbtimeHours: true } }),
    stats: NO_STATS,
    now: NOW,
  });
  assert.equal(hoursOnly.didWork, true, 'FbTime hours are work here');
  assert.equal(hoursOnly.bullets[0], 'Their FbTime hours stay. Nothing on your reports or your bill changes.');
});

test('door results count restricted doors; any record on the stats beats the preflight flag', () => {
  const lines = reviewLines({
    user: SAM,
    check: usedCheck({ usage: { fieldRecordsHere: false } }),
    stats: { doorsKnocked: 0, restricted: 4, surveysSubmitted: 0, lastActivityAt: null },
    now: NOW,
  });
  assert.equal(lines.didWork, true, 'never say "no door results" over a screen that shows some');
  assert.equal(lines.bullets[0], 'Their 4 door results stay. Nothing on your reports or your bill changes.');
});

test('a person with no first name still gets whole sentences', () => {
  const nameless = { id: 'u9', firstName: '', lastName: '', email: 'x@example.com' };
  const lines = reviewLines({ user: nameless, check: usedCheck({ holding: { membershipActive: false } }), stats: SAM_STATS, now: NOW });
  assert.match(lines.callout[0], /^Their phone sent doors 2 hours ago\. Ask them/);
  assert.match(lines.callout[1], /^They're switched off/);
  const none = reviewLines({ user: nameless, check: unusedCheck(), stats: NO_STATS, now: NOW });
  assert.equal(none.intro, 'They have no door results or surveys on your records.');
  assert.equal(fullName(nameless), 'x@example.com');
  assert.equal(fullName(SAM), 'Sam Rivera');
});

test('the deletion line reads the five ways the contract names, and never a blank date', () => {
  const at = '2026-10-23T15:00:00Z';
  const day = formatDateInTz(at, TZ);
  assert.equal(deletionLine(null, TZ), DELETED_ACCOUNT);
  assert.equal(deletionLine({ at, how: 'admin', byName: 'Alex Kim' }, TZ), `Deleted ${day} by Alex Kim`);
  assert.equal(deletionLine({ at, how: 'admin', byName: null }, TZ), `Deleted ${day} by an admin`);
  assert.equal(deletionLine({ at, how: 'self' }, TZ), `Deleted their own account ${day}`);
  assert.equal(deletionLine({ at, how: 'support' }, TZ), `Deleted through Doorline support ${day}`);
  assert.equal(deletionLine({ at, how: 'unknown' }, TZ), `Deleted ${day}`);
  assert.equal(day, 'Oct 23, 2026', 'the date reads as the mockup writes it (en-US)');
  // A missing date drops out rather than leaving a double space.
  assert.equal(deletionLine({ at: null, how: 'admin', byName: 'Alex Kim' }, TZ), 'Deleted by Alex Kim');
  assert.equal(deletionLine({ at: null, how: 'unknown' }, TZ), DELETED_ACCOUNT);
  assert.equal(deletionLine({ at, how: 'something-new' }, TZ), `Deleted ${day}`, 'an unknown kind degrades to the plain date');
});

test('who is offered Delete, and who may Remove a billing-access row', () => {
  const live = (over = {}) => ({ role: 'canvasser', billingAccess: false, ...over, user: { id: 'u7', isDeleted: false, isSuperAdmin: false, ...over.user } });
  const offer = (membership, extra = {}) => canOfferDelete({ isOrgAdmin: true, isSelf: false, membership, viewerBilling: false, ...extra });

  assert.equal(offer(live()), true);
  assert.equal(offer(live(), { isOrgAdmin: false }), false, 'team leads never see it');
  assert.equal(offer(live(), { isSelf: true }), false, 'not on your own profile');
  assert.equal(offer(live({ user: { isDeleted: true } })), false, 'not on a deleted account');
  assert.equal(offer(live({ user: { isSuperAdmin: true } })), false, 'not on a Doorline staff account');
  assert.equal(offer(live({ role: 'admin', billingAccess: true })), false, 'billing-access target, viewer without it');
  assert.equal(offer(live({ role: 'admin', billingAccess: true }), { viewerBilling: true }), true);

  assert.equal(billingLocked(live({ billingAccess: true }), false), true, 'Remove hides on a live billing-access row');
  assert.equal(billingLocked(live({ billingAccess: true }), true), false);
  assert.equal(billingLocked(live({ billingAccess: true, user: { isDeleted: true } }), false), false, 'a deleted row is exempt');

  assert.equal(viewerHasBillingAccess({ isSuperAdmin: true, activeMembership: null }), true);
  assert.equal(viewerHasBillingAccess({ isSuperAdmin: false, activeMembership: { billingAccess: true } }), true);
  assert.equal(viewerHasBillingAccess({ isSuperAdmin: false, activeMembership: undefined }), false);
});

test('the typed email matches trimmed and case-insensitively, and never against nothing', () => {
  assert.equal(confirmMatches('  Sam@Example.com ', 'sam@example.com'), true);
  assert.equal(confirmMatches('sam@example.co', 'sam@example.com'), false);
  assert.equal(confirmMatches('', ''), false);
  assert.equal(confirmMatches('anything', undefined), false);
});

test('sentAgo spells the time out', () => {
  assert.equal(sentAgo(NOW - 20 * 1000, NOW), 'just now');
  assert.equal(sentAgo(NOW - 60 * 1000, NOW), '1 minute ago');
  assert.equal(sentAgo(NOW - 35 * 60 * 1000, NOW), '35 minutes ago');
  assert.equal(sentAgo(NOW - HOUR, NOW), '1 hour ago');
  assert.equal(sentAgo(NOW - 30 * HOUR, NOW), '1 day ago');
  assert.equal(sentAgo(NOW + 5 * 60 * 1000, NOW), 'just now', 'a phone clock ahead of ours is not "in the future"');
  assert.equal(sentAgo('not a date', NOW), null);
});

test('the notice names who was deleted', () => {
  assert.equal(deletedNotice('Sam Rivera'), "Sam Rivera's account was deleted.");
  assert.equal(goneNotice('Sam Rivera'), 'Sam Rivera is no longer in your organization.');
});

// Shaped as api/client.js throws them: the server's words, its code, and the parsed body. A dropped
// connection is fetch's own TypeError, with no body at all; a server fault may have no code.
const refusal = (status, body) => Object.assign(new Error(body.error), { status, code: body.code || null, data: body });
const NO_ANSWER = new TypeError('Failed to fetch');
const FAULT = Object.assign(new Error('Request failed: 503'), { status: 503, code: null, data: { raw: '<html>Application error</html>' } });

test('a failed delete: gone already, the review again, or the server’s words', () => {
  const deleted = refusal(409, { error: 'This account was deleted.', code: 'ALREADY_DELETED' });
  const notHere = refusal(404, { error: 'Member not in this org', code: 'NOT_A_MEMBER' });
  assert.equal(goneOutcome(deleted), 'deleted', 'perhaps this very delete, its answer lost');
  assert.equal(goneOutcome(notHere), 'gone', "an unused account's delete removes the row");
  assert.equal(goneOutcome(NO_ANSWER), null);
  assert.equal(goneOutcome(null), null);

  assert.equal(afterFailedDelete(deleted), 'deleted');
  assert.equal(afterFailedDelete(notHere), 'gone');
  assert.equal(afterFailedDelete(refusal(409, { error: 'Something changed.', code: 'USAGE_CHANGED' })), 'review');
  assert.equal(afterFailedDelete(refusal(409, { error: 'No.', code: 'BLOCKED', blockers: [] })), 'review');
  assert.equal(afterFailedDelete(refusal(400, { error: 'Type it exactly.', code: 'confirm-email-mismatch' })), 'refused');
  assert.equal(afterFailedDelete(refusal(409, { error: 'Under way.', code: 'DELETION_IN_PROGRESS' })), 'refused');
  assert.equal(afterFailedDelete(NO_ANSWER), 'unconfirmed', 'no answer: it may have landed');
  assert.equal(afterFailedDelete(FAULT), 'unconfirmed', 'a server fault with no code is no answer either');
});

test('the note on top of a reloaded review', () => {
  const blocked = refusal(409, {
    error: 'This account can’t be deleted.',
    code: 'BLOCKED',
    blockers: [
      { code: 'LAST_ADMIN', message: 'This person is the only admin. Make someone else an admin first.' },
      { code: 'X', message: '' },
    ],
  });
  assert.deepEqual(reloadNote(blocked), ['This person is the only admin. Make someone else an admin first.'], 'the reasons themselves');
  assert.deepEqual(
    reloadNote(refusal(409, { error: 'This account can’t be deleted.', code: 'BLOCKED', blockers: [] })),
    ['This account can’t be deleted.'],
    'no reasons given: the server’s own words'
  );
  assert.deepEqual(reloadNote(NO_ANSWER), [
    "Doorline couldn't confirm the delete (Failed to fetch), so the review was loaded again. If the account is already gone, this closes on its own.",
  ]);
  assert.deepEqual(reloadNote(new TypeError('')), [
    "Doorline couldn't confirm the delete, so the review was loaded again. If the account is already gone, this closes on its own.",
  ]);
  assert.deepEqual(reloadNote(refusal(409, { error: 'Something changed. Review it again.', code: 'USAGE_CHANGED' })), [
    'Something changed. Review it again.',
  ]);
});

test('small pieces', () => {
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('lead'), 'Team lead');
  assert.equal(roleLabel('canvasser'), 'Canvasser');
  assert.deepEqual(deleteAccountMutationKey('u7'), ['admin', 'delete-member-account', 'u7']);
});
