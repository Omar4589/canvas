import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_SIZE,
  chunk,
  stopsRun,
  runInChunks,
  moveOutcomes,
  assignOutcomes,
  resendOutcome,
  previewSkips,
  tally,
  mergeRuns,
  movePreviewLines,
  assignPreviewLines,
  confirmFor,
  progressLine,
  summaryLines,
} from './allShown.js';

// The Users hub's "all shown" runs (docs/PROPOSAL_PEOPLE_PAGES.md §G): 10 a request, one request at a
// time, and which failures stop a run.

const people = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `Person ${i}`, from: null }));
const httpError = (status, extra = {}) => Object.assign(new Error(extra.message || `HTTP ${status}`), { status, ...extra });

test('chunks of 10, the last one short', () => {
  assert.equal(CHUNK_SIZE, 10);
  assert.deepEqual(chunk(people(23)).map((c) => c.length), [10, 10, 3]);
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk(people(10)).map((c) => c.length), [10]);
});

test('one request at a time, in order, with progress after each', async () => {
  const sent = [];
  let inFlight = 0;
  let most = 0;
  const progress = [];
  const run = await runInChunks(people(23), { onProgress: (p) => progress.push(p) }, async (batch) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    sent.push(batch.map((p) => p.userId));
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return batch.map((p) => ({ userId: p.userId, outcome: 'done' }));
  });
  assert.equal(most, 1, 'never two requests at once');
  assert.deepEqual(sent.map((b) => b.length), [10, 10, 3]);
  assert.equal(sent[0][0], 'u0');
  assert.equal(sent[2][2], 'u22');
  assert.deepEqual(progress, [
    { sent: 10, total: 23 },
    { sent: 20, total: 23 },
    { sent: 23, total: 23 },
  ]);
  assert.equal(run.outcomes.length, 23);
  assert.equal(run.stopped, null);
  assert.deepEqual(run.notStarted, []);
});

test('a 402 stops the run with its message; the refused request and the rest are not started', async () => {
  let calls = 0;
  const run = await runInChunks(people(35), {}, async (batch) => {
    calls += 1;
    if (calls === 2) throw httpError(402, { message: 'This account is paused — recording and edits are disabled, existing data is safe.' });
    return batch.map((p) => ({ userId: p.userId, outcome: 'done' }));
  });
  assert.equal(calls, 2, 'nothing is sent after the 402');
  assert.equal(run.outcomes.length, 10);
  assert.deepEqual(run.stopped, { by: 'refused', status: 402, message: 'This account is paused — recording and edits are disabled, existing data is safe.' });
  assert.equal(run.notStarted.length, 25);
  assert.equal(run.notStarted[0].userId, 'u10');
});

test('which failures stop a run and which are listed against their people', () => {
  assert.equal(stopsRun(httpError(402)), true);
  assert.equal(stopsRun(httpError(402), { perPerson: true }), true);
  assert.equal(stopsRun(httpError(401), { perPerson: true }), true);
  assert.equal(stopsRun(httpError(403, { code: 'FORBIDDEN_ROLE' }), { perPerson: true }), true);
  // A request carrying several people: any other refusal is a refusal of the whole action.
  assert.equal(stopsRun(httpError(409)), true, 'an archived campaign');
  assert.equal(stopsRun(httpError(400)), true, 'a crew pick that can no longer lead');
  // One person's 403, 409 or 429 is that person's answer.
  assert.equal(stopsRun(httpError(403), { perPerson: true }), false);
  assert.equal(stopsRun(httpError(409), { perPerson: true }), false);
  assert.equal(stopsRun(httpError(429), { perPerson: true }), false);
  // A server error or a dropped connection is listed; the run carries on.
  assert.equal(stopsRun(httpError(500)), false);
  assert.equal(stopsRun(Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' })), false);
});

test('a server error is listed against that request’s people and the run carries on', async () => {
  let calls = 0;
  const run = await runInChunks(people(25), {}, async (batch) => {
    calls += 1;
    if (calls === 2) throw httpError(500, { message: 'Internal error' });
    return batch.map((p) => ({ userId: p.userId, outcome: 'done' }));
  });
  assert.equal(calls, 3);
  const t = tally(run.outcomes);
  assert.equal(t.done.length, 15);
  assert.equal(t.failed.length, 10);
  assert.deepEqual(t.failed[0], { userId: 'u10', outcome: 'failed', reason: 'request', detail: 'Internal error' });
  assert.equal(run.stopped, null);
});

test('Stop takes effect between requests: the one on its way is counted, the rest are not started', async () => {
  const stop = new AbortController();
  let calls = 0;
  const run = await runInChunks(people(30), { signal: stop.signal }, async (batch) => {
    calls += 1;
    if (calls === 1) stop.abort(); // pressed while the first request was out
    return batch.map((p) => ({ userId: p.userId, outcome: 'done' }));
  });
  assert.equal(calls, 1);
  assert.equal(run.outcomes.length, 10);
  assert.deepEqual(run.stopped, { by: 'stop' });
  assert.equal(run.notStarted.length, 20);
});

test('one person per request for invites: a cooldown 429 is listed and the run goes on', async () => {
  const run = await runInChunks(people(3), { size: 1, perPerson: true }, async ([p]) => {
    if (p.userId === 'u1') throw httpError(429, { message: 'An invite was just sent to this person. Try again in a minute.' });
    return [resendOutcome(p, { sent: true, expiresInHours: 72 })];
  });
  const t = tally(run.outcomes);
  assert.equal(t.done.length, 2);
  assert.equal(t.failed.length, 1);
  assert.deepEqual(resendOutcome({ userId: 'x' }, { sent: false }), { userId: 'x', outcome: 'failed', reason: 'not-sent' });
  const lines = summaryLines('resend', run, (id) => ({ u1: 'Pat Lee' })[id]);
  assert.deepEqual(lines, ['Sent 2 invites.', "1 person didn't get one:", 'Pat Lee — An invite was just sent to this person. Try again in a minute']);
});

test('the crew move’s answers: changed-meanwhile, busy and unfinished can be retried; other skips are final', () => {
  const batch = people(6);
  const out = moveOutcomes(batch, [
    { userId: 'u0', changed: true, finished: true, doors: 12, error: null },
    { userId: 'u1', changed: false, skip: 'changed-meanwhile', error: null },
    { userId: 'u2', changed: false, skip: 'busy', retryAfterSeconds: 40, error: null },
    { userId: 'u3', changed: true, doors: 5, error: 'ledger: timed out' },
    { userId: 'u4', changed: false, skip: 'same-crew', error: null },
  ]);
  assert.deepEqual(out.map((o) => [o.userId, o.outcome, o.reason ?? null]), [
    ['u0', 'done', null],
    ['u1', 'failed', 'changed-meanwhile'],
    ['u2', 'failed', 'busy'],
    ['u3', 'failed', 'unfinished'],
    ['u4', 'skipped', 'same-crew'],
    ['u5', 'failed', 'no-answer'],
  ]);
  assert.equal(out[2].retryAfterSeconds, 40);
  // A write that threw changed nothing: not "their doors didn't finish moving".
  const [threw] = moveOutcomes([{ userId: 'u9' }], [{ userId: 'u9', changed: false, error: 'connection reset' }]);
  assert.deepEqual([threw.outcome, threw.reason, threw.detail], ['failed', 'request', 'connection reset']);
});

test('a preview\'s busy person stays a failure, so Retry failed can still reach them', () => {
  const skipped = previewSkips([
    { userId: 'u1', skip: 'busy', retryAfterSeconds: 30 },
    { userId: 'u2', skip: 'same-crew' },
  ]);
  assert.deepEqual(skipped, [
    { userId: 'u1', outcome: 'failed', reason: 'busy', retryAfterSeconds: 30 },
    { userId: 'u2', outcome: 'skipped', reason: 'same-crew' },
  ]);
  // Ann was busy at the write; Retry failed re-checks her and she is still busy: still retryable.
  const first = { outcomes: [{ userId: 'ann', outcome: 'failed', reason: 'busy' }], stopped: null, notStarted: [] };
  const merged = mergeRuns(first, { outcomes: previewSkips([{ userId: 'ann', skip: 'busy', retryAfterSeconds: 12 }]), stopped: null, notStarted: [] }, ['ann']);
  assert.deepEqual(tally(merged.outcomes).failed.map((o) => o.userId), ['ann']);
});

test('Assign all shown’s answers: someone added meanwhile is left out; an unfinished move still counts as added', () => {
  const out = assignOutcomes(people(4), {
    created: 3,
    total: 4,
    crew: {
      set: null,
      skipped: [
        { userId: 'u1', reason: 'already-on-campaign' },
        { userId: 'u2', reason: 'unfinished', error: 'plan: boom' },
        { userId: 'u3', reason: 'error', error: 'insert failed' },
      ],
    },
  });
  assert.deepEqual(out, [
    { userId: 'u0', outcome: 'done' },
    { userId: 'u1', outcome: 'skipped', reason: 'already-on-campaign' },
    { userId: 'u2', outcome: 'done', unfinished: true },
    { userId: 'u3', outcome: 'failed', reason: 'request', detail: 'insert failed' },
  ]);
  const lines = summaryLines('assign', { outcomes: out, stopped: null, notStarted: [] }, () => 'Sam');
  assert.equal(lines[0], 'Added 2 people.');
  assert.match(lines[1], /^1 person was added with earlier doors still to move/);
  assert.equal(lines[2], 'Left out: 1 already on this campaign.');
});

test('Retry and Continue fold into the run before them', () => {
  const first = {
    outcomes: [
      { userId: 'u0', outcome: 'done' },
      { userId: 'u1', outcome: 'failed', reason: 'changed-meanwhile' },
    ],
    stopped: { by: 'stop' },
    notStarted: [{ userId: 'u2' }, { userId: 'u3' }],
  };
  const retry = { outcomes: [{ userId: 'u1', outcome: 'skipped', reason: 'same-crew' }], stopped: null, notStarted: [] };
  const merged = mergeRuns(first, retry, ['u1']);
  assert.deepEqual(merged.outcomes.map((o) => [o.userId, o.outcome]), [['u0', 'done'], ['u1', 'skipped']]);
  assert.deepEqual(merged.notStarted.map((p) => p.userId), ['u2', 'u3'], 'a retry leaves the not-started alone');
  const cont = { outcomes: [{ userId: 'u2', outcome: 'done' }], stopped: { by: 'stop' }, notStarted: [{ userId: 'u3' }] };
  const after = mergeRuns(merged, cont, ['u2', 'u3']);
  assert.deepEqual(after.notStarted.map((p) => p.userId), ['u3']);
  assert.equal(tally(after.outcomes).done.length, 2);
  assert.equal(mergeRuns(null, cont), cont);
});

const preview = {
  to: 'cy',
  people: [
    { userId: 'u0', name: 'Sam Rivera', onCampaign: true, from: 'cd', sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 300 }], doors: 300, activities: 320, surveys: 60, subjectRunsCrew: false, unfinished: false, busy: false },
    { userId: 'u1', name: 'Dana Cruz', onCampaign: true, from: null, sources: [{ coordinatorId: null, name: null, doors: 112 }], doors: 112, activities: 120, surveys: 36, subjectRunsCrew: true, unfinished: true, busy: false },
    { userId: 'u2', name: 'Alex Kim', onCampaign: true, from: 'cy', skip: 'same-crew', sources: [], doors: 0, activities: 0, surveys: 0 },
    { userId: 'u3', skip: 'not-on-campaign' },
  ],
  totals: { people: 2, doors: 410, activities: 440, surveys: 96 },
};

test('the move preview: who moves, the exact door total, where the doors come from, who runs a crew', () => {
  assert.deepEqual(movePreviewLines(preview, { crewName: 'Yan Ortiz' }), [
    "2 people move to Yan Ortiz's crew.",
    "Their 410 doors and 96 surveys on this campaign move to Yan Ortiz's team, from Dana Cruz's team and No team.",
    'Team totals on this campaign change, all time, and so do client reports that count these crews.',
    "Dana Cruz runs a crew here. Their own doors move; their crew's doors stay with them.",
    "A crew change for Dana Cruz didn't finish; this finishes it.",
    'Left out: 1 already on that crew · 1 not on this campaign.',
  ]);
  assert.equal(movePreviewLines({ people: [], totals: { people: 0, doors: 0, activities: 0, surveys: 0 } })[0], 'Nobody shown would change.');
  const noDoors = { people: [{ userId: 'u0', name: 'A', sources: [], doors: 0, activities: 0, surveys: 0 }], totals: { people: 1, doors: 0, activities: 0, surveys: 0 } };
  assert.deepEqual(movePreviewLines(noDoors, { crewName: null }), ['1 person moves to No crew.', 'None of them have doors here to move.']);
  assert.deepEqual(previewSkips(preview.people), [
    { userId: 'u2', outcome: 'skipped', reason: 'same-crew' },
    { userId: 'u3', outcome: 'skipped', reason: 'not-on-campaign' },
  ]);
});

test('the assign preview says who joins and which earlier doors follow them', () => {
  const data = {
    people: [
      { userId: 'u0', name: 'Pat Lee', onCampaign: false, from: null, sources: [{ coordinatorId: 'cd', name: 'Dana Cruz', doors: 120 }], doors: 120, activities: 130, surveys: 0 },
      { userId: 'u1', name: 'Jo Park', onCampaign: false, from: null, sources: [], doors: 0, activities: 0, surveys: 0 },
      { userId: 'u2', name: 'Yan Ortiz', skip: 'is-coordinator', onCampaign: false },
    ],
    totals: { people: 2, doors: 120, activities: 130, surveys: 0 },
  };
  assert.deepEqual(assignPreviewLines(data, { crewName: 'Yan Ortiz', campaignName: 'Fall Canvass' }), [
    "2 people join Fall Canvass on Yan Ortiz's crew.",
    "1 of them worked here before: their 120 earlier doors on this campaign move to Yan Ortiz's team, from Dana Cruz's team.",
    'Team totals on this campaign change, all time, and so do client reports that count these crews.',
    'Left out: 1 the coordinator you picked.',
  ]);
  const fresh = { people: [{ userId: 'u1', name: 'Jo', sources: [], doors: 0, surveys: 0 }], totals: { people: 1, doors: 0, activities: 0, surveys: 0 } };
  assert.deepEqual(assignPreviewLines(fresh, { campaignName: 'Fall Canvass' }), [
    '1 person joins Fall Canvass with no crew.',
    'None of them have earlier doors here to move.',
  ]);
});

test('each run asks first, in words that carry the count', () => {
  assert.deepEqual(confirmFor('move', { n: 12, crewName: 'Yan', doors: 410 }), {
    title: "Move 12 people to Yan's crew?",
    message: "410 doors here move to Yan's team.",
    action: 'Move',
  });
  assert.equal(confirmFor('move', { n: 1, crewName: null, doors: 0 }).message, 'No doors move.');
  assert.deepEqual(confirmFor('assign', { n: 2, crewName: null, doors: 120, campaignName: 'Fall Canvass' }), {
    title: 'Add 2 people to Fall Canvass?',
    message: 'They join Fall Canvass with no crew. 120 earlier doors here move to No team.',
    action: 'Add',
  });
  assert.equal(confirmFor('resend', { n: 3 }).title, 'Resend 3 invites?');
  assert.equal(progressLine('move', { sent: 20, total: 48 }), 'Moving 20 of 48…');
});

test('the summary names who couldn’t be changed, why the run stopped, and who it never reached', () => {
  const run = {
    outcomes: [
      { userId: 'u0', outcome: 'done' },
      { userId: 'u1', outcome: 'failed', reason: 'changed-meanwhile' },
      { userId: 'u2', outcome: 'skipped', reason: 'same-crew' },
    ],
    stopped: { by: 'refused', status: 402, message: 'The free trial has ended — the account is read-only until it’s activated.' },
    notStarted: people(5),
  };
  assert.deepEqual(summaryLines('move', run, (id) => ({ u1: 'Sam Rivera' })[id]), [
    'Moved 1 person.',
    'Left out: 1 already on that crew.',
    "1 person couldn't be moved:",
    'Sam Rivera — their crew changed since you looked',
    'The free trial has ended — the account is read-only until it’s activated.',
    '5 people not started.',
  ]);
  const many = { outcomes: people(11).map((p) => ({ userId: p.userId, outcome: 'failed', reason: 'busy' })), stopped: null, notStarted: [] };
  const lines = summaryLines('move', many, () => 'X');
  assert.equal(lines.filter((l) => l.startsWith('X — ')).length, 8);
  assert.equal(lines[lines.length - 1], 'and 3 more');
});
