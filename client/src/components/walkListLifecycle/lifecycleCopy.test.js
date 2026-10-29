import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveWalkListCopy,
  unarchiveCopy,
  bringBackPassCopy,
  archivePassCopy,
  refusalSentence,
  noticeText,
  isTemporaryError,
  errorCode,
} from './lifecycleCopy.js';

// The boxes are Part 1's mockups (docs/PROPOSAL_WALK_LIST_ARCHIVE.md); these read them back.

const LIVE = { _id: 'p3', roundNumber: 3, name: 'GOTV', books: 14, canvassers: 6, knocks: 1204 };

test('Archive "North": the Part 1 box, word for word', () => {
  const c = archiveWalkListCopy({
    name: 'North',
    preview: { livePass: LIVE, drafts: 1, doors: 3412 },
    draftPasses: [{ _id: 'p4', roundNumber: 4, name: 'Pass 4' }],
  });
  assert.equal(c.title, 'Archive "North"?');
  assert.equal(c.lead, 'Pass 3 · GOTV is live. Archiving North ends it:');
  assert.deepEqual(c.bullets, [
    "its 14 books leave 6 canvassers' phones the next time their map refreshes",
    'its 1,204 knocks stay counted',
  ]);
  assert.equal(c.drafts, "Pass 4 stays a draft, and can't be cut or started while North is archived.");
  assert.equal(c.readOnly, 'North becomes read-only. Its 3,412 doors stay with it; claim them into another walk list if you need them.');
  assert.equal(c.undo, 'You can unarchive North at any time and bring Pass 3 back.');
  assert.equal(c.confirmWord, 'archive');
  assert.equal(c.button, 'Archive North');
});

test('Archive: nothing live gets the same box with no typing; drafts are counted until named', () => {
  const c = archiveWalkListCopy({ name: 'Main', preview: { livePass: null, drafts: 2, doors: 1 } });
  assert.equal(c.lead, null);
  assert.deepEqual(c.bullets, []);
  assert.equal(c.confirmWord, null, 'typing archive is asked only when a pass is live');
  assert.equal(c.drafts, "Its 2 draft passes stay drafts, and can't be cut or started while Main is archived.");
  assert.equal(c.readOnly, 'Main becomes read-only. Its 1 door stays with it; claim it into another walk list if you need it.');
  assert.equal(c.undo, 'You can unarchive Main at any time.');
  assert.equal(c.button, 'Archive Main');

  // Names when the pass list agrees with the preview's count; counts when it doesn't (a stale cache).
  const named = archiveWalkListCopy({
    name: 'Main',
    preview: { livePass: null, drafts: 2, doors: 0 },
    draftPasses: [{ roundNumber: 5 }, { roundNumber: 4 }],
  });
  assert.equal(named.drafts, "Pass 4 and Pass 5 stay drafts, and can't be cut or started while Main is archived.");
  assert.equal(named.readOnly, 'Main becomes read-only.');
  const stale = archiveWalkListCopy({ name: 'Main', preview: { livePass: null, drafts: 1, doors: 0 }, draftPasses: [] });
  assert.equal(stale.drafts, "Its draft pass stays a draft, and can't be cut or started while Main is archived.");
});

test('Archive: a live pass with one book, one canvasser, no knocks, or nobody assigned', () => {
  const one = archiveWalkListCopy({ name: 'N', preview: { livePass: { ...LIVE, books: 1, canvassers: 1, knocks: 0 }, drafts: 0, doors: 5 } });
  assert.deepEqual(one.bullets, ["its 1 book leaves 1 canvasser's phone the next time their map refreshes"]);
  assert.equal(one.drafts, null);
  const nobody = archiveWalkListCopy({ name: 'N', preview: { livePass: { ...LIVE, canvassers: 0, knocks: 1 }, drafts: 0, doors: 5 } });
  assert.deepEqual(nobody.bullets, ['its 14 books close; no canvasser has them', 'its 1 knock stays counted']);
});

test('End Pass 3: the amber row from before this change', () => {
  const c = archiveWalkListCopy({ name: 'North', preview: { livePass: LIVE, drafts: 1, doors: 3412 }, alreadyArchived: true });
  assert.equal(c.title, 'End Pass 3?');
  assert.equal(c.lead, 'North is archived, but Pass 3 · GOTV is still live. Ending it:');
  assert.equal(c.drafts, null, 'already frozen');
  assert.equal(c.readOnly, null, 'already read-only');
  assert.equal(c.undo, 'You can unarchive North at any time and bring Pass 3 back.');
  assert.equal(c.confirmWord, 'archive');
  assert.equal(c.button, 'End Pass 3');
  // Someone else ended it meanwhile: nothing to do.
  const done = archiveWalkListCopy({ name: 'North', preview: { livePass: null, drafts: 0, doors: 3 }, alreadyArchived: true });
  assert.equal(done.button, null);
  assert.equal(done.nothingToDo, 'North is already archived, and none of its passes is live.');
});

const ENDED = {
  _id: 'p3',
  roundNumber: 3,
  name: 'GOTV',
  archivedAt: '2026-10-27T15:00:00.000Z',
  archivedVia: 'walk-list',
  archivedByName: 'Ada',
  bringBack: { ok: true, to: 'active', books: 14, canvassers: 6, downgraded: null },
};
const oct27 = () => 'Oct 27';

test('Unarchive "North": the Part 1 box, with the choice', () => {
  const c = unarchiveCopy({ name: 'North', endedPass: ENDED, formatDate: oct27 });
  assert.equal(c.title, 'Unarchive "North"?');
  assert.equal(c.intro, 'North can take doors and passes again.');
  assert.equal(c.ended, 'Pass 3 · GOTV ended when North was archived (Oct 27, by Ada).');
  assert.equal(c.bringBack, "Bring it back and its 14 books return to the same 6 canvassers' phones the next time their map refreshes.");
  assert.equal(c.choice, true);
  assert.equal(c.temporary, false);
  assert.equal(c.bringBackButton, 'Unarchive and bring Pass 3 back');
});

test('Unarchive: no ended pass, a downgrade, the one-time check', () => {
  const plain = unarchiveCopy({ name: 'Main', endedPass: null });
  assert.equal(plain.ended, null);
  assert.equal(plain.choice, false);
  assert.equal(plain.refusal, null);

  const empty = unarchiveCopy({
    name: 'North',
    endedPass: { ...ENDED, bringBack: { ok: true, to: 'draft', books: 0, canvassers: 6, downgraded: 'no-doors' } },
    formatDate: oct27,
  });
  assert.equal(empty.bringBack, 'None of its books has doors left, so bringing it back makes it a draft: there would be nothing to walk.');

  const repaired = unarchiveCopy({
    name: 'West',
    endedPass: { ...ENDED, roundNumber: 1, name: 'Pass 1', archivedVia: 'repair', archivedByName: null },
    formatDate: oct27,
  });
  assert.equal(repaired.ended, 'Pass 1 was ended by the one-time check (Oct 27).');

  const unknown = unarchiveCopy({ name: 'West', endedPass: { ...ENDED, archivedAt: null, archivedByName: null } });
  assert.equal(unknown.ended, 'Pass 3 · GOTV ended when West was archived.');
});

test('Unarchive: it can\'t come back → the reason and a single Unarchive; someone busy → no action', () => {
  const survey = unarchiveCopy({
    name: 'North',
    endedPass: { ...ENDED, bringBack: { ok: false, reason: 'survey-required', books: 14, canvassers: 6 } },
    formatDate: oct27,
  });
  assert.equal(survey.choice, false);
  assert.equal(survey.temporary, false);
  assert.equal(
    survey.refusal,
    'Add a survey to this campaign before a pass can go live again. You can still unarchive North; Pass 3 · GOTV stays ended.'
  );

  const busy = unarchiveCopy({
    name: 'North',
    endedPass: { ...ENDED, bringBack: { ok: false, reason: 'recut-locked', temporary: true, books: 14, canvassers: 6 } },
    formatDate: oct27,
  });
  assert.equal(busy.temporary, true);
  assert.equal(busy.choice, false);
  assert.equal(busy.refusal, 'Someone else is changing North right now. Try again in a minute.');
});

test('the refusal sentences match the server, laterPass named', () => {
  assert.equal(
    refusalSentence({ reason: 'later-pass-went-live', laterPass: { roundNumber: 4, name: 'Pass 4' } }),
    "Pass 4 went live after this one ended, so it can't come back."
  );
  assert.equal(
    refusalSentence({ reason: 'ended-by-next-pass', laterPass: { roundNumber: 4, name: 'GOTV' } }),
    "This pass ended when Pass 4 · GOTV went live, so it can't come back."
  );
  assert.equal(refusalSentence({ reason: 'ended-by-next-pass', laterPass: null }), "This pass ended when the next pass went live, so it can't come back.");
  assert.equal(refusalSentence({ reason: 'another-pass-live', laterPass: { roundNumber: 2 } }), 'Pass 2 is live on this walk list. Archive it first.');
  assert.equal(refusalSentence({ reason: 'something-new' }), "This pass can't be brought back.");
  assert.equal(refusalSentence(null), "This pass can't be brought back.");
});

test('Bring back Pass 3: live again, as a draft, downgraded, or refused', () => {
  const row = { _id: 'p3', roundNumber: 3, name: 'Pass 3', status: 'archived', bringBack: { ok: true, to: 'active', books: 14, canvassers: 6, downgraded: null } };
  const live = bringBackPassCopy(row);
  assert.equal(live.title, 'Bring back Pass 3?');
  assert.equal(live.body, "It goes live again: its 14 books return to 6 canvassers' phones the next time their map refreshes.");
  assert.equal(live.button, 'Bring back Pass 3');
  assert.equal(live.ok, true);

  const draft = bringBackPassCopy({ ...row, bringBack: { ok: true, to: 'draft', books: 3, canvassers: 0, downgraded: null } });
  assert.equal(draft.body, 'It comes back as a draft, as it was when it was archived. No canvasser gets its books until you activate it.');

  const empty = bringBackPassCopy({ ...row, bringBack: { ok: true, to: 'draft', books: 0, canvassers: 2, downgraded: 'no-doors' } });
  assert.match(empty.body, /^None of its books has doors left .* so it comes back as a draft: there would be nothing to walk\.$/);

  const unassigned = bringBackPassCopy({ ...row, bringBack: { ok: true, to: 'active', books: 1, canvassers: 0, downgraded: null } });
  assert.equal(unassigned.body, 'It goes live again with its 1 book; no canvasser is assigned to it yet.');

  const refused = bringBackPassCopy({
    ...row,
    bringBack: { ok: false, reason: 'later-pass-went-live', laterPass: { roundNumber: 4 } },
    bringBackMessage: "Pass 4 went live after this one ended, so it can't come back.",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.button, null);
  assert.equal(refused.body, "Pass 4 went live after this one ended, so it can't come back.");
});

test('Archive Pass 3: a live pass, a draft with knocks, the typed confirm', () => {
  const live = archivePassCopy({ roundNumber: 3, name: 'GOTV', status: 'active', knockCount: 1204 });
  assert.equal(live.title, 'Archive Pass 3 · GOTV?');
  assert.equal(
    live.body,
    'Canvassers lose its books the next time their map refreshes. Knocks are kept. You can bring it back until a newer pass on this walk list goes live.'
  );
  assert.equal(live.knocks, '1,204 knocks already recorded in this pass.');
  assert.equal(live.confirmWord, 'archive');
  assert.equal(live.button, 'Archive Pass 3');
  assert.doesNotMatch(live.body, /one-way/);

  const draft = archivePassCopy({ roundNumber: 2, name: 'Pass 2', status: 'draft', knockCount: 1 });
  assert.equal(draft.title, 'Archive Pass 2?');
  assert.equal(draft.body, 'No canvasser has its books. Its knocks are kept. You can bring it back as a draft.');
  assert.equal(draft.knocks, '1 knock already recorded in this pass.');

  const fresh = archivePassCopy({ roundNumber: 1, name: '', status: 'active', knockCount: 0 });
  assert.equal(fresh.confirmWord, null, 'no knocks, no typing — as before');
  assert.equal(fresh.knocks, null);
});

test('the line after: Undo where an undo is possible', () => {
  const pass = { roundNumber: 3, name: 'GOTV' };
  assert.deepEqual(noticeText({ kind: 'walk-list-archived', name: 'North', pass }), {
    tone: 'success',
    text: 'North archived — Pass 3 · GOTV ended.',
    undo: true,
  });
  assert.equal(noticeText({ kind: 'walk-list-archived', name: 'Main', pass: null }).text, 'Main archived.');
  assert.deepEqual(noticeText({ kind: 'pass-ended', name: 'North', pass }), {
    tone: 'success',
    text: 'Pass 3 · GOTV ended. Unarchive North to bring it back.',
    undo: false,
  });
  assert.equal(noticeText({ kind: 'walk-list-unarchived', name: 'North', pass, to: 'active' }).text, 'North unarchived — Pass 3 · GOTV is live again.');
  assert.equal(noticeText({ kind: 'walk-list-unarchived', name: 'North', pass, to: 'draft' }).text, 'North unarchived — Pass 3 · GOTV is back as a draft.');
  assert.equal(noticeText({ kind: 'walk-list-unarchived', name: 'North', pass: null, to: null }).text, 'North unarchived.');
  const warned = noticeText({
    kind: 'walk-list-unarchived',
    name: 'North',
    pass,
    to: null,
    bringBackError: { code: 'survey-required', error: '"North" is unarchived, but Pass 3 · GOTV couldn\'t come back: Add a survey.' },
  });
  assert.equal(warned.tone, 'warning');
  assert.equal(warned.undo, false);
  assert.match(warned.text, /couldn't come back/);
  assert.deepEqual(noticeText({ kind: 'pass-archived', pass }), { tone: 'success', text: 'Pass 3 · GOTV archived.', undo: true });
  assert.equal(noticeText({ kind: 'pass-back', pass, to: 'active' }).text, 'Pass 3 · GOTV is live again.');
  assert.equal(noticeText({ kind: 'pass-back', pass, to: 'draft' }).text, 'Pass 3 · GOTV is back as a draft.');
  assert.equal(noticeText({ kind: 'pass-back', pass, to: 'draft', downgraded: 'no-doors' }).text, 'Pass 3 · GOTV is back as a draft: its books have no doors left.');
  // A drawer's write refused because the walk list was archived meanwhile: the page says it, with the
  // server's sentence, since the row (and its open drawer) just moved into the archived section.
  assert.deepEqual(noticeText({ kind: 'archived-meanwhile', message: 'Walk list "North" is archived — unarchive it to change it.' }), {
    tone: 'warning',
    text: 'Walk list "North" is archived — unarchive it to change it. Its row is now under Archived walk lists.',
    undo: false,
  });
});

test('errors: the api client puts code on the error and the body on err.data', () => {
  const busy = Object.assign(new Error('Someone else is changing this walk list right now. Try again in a minute.'), {
    status: 409,
    code: 'lifecycle-busy',
    data: { code: 'lifecycle-busy', temporary: true },
  });
  assert.equal(isTemporaryError(busy), true);
  assert.equal(errorCode(busy), 'lifecycle-busy');
  assert.equal(isTemporaryError(new Error('x')), false);
  assert.equal(errorCode({ data: { code: 'pass-archived' } }), 'pass-archived');
  assert.equal(errorCode(null), null);
});
