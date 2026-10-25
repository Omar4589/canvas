import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from './dates.js';
import {
  DELETED_ACCOUNT_LABEL,
  REMOVE_HINT,
  RECENT_SYNC_MS,
  reviewTitle,
  confirmTitle,
  reviewSub,
  deleteAccountBlurb,
  accountDeletedText,
  goneNotice,
  displayName,
  emailMatches,
  agoPhrase,
  sentRecently,
  reviewLines,
  goneOutcome,
  afterFailedDelete,
  reloadNote,
  deletionLine,
  viewerHasBillingAccess,
  mayOfferDelete,
  DELETION_CACHE_KEYS,
  touchedByDeletion,
  mayOfferRemove,
  removeConfirm,
} from './memberDeletion.js';

// The phone's half of an org admin deleting a member's account (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md
// §E1). The copy is Part 1's, so these pin its mockups sentence by sentence: the review someone who
// did work here gets, the one for an account nobody used, and the lines that change with
// circumstances. Then the typed-email check, the deleted rows' line, and who is offered the option.

const NOW = Date.parse('2026-10-24T18:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();

const sam = { firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com', role: 'canvasser' };
const jordan = { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', role: 'canvasser' };

// The preflight's canDelete answer (GET /admin/memberships/:userId/deletion-check).
const preflight = (over = {}) => ({
  canDelete: true,
  blockers: [],
  confirmEmail: 'sam@example.com',
  kind: 'used',
  ...over,
  usage: {
    signedIn: true,
    fieldRecordsHere: true,
    fbtimeHours: false,
    crew: { people: 0, campaigns: 0 },
    wasCoordinator: false,
    ...over.usage,
  },
  holding: {
    campaigns: 0,
    books: { soleHolder: 0, shared: 0 },
    effortCrews: 0,
    leadGrants: 0,
    membershipActive: true,
    retained: { days: 180 },
    ...over.holding,
  },
});
// The profile's lifetime stats (GET /admin/memberships/:userId/stats).
const stats = (over = {}) => ({
  doorsKnocked: 0,
  restricted: 0,
  surveysSubmitted: 0,
  litDropped: 0,
  distanceMeters: 0,
  campaignsWorked: 0,
  lastActivityAt: null,
  ...over,
});

const RETENTION_180 =
  'Their login and contact details are erased now. Doorline keeps their name privately for 180 days, so it still shows on canvasser reports, team labels, the GPS audit and exports; then it shows "Deleted user". The map and door history show "Deleted user" right away.';
const ASK_SAM = "Ask Sam to open the app with signal first, so their phone sends everything it's still holding.";

test("the review for someone who did work here reads as Part 1's mockup", () => {
  const review = reviewLines({
    person: sam,
    check: preflight({
      usage: { crew: { people: 6, campaigns: 2 }, wasCoordinator: true },
      holding: { campaigns: 2, books: { soleHolder: 2, shared: 1 } },
    }),
    // 1,270 knocks + 14 restricted = 1,284 door results.
    stats: stats({ doorsKnocked: 1270, restricted: 14, surveysSubmitted: 312, lastActivityAt: ago(2 * HOUR) }),
    now: NOW,
  });
  assert.deepEqual(review.callout, [
    "Sam's phone sent doors 2 hours ago. Ask them to open the app with signal first, so it sends everything it's still holding.",
  ]);
  assert.equal(review.intro, null);
  assert.deepEqual(review.bullets, [
    `Their ${(1284).toLocaleString()} door results and 312 surveys stay. Nothing on your reports or your bill changes.`,
    RETENTION_180,
    'They coordinate a crew of 6 on 2 campaigns. Those people will have no coordinator until you set one.',
    '2 books go back to unassigned; 1 stays with the other canvassers on it. They come off 2 campaigns.',
    "If they come back, they'll need a new account.",
  ]);
  assert.equal(review.removeHint, true);
  assert.equal(REMOVE_HINT, 'Usually you want Remove from org instead.');
});

test('a USED account with no work here keeps its name: only an unused one is told the name is erased', () => {
  // A crew coordinator who never knocked: signed in, so 'used', and the record keeps their name.
  const review = reviewLines({
    person: jordan,
    check: preflight({
      confirmEmail: 'jordan@example.com',
      usage: { fieldRecordsHere: false, crew: { people: 2, campaigns: 1 }, wasCoordinator: true },
      holding: { campaigns: 1 },
    }),
    stats: stats(),
    now: NOW,
  });
  assert.equal(review.intro, 'They coordinate a crew of 2 on 1 campaign. Those people will have no coordinator until you set one.');
  assert.equal(
    review.bullets[0],
    'Their email, phone and password are erased, and any invite we emailed stops working. Doorline keeps their name privately for 180 days.'
  );
  assert.equal(review.bullets.at(-1), 'Their row stays as Deleted account.');
});

test("the review for an account nobody used reads as Part 1's mockup", () => {
  const review = reviewLines({
    person: jordan,
    check: preflight({
      kind: 'unused',
      confirmEmail: 'jordan@example.com',
      usage: { signedIn: false, fieldRecordsHere: false },
      holding: { campaigns: 1, books: { soleHolder: 2, shared: 0 } },
    }),
    stats: stats(),
    now: NOW,
  });
  // Never signed in, so there is no phone to ask about.
  assert.deepEqual(review.callout, []);
  assert.equal(review.intro, 'Jordan has no door results or surveys on your records.');
  assert.deepEqual(review.bullets, [
    'Their name, email, phone and password are erased, and any invite we emailed stops working.',
    'They come off 1 campaign; 2 books go back to unassigned.',
    'jordan@example.com is freed, so you can add it again as a new account.',
    'They disappear from your Users list.',
  ]);
  assert.equal(review.removeHint, false);
});

test('a used account with no work keeps its row, and is still asked to sync', () => {
  // Signed in, never knocked here: 'used', so the row stays — and a phone may hold unsent doors.
  const review = reviewLines({
    person: jordan,
    check: preflight({ confirmEmail: 'jordan@example.com', usage: { fieldRecordsHere: false } }),
    stats: stats(),
    now: NOW,
  });
  assert.equal(review.bullets.at(-1), 'Their row stays as Deleted account.');
  assert.equal(review.intro, 'Jordan has no door results or surveys on your records.');
  assert.deepEqual(review.callout, [
    "Ask Jordan to open the app with signal first, so their phone sends everything it's still holding.",
  ]);
  assert.equal(review.removeHint, false);
});

test("a crew coordinator's crew line takes the place of 'no door results or surveys'", () => {
  const review = reviewLines({
    person: jordan,
    check: preflight({
      confirmEmail: 'jordan@example.com',
      usage: { signedIn: false, fieldRecordsHere: false, crew: { people: 1, campaigns: 1 }, wasCoordinator: true },
    }),
    stats: stats(),
    now: NOW,
  });
  assert.equal(
    review.intro,
    'They coordinate a crew of 1 on 1 campaign. That person will have no coordinator until you set one.'
  );
  assert.ok(!review.bullets.some((l) => l.includes('no door results')));
  assert.equal(review.bullets.at(-1), 'Their row stays as Deleted account.');
});

test('the sync line is the stronger one only for doors sent in the last week', () => {
  const callout = (lastActivityAt) =>
    reviewLines({ person: sam, check: preflight(), stats: stats({ doorsKnocked: 3, lastActivityAt }), now: NOW }).callout;
  assert.match(callout(ago(6 * DAY + 23 * HOUR))[0], /^Sam's phone sent doors 6 days ago\. Ask them/);
  assert.match(callout(ago(RECENT_SYNC_MS))[0], /^Sam's phone sent doors 7 days ago\./, 'a week to the minute still counts');
  assert.deepEqual(callout(ago(RECENT_SYNC_MS + 60 * 1000)), [ASK_SAM]);
  assert.deepEqual(callout(ago(30 * DAY)), [ASK_SAM]);
  // No activity on record, or a value that isn't a date: the plain ask, never a broken sentence.
  assert.deepEqual(callout(null), [ASK_SAM]);
  assert.deepEqual(callout('not a date'), [ASK_SAM]);
  // An unused account gets none.
  assert.deepEqual(reviewLines({ person: sam, check: preflight({ kind: 'unused' }), stats: stats(), now: NOW }).callout, []);
});

test('a deactivated person is told their phone cannot send until they are switched back on', () => {
  const callout = reviewLines({
    person: sam,
    check: preflight({ holding: { membershipActive: false } }),
    stats: stats({ doorsKnocked: 3, lastActivityAt: ago(3 * HOUR) }),
    now: NOW,
  }).callout;
  assert.deepEqual(callout, [
    "Sam's phone sent doors 3 hours ago. Ask them to open the app with signal first, so it sends everything it's still holding.",
    "Sam is switched off (deactivated), so their phone can't send anything: whatever it already tried to send while switched off was refused and thrown away. Switch them back on first if the doors it still holds matter (once billing is sorted, if it's paused).",
  ]);
});

test('with no first name the sentences say "they", and titles fall back to the email', () => {
  const nameless = { email: 'x@example.com', role: 'canvasser' };
  const used = reviewLines({
    person: nameless,
    check: preflight({ confirmEmail: 'x@example.com', usage: { fieldRecordsHere: false }, holding: { membershipActive: false } }),
    stats: stats({ lastActivityAt: ago(HOUR) }),
    now: NOW,
  });
  assert.match(used.callout[0], /^Their phone sent doors 1 hour ago\./);
  assert.match(used.callout[1], /^They're switched off \(deactivated\)/);
  assert.equal(used.intro, 'They have no door results or surveys on your records.');
  assert.match(
    reviewLines({ person: nameless, check: preflight(), stats: stats({ doorsKnocked: 1 }), now: NOW }).callout[0],
    /^Ask them to open the app/
  );
  assert.equal(reviewTitle(nameless), "Delete x@example.com's account?");
  assert.match(deleteAccountBlurb(nameless), /^Permanently deletes this person's Doorline account\./);
});

test('what stays agrees with its count, and never claims work that is not there', () => {
  const work = (statsOver, usageOver = {}) =>
    reviewLines({ person: sam, check: preflight({ usage: usageOver }), stats: stats(statsOver), now: NOW }).bullets[0];
  const after = 'Nothing on your reports or your bill changes.';
  assert.equal(work({ doorsKnocked: 1 }), `Their 1 door result stays. ${after}`);
  assert.equal(work({ restricted: 1 }), `Their 1 door result stays. ${after}`, 'restricted doors are door results');
  assert.equal(work({ surveysSubmitted: 1 }), `Their 1 survey stays. ${after}`);
  assert.equal(work({ doorsKnocked: 5 }), `Their 5 door results stay. ${after}`);
  assert.equal(work({ doorsKnocked: 1, surveysSubmitted: 1 }), `Their 1 door result and 1 survey stay. ${after}`);
  // Records on the ledger the stats didn't count, and hours with no doors: still the work variant.
  assert.equal(work({}), `Everything they recorded here stays. ${after}`);
  assert.equal(work({}, { fieldRecordsHere: false, fbtimeHours: true }), `Their FbTime hours stay. ${after}`);
});

test('books, campaigns, crews and grants read as Part 1 has them, and only what they hold', () => {
  const bullets = (holding, usage) =>
    reviewLines({ person: sam, check: preflight({ holding, usage }), stats: stats(usage ? {} : { doorsKnocked: 2 }), now: NOW })
      .bullets;
  assert.ok(bullets({ books: { soleHolder: 0, shared: 1 } }).includes('1 book stays with the other canvassers on it.'));
  assert.ok(bullets({ books: { soleHolder: 0, shared: 3 } }).includes('3 books stay with the other canvassers on them.'));
  assert.ok(
    bullets({ books: { soleHolder: 1, shared: 2 } }).includes(
      '1 book goes back to unassigned; 2 stay with the other canvassers on them.'
    )
  );
  assert.ok(
    bullets({ campaigns: 3, effortCrews: 1, leadGrants: 2 }).includes(
      'They come off 3 campaigns, 1 effort crew and 2 team-lead grants.'
    )
  );
  // The no-work variant leads with what they come off, as its mockup does.
  assert.ok(
    bullets({ campaigns: 1, books: { soleHolder: 2, shared: 1 } }, { fieldRecordsHere: false }).includes(
      'They come off 1 campaign; 2 books go back to unassigned, and 1 stays with the other canvassers on it.'
    )
  );
  // Holding nothing: no line, rather than an empty one.
  assert.deepEqual(bullets({}), [
    `Their 2 door results stay. Nothing on your reports or your bill changes.`,
    RETENTION_180,
    "If they come back, they'll need a new account.",
  ]);
  // The name window is the server's number, not a constant here.
  assert.ok(bullets({ retained: { days: 90 } })[1].includes('privately for 90 days'));
});

test('titles, the header line, the profile blurb and the list notice', () => {
  assert.equal(reviewTitle(sam), "Delete Sam Rivera's account?");
  assert.equal(confirmTitle(sam), "Delete Sam Rivera's account permanently?");
  assert.equal(reviewSub('canvasser', 'sam@example.com'), 'Canvasser · sam@example.com');
  assert.equal(reviewSub('lead', 'sam@example.com'), 'Team lead · sam@example.com');
  assert.equal(reviewSub('admin', null), 'Admin');
  assert.equal(reviewSub(undefined, 'sam@example.com'), 'Canvasser · sam@example.com');
  assert.equal(
    deleteAccountBlurb(sam),
    "Permanently deletes Sam's Doorline account. Usually you want Remove from org instead: it ends their access and keeps their name on your records."
  );
  assert.equal(accountDeletedText(sam), "Sam Rivera's account was deleted.");
});

test('the notices name the person exactly as written: no change of case, the email when there is no name', () => {
  assert.equal(accountDeletedText({ firstName: 'sam', lastName: 'rivera' }), "sam rivera's account was deleted.");
  assert.equal(accountDeletedText({ email: 'x@example.com' }), "x@example.com's account was deleted.");
  assert.equal(accountDeletedText({}), "this person's account was deleted.");
  assert.equal(displayName({ firstName: 'sam', lastName: 'rivera', email: 'sam@example.com' }), 'sam rivera');
  assert.equal(displayName({ firstName: ' ', lastName: '', email: 'x@example.com' }), 'x@example.com');
  assert.equal(goneNotice('Sam Rivera'), 'Sam Rivera is no longer in your organization.');
  assert.equal(goneNotice(displayName({ email: 'x@example.com' })), 'x@example.com is no longer in your organization.');
});

test('Delete permanently waits for the typed email to match, the way the server compares', () => {
  assert.equal(emailMatches('sam@example.com', 'sam@example.com'), true);
  assert.equal(emailMatches('  Sam@Example.COM ', 'sam@example.com'), true);
  assert.equal(emailMatches('sam@example.co', 'sam@example.com'), false);
  assert.equal(emailMatches('', 'sam@example.com'), false);
  // Nothing to match against (a preflight that never named one) never enables the button.
  assert.equal(emailMatches('', ''), false);
  assert.equal(emailMatches('a', undefined), false);
});

test('the relative time in the strong sync line', () => {
  assert.equal(agoPhrase(ago(20 * 1000), NOW), 'just now');
  assert.equal(agoPhrase(ago(60 * 1000), NOW), '1 minute ago');
  assert.equal(agoPhrase(ago(45 * 60 * 1000), NOW), '45 minutes ago');
  assert.equal(agoPhrase(ago(HOUR), NOW), '1 hour ago');
  assert.equal(agoPhrase(ago(DAY), NOW), '1 day ago');
  assert.equal(agoPhrase(null, NOW), null);
  // A phone clock ahead of the server reads as now, not as a negative time.
  assert.equal(agoPhrase(new Date(NOW + 5 * 60 * 1000).toISOString(), NOW), 'just now');
  assert.equal(sentRecently(ago(HOUR), NOW), true);
  assert.equal(sentRecently(null, NOW), false);
});

const refusal = (status, code, error = 'x', extra = {}) =>
  Object.assign(new Error(error), { status, data: { code, error, ...extra } });

test('an account already gone ends the flow as a success would: deleted, or out of this org', () => {
  assert.equal(goneOutcome(refusal(409, 'ALREADY_DELETED', 'This account was already deleted.')), 'deleted');
  assert.equal(goneOutcome(refusal(404, 'NOT_A_MEMBER', 'Member not in this org')), 'gone');
  for (const code of ['USAGE_CHANGED', 'BLOCKED', 'DELETION_IN_PROGRESS', 'ADMIN_ONLY', undefined]) {
    assert.equal(goneOutcome(refusal(409, code)), null, String(code));
  }
  assert.equal(goneOutcome(new Error('Request timed out')), null);
  assert.equal(goneOutcome(null), null);
});

test("a failed DELETE: leave if it's gone, review again if the review is stale or the answer never came", () => {
  // A retry after a lost answer: the first delete did it.
  assert.equal(afterFailedDelete(refusal(409, 'ALREADY_DELETED')), 'deleted');
  assert.equal(afterFailedDelete(refusal(404, 'NOT_A_MEMBER')), 'gone');
  assert.equal(afterFailedDelete(refusal(409, 'USAGE_CHANGED')), 'review');
  assert.equal(afterFailedDelete(refusal(409, 'BLOCKED')), 'review');
  // No server code: no signal, a timeout, a server fault — it may or may not have happened.
  assert.equal(afterFailedDelete(Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' })), 'unconfirmed');
  assert.equal(afterFailedDelete(new TypeError('Network request failed')), 'unconfirmed');
  assert.equal(
    afterFailedDelete(Object.assign(new Error('Request failed: 502'), { status: 502, data: { raw: 'Bad gateway' } })),
    'unconfirmed'
  );
  for (const code of ['DELETION_IN_PROGRESS', 'confirm-email-mismatch', 'ADMIN_ONLY', 'SESSION_REVOKED']) {
    assert.equal(afterFailedDelete(refusal(409, code)), 'refused', code);
  }
});

test("the note on a reloaded review: a block's own reasons, a stale review's words, or an unconfirmed delete", () => {
  // BLOCKED's message only says "not yet"; the reasons are what the admin needs, even if the cause
  // has cleared by the time the review reloads.
  assert.deepEqual(
    reloadNote(
      refusal(409, 'BLOCKED', 'This account cannot be deleted yet.', {
        blockers: [
          { code: 'LAST_ADMIN', message: 'Sam is the only admin. Make someone else an admin first.' },
          { code: 'OTHER_ORGANIZATION', message: 'Sam is in another organization. Use Remove from org instead.' },
        ],
      })
    ),
    [
      'Sam is the only admin. Make someone else an admin first.',
      'Sam is in another organization. Use Remove from org instead.',
    ]
  );
  assert.deepEqual(reloadNote(refusal(409, 'BLOCKED', 'This account cannot be deleted yet.')), [
    'This account cannot be deleted yet.',
  ]);
  assert.deepEqual(reloadNote(refusal(409, 'USAGE_CHANGED', 'They signed in since the review.')), [
    'They signed in since the review.',
  ]);
  assert.deepEqual(reloadNote(Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' })), [
    "Doorline couldn't confirm the delete (Request timed out), so the review was loaded again. If the account is already gone, this closes on its own.",
  ]);
  assert.deepEqual(reloadNote({}), [
    "Doorline couldn't confirm the delete, so the review was loaded again. If the account is already gone, this closes on its own.",
  ]);
});

test("a deleted account's line names who deleted it and when — never more", () => {
  const at = '2026-10-23T15:00:00Z';
  const day = formatDate(at);
  assert.equal(deletionLine(null), DELETED_ACCOUNT_LABEL);
  assert.equal(deletionLine(undefined), 'Deleted account');
  assert.equal(deletionLine({ at, how: 'admin', byName: 'Alex Kim' }), `Deleted ${day} by Alex Kim`);
  assert.equal(deletionLine({ at, how: 'admin', byName: null }), `Deleted ${day} by an admin`);
  assert.equal(deletionLine({ at, how: 'self' }), `Deleted their own account ${day}`);
  assert.equal(deletionLine({ at, how: 'support' }), `Deleted through Doorline support ${day}`);
  assert.equal(deletionLine({ at, how: 'unknown' }), `Deleted ${day}`);
  // No usable date: the sentence drops it rather than printing a dash.
  assert.equal(deletionLine({ how: 'admin', byName: 'Alex Kim' }), 'Deleted by Alex Kim');
  assert.equal(deletionLine({ at: 'nope', how: 'unknown' }), 'Deleted account');
});

test('More options shows for admins only, and never on a profile it could not act on', () => {
  const user = { isDeleted: false, isSuperAdmin: false };
  const base = { viewerRole: 'admin', isSelf: false, user, billingAccess: false, viewerHasBilling: false };
  assert.equal(mayOfferDelete(base), true);
  assert.equal(mayOfferDelete({ ...base, viewerRole: 'super' }), true);
  assert.equal(mayOfferDelete({ ...base, viewerRole: 'lead' }), false, 'team leads never get it');
  assert.equal(mayOfferDelete({ ...base, viewerRole: undefined }), false, 'role not resolved yet');
  assert.equal(mayOfferDelete({ ...base, isSelf: true }), false);
  assert.equal(mayOfferDelete({ ...base, user: { ...user, isDeleted: true } }), false);
  assert.equal(mayOfferDelete({ ...base, user: { ...user, isSuperAdmin: true } }), false);
  assert.equal(mayOfferDelete({ ...base, user: null }), false);
  // A member with billing access: only for a viewer who has it too.
  assert.equal(mayOfferDelete({ ...base, billingAccess: true }), false);
  assert.equal(mayOfferDelete({ ...base, billingAccess: true, viewerHasBilling: true }), true);
});

test("the viewer's billing access: a super admin, or their membership here", () => {
  assert.equal(viewerHasBillingAccess({ isSuperAdmin: true }, null), true);
  assert.equal(viewerHasBillingAccess({ isSuperAdmin: false }, { billingAccess: true }), true);
  assert.equal(viewerHasBillingAccess({ isSuperAdmin: false }, { billingAccess: false }), false);
  assert.equal(viewerHasBillingAccess(null, null), false);
});

test('a deletion refreshes the Users list, rosters, crews and books — and nothing else', () => {
  for (const key of DELETION_CACHE_KEYS) assert.equal(touchedByDeletion(['admin', key, 'c1']), true, key);
  assert.equal(touchedByDeletion(['admin', 'memberships']), true);
  assert.equal(touchedByDeletion(['admin', 'campaigns']), false);
  assert.equal(touchedByDeletion(['admin', 'reports', 'canvassers', 'c1']), false);
  assert.equal(touchedByDeletion(['mobile', 'memberships']), false);
  assert.equal(touchedByDeletion(undefined), false);
});

test('Remove from org is offered on the web\'s terms: admins only, never yourself, billing protects a live member', () => {
  const base = { viewerRole: 'admin', isSelf: false, user: { id: 'u1', email: 'sam@example.com' }, billingAccess: false, viewerHasBilling: false };
  assert.equal(mayOfferRemove(base), true);
  assert.equal(mayOfferRemove({ ...base, viewerRole: 'super' }), true);
  assert.equal(mayOfferRemove({ ...base, viewerRole: 'lead' }), false, 'a lead never (the server answers ADMIN_ONLY)');
  assert.equal(mayOfferRemove({ ...base, viewerRole: undefined }), false, 'not while the role is still loading');
  assert.equal(mayOfferRemove({ ...base, isSelf: true }), false);
  assert.equal(mayOfferRemove({ ...base, user: null }), false);
  assert.equal(mayOfferRemove({ ...base, billingAccess: true }), false, 'a billing-access member, to a viewer without it');
  assert.equal(mayOfferRemove({ ...base, billingAccess: true, viewerHasBilling: true }), true);
  assert.equal(
    mayOfferRemove({ ...base, billingAccess: true, user: { id: 'u2', isDeleted: true } }),
    true,
    'a deleted account’s row is exempt: anyone may tidy it away'
  );
  assert.equal(mayOfferRemove({ ...base, user: { id: 'u3', isSuperAdmin: true } }), true, 'the web offers it for a staff member too');
});

test('the Remove from org confirm reads as the web’s, and never prints a tombstone address', () => {
  assert.deepEqual(removeConfirm({ email: 'sam@example.com' }), {
    title: 'Remove sam@example.com from this organization?',
    body: 'This also removes their campaign assignments here.',
  });
  const gone = removeConfirm({ isDeleted: true, email: 'deleted+abc@deleted.doorline.invalid' });
  assert.deepEqual(gone, { title: 'Remove this deleted account from the organization?', body: 'Nothing on your reports changes.' });
  assert.ok(!JSON.stringify(gone).includes('doorline.invalid'));
});
