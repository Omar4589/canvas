import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialAdd,
  addReducer,
  backAction,
  errorOf,
  confirmKind,
  prePick,
  historyLine,
  joinLine,
  doneView,
} from './addByEmail.js';

// The phone's Add a canvasser, resolve first (docs/PROPOSAL_PEOPLE_PAGES.md §G).

const history = {
  doors: 120,
  sources: [
    { coordinatorId: null, name: null, doors: 20, canLead: false },
    { coordinatorId: 'cd', name: 'Dana Cruz', doors: 100, canLead: true },
  ],
};

test('the steps: email, then what it turned out to be, back keeps the email, then done and Add another', () => {
  let s = initialAdd();
  assert.deepEqual(s, { step: 'email', email: '', found: null, result: null, error: null });
  s = addReducer(s, { type: 'typed', email: 'pat@x.co' });
  s = addReducer(s, { type: 'failed', error: Object.assign(new Error('Invalid input'), { status: 400 }) });
  assert.equal(s.error.message, 'Invalid input');
  s = addReducer(s, { type: 'typed', email: 'pat@x.com' });
  assert.equal(s.error, null, 'typing again clears the refusal');

  const found = { outcome: 'in-org', person: { userId: 'u1', firstName: 'Pat', lastName: 'Lee', role: 'canvasser' }, history };
  s = addReducer(s, { type: 'resolved', found });
  assert.equal(s.step, 'confirm');
  assert.equal(addReducer(s, { type: 'typed', email: 'other@x.co' }).email, 'pat@x.com', 'the email is fixed once looked up');

  const back = addReducer(s, { type: 'back' });
  assert.deepEqual(back, { step: 'email', email: 'pat@x.com', found: null, result: null, error: null }, 'Android back keeps the email');
  assert.equal(addReducer(back, { type: 'back' }), back, 'back on the first step changes nothing (the sheet closes instead)');

  s = addReducer(s, { type: 'failed', error: Object.assign(new Error('Their account was deleted.'), { status: 409 }) });
  assert.equal(s.step, 'confirm', 'a refused add stays on its step, with the reason');
  s = addReducer(s, { type: 'added', result: { outcome: 'in-org', user: { firstName: 'Pat', lastName: 'Lee' } } });
  assert.equal(s.step, 'done');
  assert.equal(s.error, null);
  assert.deepEqual(addReducer(s, { type: 'again' }), initialAdd(), 'Add another starts over, empty');
});

test('Android back: step 2 goes back to step 1, elsewhere it closes, and never while a request is out', () => {
  assert.equal(backAction({ step: 'confirm' }), 'back');
  assert.equal(backAction({ step: 'email' }), 'close');
  assert.equal(backAction({ step: 'done' }), 'close');
  assert.equal(backAction({ step: 'confirm' }, { busy: true }), 'stay');
});

test('a 429 says how long to wait, in minutes, inside the step', () => {
  const tooMany = (s) => Object.assign(new Error('Too many lookups. Try again in a little while.'), { status: 429, data: { code: 'rate-limited', retryAfterSeconds: s } });
  assert.deepEqual(errorOf(tooMany(661)), { message: 'Too many email checks this hour. Try again in 12 minutes.', waitMinutes: 12 });
  assert.deepEqual(errorOf(tooMany(20)), { message: 'Too many email checks this hour. Try again in 1 minute.', waitMinutes: 1 });
  assert.equal(errorOf(tooMany(null)).message, 'Too many email checks this hour. Try again in a little while.');
  assert.equal(errorOf(Object.assign(new Error('This account is paused'), { status: 402 })).message, 'This account is paused');
});

test('what each answer offers, for an org admin and for a team lead', () => {
  const kind = (found, isAdmin) => confirmKind(found, { isAdmin });
  assert.deepEqual(kind({ outcome: 'outside', person: null }, false), { kind: 'new', crew: true, submit: 'Create & add' });
  assert.deepEqual(kind({ outcome: 'in-org' }, false), { kind: 'colleague', crew: true, submit: 'Add to campaign' });
  assert.deepEqual(kind({ outcome: 'on-campaign' }, true), { kind: 'here', crew: false, submit: null });
  // Switched off and already on this campaign: Switch on only, no crew, and only for an org admin.
  assert.deepEqual(kind({ outcome: 'in-org-inactive', onCampaign: true }, true), { kind: 'switch-on', crew: false, submit: 'Switch on' });
  assert.deepEqual(kind({ outcome: 'in-org-inactive', onCampaign: true }, false), { kind: 'switch-on', crew: false, submit: null });
  assert.deepEqual(kind({ outcome: 'in-org-inactive', onCampaign: false }, true), { kind: 'switched-off', crew: true, submit: 'Switch on & add' });
  assert.deepEqual(kind({ outcome: 'in-org-inactive', onCampaign: false }, false), { kind: 'switched-off', crew: false, submit: null });
});

test('the pre-pick is the first team whose coordinator can still lead, otherwise No crew', () => {
  assert.equal(prePick(history), 'cd');
  assert.equal(prePick({ doors: 5, sources: [{ coordinatorId: 'cx', name: 'Gone', doors: 5, canLead: false }] }), null);
  assert.equal(prePick({ doors: 0, sources: [] }), null);
  assert.equal(prePick(undefined), null);
});

test('the history line and what the crew picked does to those doors', () => {
  const pat = { firstName: 'Pat' };
  assert.equal(historyLine(pat, history), "Pat has 120 doors here from before: 20 on No team, 100 on Dana Cruz's team.");
  assert.equal(historyLine(pat, { doors: 7, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 7 }] }), "Pat has 7 doors here from before, on Dana Cruz's team.");
  assert.equal(historyLine(pat, { doors: 0, sources: [] }), null);
  assert.equal(joinLine(history, 'cd', 'Dana Cruz'), "All 120 doors here will count for Dana Cruz's team; the ones on No team move there.");
  assert.equal(joinLine(history, null, null), "All 120 doors here will count for No team; the ones on Dana Cruz's team move there.");
  assert.equal(joinLine(history, 'cy', 'Yan Ortiz'), "All 120 doors here will count for Yan Ortiz's team.");
  // The teams' counts can overlap (90 + 30 for 100 doors): no arithmetic on them, only the exact total.
  const overlap = { doors: 100, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 90 }, { coordinatorId: 'cy', name: 'Yan Ortiz', doors: 30 }] };
  assert.equal(joinLine(overlap, 'cd', 'Dana Cruz'), "All 100 doors here will count for Dana Cruz's team; the ones on Yan Ortiz's team move there.");
  assert.equal(joinLine({ doors: 3, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 3 }] }, 'cd', 'Dana Cruz'), "All 3 doors here already count for Dana Cruz's team.");
  assert.equal(joinLine({ doors: 1, sources: [{ coordinatorId: null, doors: 1 }] }, 'cd', 'Dana Cruz'), "Their 1 door here will count for Dana Cruz's team.");
  assert.equal(joinLine({ doors: 0, sources: [] }, 'cd', 'Dana Cruz'), null);
});

test('after the add: what moved and from which teams, an attached account, a race, a switch-on', () => {
  const base = { user: { firstName: 'Pat', lastName: 'Lee' }, attached: false };
  const moved = doneView(
    { ...base, outcome: 'in-org', restamp: { changed: true, doors: 120, surveys: 3, activities: 140, error: null, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 120 }] } },
    { crewName: null }
  );
  assert.deepEqual(moved, {
    title: 'Added',
    lines: ['Pat Lee is on this campaign.', "Pat's 120 earlier doors moved from Dana Cruz's team to No team."],
    open: true,
    first: 'Pat',
  });

  const attached = doneView({ ...base, outcome: 'attached', attached: true, restamp: { changed: true, doors: 0, surveys: 0, error: null, sources: [] } });
  assert.match(attached.lines[1], /^That email already had a Doorline account, so we added Pat Lee rather than a new person\. .*what you typed wasn't used/);
  assert.equal(attached.open, false);

  const created = doneView({ ...base, outcome: 'created', restamp: { changed: true, doors: 0, sources: [] } });
  assert.deepEqual(created.lines, ['Pat Lee is on this campaign.', "They've been emailed a link to set their own password."]);

  const race = doneView({ ...base, outcome: 'on-campaign', restamp: { changed: false, doors: 0, sources: [] } });
  assert.deepEqual(race, { title: 'Already here', lines: ['Pat Lee is already on this campaign. Nothing changed.'], open: true, first: 'Pat' });

  const switchedOn = doneView({ ...base, outcome: 'in-org-inactive', restamp: { changed: false, doors: 0, sources: [] } });
  assert.deepEqual(switchedOn.lines, ["Pat Lee's account is switched back on. Their crew here is as it was."]);
  assert.equal(switchedOn.title, 'Switched on');

  const torn = doneView({ ...base, outcome: 'in-org', restamp: { changed: true, doors: 40, error: 'ledger: timed out', sources: [] } }, { crewName: 'Dana Cruz' });
  assert.equal(torn.lines[1], "Their earlier doors here didn't finish moving. Open Pat and choose Finish it.");
  assert.equal(torn.open, true);
});
