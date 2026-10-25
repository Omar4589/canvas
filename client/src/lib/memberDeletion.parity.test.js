import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './memberDeletion.js';
// Cross-tree on purpose (same pattern and caveats as sessionEnd.parity.test.js): deleting a member's
// account is reviewed on the web profile and on the phone's admin profile, and both must say exactly
// the same thing about what it will do — the copy the owner approved in
// docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md Part 1.
import * as phone from '../../../mobile/lib/memberDeletion.js';

const NOW = Date.parse('2026-10-24T18:00:00Z');
const H = 3600e3;
const D = 24 * H;

const people = [
  { firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com' },
  { firstName: '', lastName: '', email: 'x@example.com' },
];
const usages = [
  { fieldRecordsHere: true, fbtimeHours: false, crew: { people: 0, campaigns: 0 } },
  { fieldRecordsHere: false, fbtimeHours: false, crew: { people: 0, campaigns: 0 } },
  { fieldRecordsHere: false, fbtimeHours: true, crew: { people: 0, campaigns: 0 } },
  { fieldRecordsHere: true, fbtimeHours: false, crew: { people: 1, campaigns: 1 } },
  { fieldRecordsHere: false, fbtimeHours: false, crew: { people: 6, campaigns: 2 } },
  { fieldRecordsHere: true, fbtimeHours: false, crew: { people: 3, campaigns: 0 } },
];
const holdings = [
  { campaigns: 0, books: { soleHolder: 0, shared: 0 }, effortCrews: 0, leadGrants: 0, membershipActive: true },
  { campaigns: 2, books: { soleHolder: 2, shared: 1 }, effortCrews: 0, leadGrants: 0, membershipActive: true },
  { campaigns: 1, books: { soleHolder: 1, shared: 0 }, effortCrews: 1, leadGrants: 2, membershipActive: false },
  { campaigns: 3, books: { soleHolder: 0, shared: 3 }, effortCrews: 2, leadGrants: 1, membershipActive: true },
  { campaigns: 0, books: { soleHolder: 0, shared: 1 }, effortCrews: 0, leadGrants: 0, membershipActive: false },
].map((h) => ({ ...h, retained: { days: 180 } }));
const statsList = [
  { doorsKnocked: 0, restricted: 0, surveysSubmitted: 0, lastActivityAt: null },
  { doorsKnocked: 1270, restricted: 14, surveysSubmitted: 312, lastActivityAt: new Date(NOW - 2 * H).toISOString() },
  { doorsKnocked: 1, restricted: 0, surveysSubmitted: 0, lastActivityAt: new Date(NOW - 30 * D).toISOString() },
  { doorsKnocked: 0, restricted: 1, surveysSubmitted: 1, lastActivityAt: new Date(NOW - 7 * D).toISOString() },
  { doorsKnocked: 0, restricted: 0, surveysSubmitted: 1, lastActivityAt: new Date(NOW - 7 * D - 60e3).toISOString() },
  { doorsKnocked: 5, restricted: 0, surveysSubmitted: 0, lastActivityAt: new Date(NOW - 30e3).toISOString() },
];
const shown = (r) => ({ callout: r.callout, intro: r.intro, bullets: r.bullets, removeHint: r.removeHint });

test('the review reads word for word the same on the web and the phone, for every shape of account', () => {
  let n = 0;
  for (const person of people)
    for (const kind of ['used', 'unused'])
      for (const usage of usages)
        for (const holding of holdings)
          for (const stats of statsList) {
            const check = { canDelete: true, blockers: [], confirmEmail: person.email, kind, usage, holding };
            assert.deepEqual(
              shown(phone.reviewLines({ person, check, stats, now: NOW })),
              shown(web.reviewLines({ user: person, check, stats, now: NOW })),
              JSON.stringify({ person: person.firstName || person.email, kind, usage, holding, stats })
            );
            n += 1;
          }
  assert.equal(n, 720);
});

test('a deleted row, the notice and the typed-email check agree too', () => {
  // The phone formats in the device's zone, the web in the org's; compared here in one zone.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = '2026-10-23T15:00:00Z';
  for (const d of [
    null,
    { at, how: 'admin', byName: 'Alex Kim' },
    { at, how: 'admin', byName: null },
    { at, how: 'self' },
    { at, how: 'support' },
    { at, how: 'unknown' },
    { how: 'unknown' },
  ]) {
    assert.equal(phone.deletionLine(d), web.deletionLine(d, tz), JSON.stringify(d));
  }
  assert.equal(phone.accountDeletedText(people[0]), web.deletedNotice(web.fullName(people[0])));
  for (const [typed, email] of [
    [' SAM@example.com ', 'sam@example.com'],
    ['sam@example.co', 'sam@example.com'],
    ['', 'sam@example.com'],
  ]) {
    assert.equal(phone.emailMatches(typed, email), web.confirmMatches(typed, email), JSON.stringify([typed, email]));
  }
});

test('the notices after a delete read the same, with the name exactly as written', () => {
  for (const person of [
    { firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com' },
    // No change of case on either side: the name is shown as the admin typed it.
    { firstName: 'sam', lastName: 'rivera', email: 'sam@example.com' },
    // No name at all: the email stands in, untouched.
    { firstName: '', lastName: '', email: 'x@example.com' },
    { email: 'x@example.com' },
  ]) {
    const name = web.fullName(person);
    const what = JSON.stringify(person);
    assert.equal(phone.displayName(person), name, what);
    assert.equal(phone.accountDeletedText(person), web.deletedNotice(name), what);
    // An account no longer in the organization (a lost answer's NOT_A_MEMBER): the neutral notice.
    assert.equal(phone.goneNotice(phone.displayName(person)), web.goneNotice(name), what);
  }
  // Pinned outright as well, so the same slip on both sides still fails here.
  assert.equal(web.deletedNotice(web.fullName({ firstName: 'sam', lastName: 'rivera' })), "sam rivera's account was deleted.");
  assert.equal(web.goneNotice('x@example.com'), 'x@example.com is no longer in your organization.');
});

test('a failed delete is read the same way on both: what happens next, and the note on top', () => {
  const errs = [
    { data: { code: 'ALREADY_DELETED' }, message: 'This account was already deleted.' },
    { data: { code: 'NOT_A_MEMBER' }, message: 'Member not in this org' },
    { data: { code: 'USAGE_CHANGED' }, message: 'Something about this account changed since you reviewed it.' },
    { data: { code: 'BLOCKED', blockers: [{ code: 'LAST_ADMIN', message: 'They’re the only admin here. Make someone else an admin first.' }] }, message: 'This account can’t be deleted.' },
    { data: { code: 'BLOCKED', blockers: [] }, message: 'This account cannot be deleted yet.' },
    { data: { code: 'DELETION_IN_PROGRESS' }, message: 'A deletion of this account is already under way. Try again in a few minutes.' },
    { message: 'Failed to fetch' },
    { message: 'Request timed out' },
    {},
    null,
  ];
  for (const err of errs) {
    const at = JSON.stringify(err);
    assert.equal(phone.goneOutcome(err), web.goneOutcome(err), `goneOutcome ${at}`);
    assert.equal(phone.afterFailedDelete(err), web.afterFailedDelete(err), `afterFailedDelete ${at}`);
    if (err) assert.deepEqual(phone.reloadNote(err), web.reloadNote(err), `reloadNote ${at}`);
  }
});
