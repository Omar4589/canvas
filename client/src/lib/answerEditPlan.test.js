import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAVE,
  pickKey,
  canReview,
  planFromForm,
  suggestedTakeOut,
  suggestionLabel,
  reviewSentences,
  recordedByLine,
  leftAsTheyAre,
  picksLine,
  runState,
  attentionBadge,
  answerText,
} from './answerEditPlan.js';

const questions = [
  { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
  {
    key: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    type: 'multiple_choice',
    options: [
      { id: 'yard_sign_delivered', text: 'Yard Sign Delivered' },
      { id: 'candidate_follow_up', text: 'Candidate Follow-Up' },
      { id: 'volunteer_request', text: 'Volunteer Request' },
    ],
    picks: [
      { id: 'volunteer_request', label: 'Volunteer Request', count: 139 },
      { id: 'candidate_follow_up', label: 'Candidate Follow-Up', count: 97 },
      { id: 'yard_sign_delivered', label: 'Yard Sign Delivered', count: 12 },
      { id: null, label: 'Volunteer interest', legacy: true, count: 3 },
    ],
  },
  { key: 'comments', label: 'Anything else?', type: 'text' },
];

test('planFromForm: one entry per question not left as recorded, in the server’s shape', () => {
  const form = {
    support: { ...LEAVE, mode: 'set', setTo: 'no' },
    yard_sign: { ...LEAVE, mode: 'takeOut', take: ['candidate_follow_up', 'volunteer_request', 'text:Volunteer interest'], replaceWith: '' },
    comments: { ...LEAVE, mode: 'clear' },
  };
  assert.deepEqual(planFromForm(questions, form), [
    { questionKey: 'support', op: 'set', optionIds: ['no'] },
    { questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up', 'volunteer_request'], removeTexts: ['Volunteer interest'], replaceWith: [] },
    { questionKey: 'comments', op: 'clear' },
  ]);
  assert.deepEqual(planFromForm(questions, { support: LEAVE }), []);
});

test('canReview: off until something is set, and only when every set question is complete', () => {
  assert.equal(canReview(questions, {}), false);
  assert.equal(canReview(questions, { support: LEAVE }), false);
  assert.equal(canReview(questions, { support: { ...LEAVE, mode: 'set', setTo: '' } }), false, 'Change it to … with nothing picked');
  assert.equal(canReview(questions, { yard_sign: { ...LEAVE, mode: 'takeOut', take: [] } }), false);
  assert.equal(canReview(questions, { yard_sign: { ...LEAVE, mode: 'takeOut', take: ['volunteer_request'] } }), true);
  assert.equal(canReview(questions, { comments: { ...LEAVE, mode: 'clear' }, support: { ...LEAVE, mode: 'set' } }), false);
});

test('the answer filter becomes one button: Take out just the filtered picks the surveys hold', () => {
  const s = suggestedTakeOut(questions, [{ questionKey: 'yard_sign', values: ['candidate_follow_up', 'volunteer_request', 'not_held'] }]);
  assert.deepEqual(s, [{ questionKey: 'yard_sign', take: ['candidate_follow_up', 'volunteer_request'] }]);
  assert.equal(suggestionLabel(questions[1], s[0].take), 'Take out just Candidate Follow-Up and Volunteer Request');
  assert.deepEqual(suggestedTakeOut(questions, [{ questionKey: 'support', values: ['yes'] }]), [], 'pick one has no Take out');
  assert.equal(pickKey({ id: null, label: 'Volunteer interest' }), 'text:Volunteer interest');
});

test('reviewSentences: the owner’s numbers, word for word', () => {
  const price = {
    byQuestion: [{
      questionKey: 'yard_sign',
      label: 'Could you help us by taking a yard sign?',
      surveys: 214,
      leftBlank: 202,
      multi: 22,
      removed: [{ id: 'volunteer_request', label: 'Volunteer Request', surveys: 139 }, { id: 'candidate_follow_up', label: 'Candidate Follow-Up', surveys: 97 }],
      kept: [{ id: 'yard_sign_delivered', label: 'Yard Sign Delivered', surveys: 12 }],
      added: [],
      setTo: [],
    }],
    recordedBy: [{ name: 'Cara Canvasser', surveys: 214 }],
  };
  assert.equal(
    reviewSentences(price)[0].text,
    "Taking out Volunteer Request from 139 surveys and Candidate Follow-Up from 97. That's 214 surveys: 22 had both. 202 are left with no answer, as if skipped; 12 keep Yard Sign Delivered."
  );
  assert.equal(recordedByLine(price), 'Recorded by: Cara Canvasser (214).');
  assert.equal(
    reviewSentences({ byQuestion: [{ questionKey: 'support', label: 'Support?', surveys: 3, setTo: [{ label: 'No', surveys: 3 }], removed: [] }] })[0].text,
    'Changing Support? to No on 3 surveys.'
  );
});

test('with Replace them with, only surveys that kept an original pick "keep" it', () => {
  const price = {
    byQuestion: [{
      questionKey: 'yard_sign', label: 'Could you help us by taking a yard sign?', surveys: 4, leftBlank: 0, multi: 0, keptAny: 1,
      removed: [{ id: 'candidate_follow_up', label: 'Candidate Follow-Up', surveys: 4 }],
      kept: [{ id: 'yard_sign_delivered', label: 'Yard Sign Delivered', surveys: 1 }],
      added: [{ id: 'volunteer_request', label: 'Volunteer Request', surveys: 4 }],
      setTo: [],
    }],
  };
  assert.equal(
    reviewSentences(price)[0].text,
    'Taking out Candidate Follow-Up from 4 surveys. 1 keeps Yard Sign Delivered. Volunteer Request goes in on 4 surveys.'
  );
});

test('leftAsTheyAre lists only the reasons that apply', () => {
  const lines = leftAsTheyAre({ notMatched: 9, outsideDates: 0, heldByRuns: 1, price: { unchanged: { not_answered: 2, already_blank: 1, same_answer: 4 } } });
  assert.deepEqual(lines.map((l) => [l.count, l.text.split(' ')[0]]), [[3, 'no'], [4, 'already'], [9, 'people'], [1, 'entry']]);
});

test('picksLine reads the run row’s second line', () => {
  assert.equal(
    picksLine({ counts: { byOption: [{ label: 'Candidate Follow-Up', removed: 97, added: 0 }, { label: 'Volunteer Request', removed: 139, added: 0 }] } }),
    '139 Volunteer Request and 97 Candidate Follow-Up picks taken out'
  );
});

test('runState: Part 1’s table, row by row', () => {
  const base = { mode: 'bulk', counts: { surveysChanged: 214, surveysTargeted: 214 }, progress: { done: 120, total: 214 }, undo: {} };
  assert.deepEqual(runState({ ...base, status: 'completed' }).actions, ['details', 'undo']);
  assert.equal(runState({ ...base, status: 'running' }).label, 'Working · 120 of 214 surveys');
  assert.equal(runState({ ...base, status: 'pending', createdAt: new Date().toISOString() }).key, 'waiting');
  assert.deepEqual(runState({ ...base, status: 'pending', waitingForWorker: true }).actions, ['startAgain']);
  assert.equal(
    runState({ ...base, status: 'pending', createdAt: new Date(Date.now() - 3600_000).toISOString() }).key,
    'waiting',
    'an old run just picked up waits for the server to say the worker is late, never its createdAt'
  );
  assert.deepEqual(runState({ ...base, status: 'completed', counts: { surveysChanged: 0 } }).actions, ['details'], 'nothing changed: nothing to undo');
  assert.deepEqual(runState({ ...base, status: 'running', stalled: true }).actions, ['startAgain'], 'a run whose job is gone can be started again');
  assert.deepEqual(runState({ ...base, status: 'completed', undo: { status: 'running', stalled: true } }).actions, ['startAgainUndo']);
  assert.deepEqual(runState({ ...base, status: 'failed', counts: { surveysChanged: 0, surveysTargeted: 214 } }).actions, ['details', 'pickUp', 'undoLanded'], 'a stopped run may have landed uncounted surveys');
  assert.deepEqual(runState({ ...base, status: 'failed', counts: { surveysChanged: 120, surveysTargeted: 214 } }).actions, ['details', 'pickUp', 'undoLanded']);
  assert.equal(runState({ ...base, status: 'completed', undo: { status: 'done', summary: { putBack: 214 } } }).label, 'Undone · 214 put back');
  assert.deepEqual(runState({ ...base, status: 'completed', undo: { status: 'done', summary: { putBack: 212, changedSince: 2 } } }).actions, ['details', 'undoAgain']);
  assert.equal(runState({ ...base, status: 'completed', undo: { status: 'done', summary: { putBack: 211, waiting: 3 } } }).key, 'partlyUndone');
  assert.deepEqual(runState({ ...base, status: 'completed', undo: { status: 'failed' } }).actions, ['retryUndo'], 'never Pick up after an undo started');
  assert.deepEqual(runState({ ...base, status: 'completed', undo: { status: 'running' } }).actions, []);
  assert.deepEqual(runState({ mode: 'queue', status: 'open', cursor: 12, progress: { total: 30 }, counts: { surveysChanged: 9 }, undo: {} }).actions, ['resume', 'stopHere']);
});

test('runState: a stopped change with nothing on file offers Pick up alone, worded by whether it started', () => {
  const stopped = { mode: 'bulk', status: 'failed', counts: { surveysChanged: 0, surveysTargeted: 214 }, progress: { done: 0, total: 214 }, undo: {} };
  const neverTaken = runState({ ...stopped, startedAt: null, nothingOnFile: true });
  assert.equal(neverTaken.key, 'notStarted');
  assert.deepEqual(neverTaken.actions, ['pickUp']);
  const startedEmpty = runState({ ...stopped, startedAt: new Date().toISOString(), nothingOnFile: true });
  assert.equal(startedEmpty.key, 'stoppedEmpty');
  assert.deepEqual(startedEmpty.actions, ['pickUp']);
  assert.equal(attentionBadge(startedEmpty), 'Stopped');
  // The first build never set a start time: a run it took through surveys did start (round 4).
  assert.equal(runState({ ...stopped, startedAt: null, progress: { done: 50, total: 214 }, nothingOnFile: true }).key, 'stoppedEmpty');
  // The first build stopped runs with no start time and no counts that DID land copies: without the
  // server's word that nothing is on file, Undo what landed stays.
  assert.deepEqual(runState({ ...stopped, startedAt: null }).actions, ['details', 'pickUp', 'undoLanded']);
  assert.deepEqual(runState({ ...stopped, startedAt: null, nothingOnFile: false }).actions, ['details', 'pickUp', 'undoLanded']);
});

test('answerText prints — for an empty pick-several, never a blank', () => {
  assert.equal(answerText({ answer: [] }), '—');
  assert.equal(answerText({ answer: null }), '—');
  assert.equal(answerText({ answer: ['A', 'B'] }), 'A, B');
  assert.equal(answerText({ answer: 'Yes' }), 'Yes');
});
