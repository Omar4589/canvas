import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crewChangeBody,
  finishItBody,
  bulkWriteBody,
  openTimeLine,
  affectedCoordinatorIds,
  bulkAffectedIds,
  bulkSourceTeams,
  bulkOutcome,
  coordinatorChoices,
  crewClassify,
  joinClassify,
  skipReason,
} from './crewChange.js';

test('both request bodies carry fromCoordinatorId — the crew the check showed, null for No crew', () => {
  assert.deepEqual(crewChangeBody({ pick: 'd1', previewFrom: 'y1' }), { coordinatorId: 'd1', fromCoordinatorId: 'y1' });
  assert.deepEqual(crewChangeBody({ pick: '', previewFrom: null }), { coordinatorId: null, fromCoordinatorId: null });
  const body = crewChangeBody({ pick: null, previewFrom: 'y1' });
  assert.ok(Object.hasOwn(body, 'fromCoordinatorId'), 'never left out: an absent key is what a released client sends');
  assert.deepEqual(finishItBody('d1'), { coordinatorId: 'd1', fromCoordinatorId: 'd1' }, 'Finish it: the current crew twice');
  assert.deepEqual(finishItBody(null), { coordinatorId: null, fromCoordinatorId: null });
  assert.deepEqual(
    bulkWriteBody([{ userId: 'u1', from: 'y1', name: 'Ann' }, { userId: 'u2', from: null }], 'd1'),
    { people: [{ userId: 'u1', from: 'y1' }, { userId: 'u2', from: null }], coordinatorId: 'd1' },
    'each person with the from their preview showed'
  );
});

test('the line the panel opens with', () => {
  assert.equal(openTimeLine(null, 'Sam'), null);
  assert.equal(openTimeLine({ finishIt: false, doors: 0 }, 'Sam'), null, 'nothing to finish');
  assert.deepEqual(openTimeLine({ busy: true, retryAfterSeconds: 90 }, 'Sam'), {
    tone: 'warning',
    finishIt: false,
    text: 'Another change for Sam is still finishing — try again in a minute or two.',
  });
  assert.equal(openTimeLine({ finishIt: true, unfinished: true, to: { id: 'd1', name: 'Dana Cruz' } }, 'Sam').text, 'A crew change to Dana Cruz didn’t finish.');
  assert.equal(openTimeLine({ finishIt: true, unfinished: false, doors: 12 }, 'Sam').text, '12 of their doors here still count for another team.');
  assert.equal(openTimeLine({ finishIt: true, unfinished: false, doors: 1 }, 'Sam').text, '1 of their doors here still counts for another team.');
  assert.equal(openTimeLine({ finishIt: true, doors: 0, surveys: 3 }, 'Sam').text, '3 of their surveys here still count for another team.');
});

test('the client-report teams asked about, for one change: the sources when the server sends them', () => {
  assert.deepEqual(affectedCoordinatorIds({ from: { id: 'c-dee' }, to: { id: 'c-sam' } }, 'u-ann'), ['c-dee', 'c-sam'], 'an older server: from and to');
  assert.deepEqual(affectedCoordinatorIds({ from: null, to: { id: 'c-sam' } }, 'u-ann'), ['c-sam', 'u-ann'], 'No team on one side: the person too');
  // Several teams, and Finish it (from = to): every team the doors come from.
  const finish = { from: { id: 'd1' }, to: { id: 'd1' }, sources: [{ coordinatorId: 'y1', doors: 8 }, { coordinatorId: null, doors: 4 }] };
  assert.deepEqual(affectedCoordinatorIds(finish, 'u7'), ['d1', 'u7', 'y1']);
});

test('the client-report teams asked about, for a Move to crew…', () => {
  const preview = {
    to: 'd1',
    people: [
      { userId: 'u1', doors: 5, sources: [{ coordinatorId: 'y1', doors: 5 }] },
      { userId: 'u2', doors: 2, sources: [{ coordinatorId: null, doors: 2 }], subjectRunsCrew: true },
      { userId: 'u3', doors: 2, sources: [{ coordinatorId: null, doors: 2 }] },
      { userId: 'u4', skip: 'same-crew', doors: 9, sources: [{ coordinatorId: 'z1', doors: 9 }] },
    ],
  };
  assert.deepEqual(bulkAffectedIds(preview), ['d1', 'u2', 'y1'], 'u3 can’t lead a crew; u4 is left alone');
  assert.deepEqual(bulkAffectedIds(preview, new Set(['u3'])), ['d1', 'u2', 'u3', 'y1']);
  assert.deepEqual(bulkSourceTeams({ people: [{ sources: [{ coordinatorId: 'y1', name: 'Yan Ito', doors: 3 }, { coordinatorId: null, doors: 1 }] }] }), ['Yan Ito’s team', 'No team']);
});

test('a write’s answer per person: done, skipped, or failed for Retry', () => {
  assert.deepEqual(bulkOutcome({ changed: true }), { outcome: 'done' });
  assert.equal(bulkOutcome({ skip: 'same-crew' }).outcome, 'skipped');
  assert.equal(bulkOutcome({ skip: 'busy' }).outcome, 'failed');
  assert.equal(bulkOutcome({ skip: 'changed-meanwhile' }).outcome, 'failed');
  assert.equal(bulkOutcome({ error: 'maxTimeMS' }).outcome, 'failed');
  assert.equal(bulkOutcome({ changed: true, error: 'maxTimeMS' }).reason, 'their earlier doors didn’t finish moving');
  assert.equal(bulkOutcome({ changed: false, error: 'boom' }).reason, 'the change didn’t go through', 'a write that threw');
  assert.deepEqual(bulkOutcome({ changed: false, skip: 'not-on-campaign' }), { outcome: 'skipped', reason: 'not on this campaign' }, 'removed since the check: never re-added by a move');
});

test('what a preview row means for the write after it', () => {
  assert.equal(skipReason('deleted'), 'account deleted');
  assert.equal(skipReason('switched-off'), 'switched off');
  assert.equal(crewClassify({ userId: 'a' }), null, 'sent');
  assert.deepEqual(crewClassify({ skip: 'busy' }), { fail: 'another change for them is still finishing' }, 'for Retry failed');
  assert.deepEqual(crewClassify({ skip: 'same-crew' }), { skip: 'already on that crew' });
  // Add from your organization: never sends someone whose presence would refuse the whole request.
  assert.equal(joinClassify({ userId: 'a', onCampaign: false }), null);
  assert.deepEqual(joinClassify({ onCampaign: false, skip: 'switched-off' }), { skip: 'switched off' });
  assert.deepEqual(joinClassify({ onCampaign: false, skip: 'deleted' }), { skip: 'account deleted' });
  assert.deepEqual(joinClassify({ onCampaign: false, skip: 'not-in-org' }), { skip: 'not in your organization' });
  assert.deepEqual(joinClassify({ onCampaign: true }), { skip: 'already on this campaign' }, 'added meanwhile: never re-crewed by an add');
});

test('the crew choices: the crew endpoint’s coordinators, by name', () => {
  assert.deepEqual(
    coordinatorChoices({ coordinators: [{ id: 'y1', firstName: 'Yan', lastName: 'Ito', role: 'admin' }, { id: 'd1', firstName: 'Dana', lastName: 'Cruz', role: 'lead' }] }),
    [{ id: 'd1', name: 'Dana Cruz', role: 'lead' }, { id: 'y1', name: 'Yan Ito', role: 'admin' }]
  );
  assert.deepEqual(coordinatorChoices(undefined), []);
});
