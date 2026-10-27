import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standing } from './rosterView.js';
import {
  STATE_WORDS,
  personAccess,
  personButtons,
  crewCheckLine,
  crewChangeLines,
  assignOneLine,
  crewConflictLine,
  RECENT_DOOR_ACTIONS,
  RECENT_FIRST,
  RECENT_MORE,
  recentLimit,
  nextRecentSkip,
  recentRows,
} from './personActions.js';

// One person on the phone (docs/PROPOSAL_PEOPLE_PAGES.md Part 1 "The person panel", §D.5, §G).

const person = (over = {}) => ({
  userId: 'u1',
  role: 'canvasser',
  status: 'active',
  isSuperAdmin: false,
  lastLoginAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  ...over,
});

const buttonsFor = (target, { viewerRole = 'admin', viewerId = 'me', paused = false, canUnpause = false, onCampaign = true } = {}) => {
  const st = standing(target, paused ? new Set([target.userId]) : new Set());
  const access = personAccess({ viewerRole, viewerId, target, onCampaign, campaignWritable: true });
  return personButtons({ st, access, canUnpause });
};

test('the buttons at the top follow where they stand (Part 1’s table)', () => {
  assert.deepEqual(buttonsFor(person({ status: 'deactivated' })), { top: ['reactivate'], more: ['remove'] });
  assert.deepEqual(buttonsFor(person({ lastLoginAt: null })), { top: ['resend', 'temp-password'], more: ['deactivate', 'remove'] });
  assert.deepEqual(buttonsFor(person({ lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' })), {
    top: ['temp-password'],
    more: ['resend', 'deactivate', 'remove'],
  });
  assert.deepEqual(buttonsFor(person(), { paused: true, canUnpause: true }), { top: ['unpause'], more: ['temp-password', 'deactivate', 'remove'] });
  // Paused somewhere this viewer can't unpause: the temporary password comes back to the top.
  assert.deepEqual(buttonsFor(person(), { paused: true, canUnpause: false }), { top: ['temp-password'], more: ['deactivate', 'remove'] });
  // An older account with no sign-in on record, paused: Resend invite stays reachable under More options.
  assert.deepEqual(buttonsFor(person({ lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }), { paused: true, canUnpause: true }), {
    top: ['unpause'],
    more: ['temp-password', 'resend', 'deactivate', 'remove'],
  });
  assert.deepEqual(buttonsFor(person({ status: 'removed' })), { top: [], more: ['remove'] }, 'no longer in the org');
  // An open pause that isn't blocking (the account is switched off): an org admin lifts it under More options.
  assert.deepEqual(buttonsFor(person({ status: 'deactivated' }), { canUnpause: true }), { top: ['reactivate'], more: ['unpause', 'remove'] });
  assert.deepEqual(buttonsFor(person()), { top: ['temp-password'], more: ['deactivate', 'remove'] });
  assert.equal(STATE_WORDS.left, 'No longer in the org');
  assert.equal(STATE_WORDS.active, undefined, 'active says nothing');
});

test('a Doorline staff row with no membership here is still not a lead\'s to remove', () => {
  const staffGone = person({ isSuperAdmin: true, status: 'removed' });
  assert.equal(personAccess({ viewerRole: 'lead', viewerId: 'me', target: staffGone, onCampaign: true, campaignWritable: true }).remove, false);
  assert.equal(personAccess({ viewerRole: 'admin', viewerId: 'me', target: staffGone, onCampaign: true, campaignWritable: true }).remove, true);
});

test('never your own temporary password, invite, Deactivate or Unpause', () => {
  const me = person({ userId: 'me', role: 'admin' });
  assert.deepEqual(buttonsFor(me), { top: [], more: ['remove'] });
  assert.deepEqual(buttonsFor(me, { paused: true, canUnpause: true }).top, []);
  assert.deepEqual(buttonsFor({ ...me, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }), { top: [], more: ['remove'] });
});

test('a team lead manages canvassers; admins and other leads are read-only to them', () => {
  const lead = { viewerRole: 'lead', viewerId: 'me' };
  assert.deepEqual(buttonsFor(person(), lead), { top: ['temp-password'], more: ['deactivate', 'remove'] });
  assert.deepEqual(buttonsFor(person({ role: 'admin' }), lead), { top: [], more: [] });
  assert.deepEqual(buttonsFor(person({ role: 'lead', status: 'deactivated' }), lead), { top: [], more: [] });
  // Remove: canvassers, people no longer in the organization, and themselves (item 41).
  assert.deepEqual(buttonsFor(person({ status: 'removed', role: 'admin' }), lead).more, ['remove']);
  assert.deepEqual(buttonsFor(person({ userId: 'me', role: 'lead' }), lead).more, ['remove']);
  // Doorline staff: nothing to manage, and a lead can't remove or re-crew them.
  const staff = person({ isSuperAdmin: true });
  assert.deepEqual(buttonsFor(staff, lead), { top: [], more: [] });
  assert.equal(personAccess({ viewerRole: 'lead', viewerId: 'me', target: staff, onCampaign: true, campaignWritable: true }).crew, false);
  assert.equal(personAccess({ viewerRole: 'admin', viewerId: 'me', target: staff, onCampaign: true, campaignWritable: true }).crew, true);
});

test('an archived campaign takes Remove and crew changes off; Assign is for admins, accounts that are on', () => {
  const archived = personAccess({ viewerRole: 'admin', viewerId: 'me', target: person(), onCampaign: true, campaignWritable: false });
  assert.equal(archived.remove, false);
  assert.equal(archived.crew, true, 'the crew still shows');
  assert.equal(archived.crewWritable, false);
  const off = (over, viewerRole = 'admin') =>
    personAccess({ viewerRole, viewerId: 'me', target: person(over), onCampaign: false, campaignWritable: true }).assign;
  assert.equal(off({}), true);
  assert.equal(off({ status: 'deactivated' }), false);
  assert.equal(off({}, 'lead'), false);
});

test('the open-time check: busy, a change that didn’t finish, doors still on another team', () => {
  assert.equal(crewCheckLine({ busy: true, finishIt: false }, 'Sam'), 'Another change for Sam is still finishing — try again in a minute or two.');
  assert.equal(crewCheckLine({ finishIt: true, unfinished: true, to: { id: 'cd', name: 'Dana Cruz' }, doors: 3 }, 'Sam'), "A crew change to Dana Cruz didn't finish.");
  assert.equal(crewCheckLine({ finishIt: true, unfinished: false, to: { id: 'cd', name: 'Dana Cruz' }, doors: 12 }, 'Sam'), '12 of their doors here still count for another team.');
  assert.equal(crewCheckLine({ finishIt: true, unfinished: false, doors: 1 }, 'Sam'), '1 of their doors here still counts for another team.');
  assert.equal(crewCheckLine({ finishIt: true, unfinished: false, doors: 0, surveys: 2 }, 'Sam'), 'Some of their work here still counts for another team.');
  assert.equal(crewCheckLine({ finishIt: false, busy: false }, 'Sam'), null);
});

test('the check before a change names every team the doors come from', () => {
  const p = {
    from: { id: 'cd', name: 'Dana Cruz' },
    to: { id: 'cy', name: 'Yan Ortiz' },
    doors: 40,
    surveys: 6,
    sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 30 }, { coordinatorId: null, name: null, doors: 10 }],
    subjectRunsCrew: true,
  };
  assert.deepEqual(crewChangeLines(p, { name: 'Sam' }), [
    'Move 40 doors and 6 surveys from Dana Cruz and no coordinator to Yan Ortiz?',
    'This campaign only, all time.',
    "Sam runs a crew. Their own doors move; their crew's doors stay with them.",
  ]);
  // Finish it: the pick is the crew they already have; the doors come from the other teams.
  const finish = { from: { id: 'cd', name: 'Dana Cruz' }, to: { id: 'cd', name: 'Dana Cruz' }, doors: 12, surveys: 0, sources: [{ coordinatorId: 'cy', name: 'Yan Ortiz', doors: 12 }] };
  assert.deepEqual(crewChangeLines(finish, { name: 'Sam', finishing: true }), ['Move 12 doors from Yan Ortiz to Dana Cruz?', 'This campaign only, all time.']);
  assert.deepEqual(crewChangeLines({ ...finish, doors: 0, sources: [] }, { name: 'Sam', finishing: true }), ['Nothing is left to move; Finish it records the change.']);
  assert.deepEqual(crewChangeLines({ to: null, doors: 0, surveys: 0 }, { name: 'Sam' }), ['Sam has no past doors to move.']);
});

test('one person’s assign preview and the 409 lines', () => {
  assert.equal(
    assignOneLine({ doors: 120, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 120 }] }, null),
    "Their 120 earlier doors here move to No team, from Dana Cruz's team."
  );
  assert.equal(assignOneLine({ doors: 0, sources: [] }, 'Yan'), 'No earlier doors here to move.');
  assert.equal(crewConflictLine({ status: 409, data: { code: 'changed-meanwhile', now: 'cy' } }, 'Sam'), 'Their crew changed since you looked. Check it again before changing it.');
  assert.match(crewConflictLine({ status: 409, data: { code: 'busy', retryAfterSeconds: 30 } }, 'Sam'), /^Another change for Sam is still finishing/);
  assert.equal(crewConflictLine({ status: 400, data: {} }, 'Sam'), null);
});

test('recent doors: the shared action list never includes notes', () => {
  const list = RECENT_DOOR_ACTIONS.split(',');
  assert.ok(!list.includes('note_added'));
  assert.deepEqual(list, ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting', 'not_target', 'restricted']);
});

test('the profile’s recent doors: 5, then 10 per Show more, stopping on a short page or one with no new ids', () => {
  const page = (from, n) => ({ activities: Array.from({ length: n }, (_, i) => ({ id: `a${from + i}` })) });
  assert.equal(recentLimit(0), RECENT_FIRST);
  assert.equal(recentLimit(5), RECENT_MORE);
  assert.equal(nextRecentSkip([]), 0);
  assert.equal(nextRecentSkip([page(0, 5)]), 5, 'a full first page offers more');
  assert.equal(nextRecentSkip([page(0, 3)]), undefined, 'a short page is the end');
  assert.equal(nextRecentSkip([page(0, 5), page(5, 10)]), 15);
  assert.equal(nextRecentSkip([page(0, 5), page(5, 4)]), undefined);
  // A server that predates `skip` answers page one again: once a page adds nothing new, stop.
  assert.equal(nextRecentSkip([page(0, 5), page(0, 10), page(0, 10)]), undefined);
  assert.deepEqual(recentRows([page(0, 5), page(0, 10)]).map((a) => a.id), Array.from({ length: 10 }, (_, i) => `a${i}`));
});
