import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkListState, isArchivedState, walkListActions, passEndedHow, archivedPassDetail } from './walkListState.js';

// Dates come in from the caller, formatted in the campaign's zone; a fixed table keeps these readable.
const DAYS = { '2026-10-27T15:00:00.000Z': 'Oct 27', '2026-10-20T15:00:00.000Z': 'Oct 20', '2026-10-12T15:00:00.000Z': 'Oct 12' };
const formatDate = (iso) => DAYS[iso] || 'some day';
const OCT27 = '2026-10-27T15:00:00.000Z';
const OCT20 = '2026-10-20T15:00:00.000Z';

const setup = (stepsDone, nextStepLabel, roundDone = true) => ({
  stepsDone,
  stepsTotal: 5,
  complete: false,
  nextStepLabel,
  steps: [
    { key: 'doors', status: 'done' },
    { key: 'round', status: roundDone ? 'done' : 'current' },
  ],
});
const effort = (over = {}) => ({
  _id: 'e1',
  name: 'North',
  status: 'active',
  activeRound: null,
  archivedAt: null,
  archivedByName: null,
  endedPassId: null,
  lastEndedPass: null,
  everLive: false,
  setup: setup(2, 'Books cut'),
  ...over,
});
const pass3 = { _id: 'p3', roundNumber: 3, name: 'GOTV' };
const read = (s) => `${s.label}${s.detail ? ` | ${s.detail}` : ''}`;

test('the nine states, in order — first match wins', () => {
  // 1. Archived before this change with its pass still live: amber, until the one-time check.
  const amber = walkListState(effort({ status: 'archived', activeRound: pass3, lastEndedPass: { ...pass3, _id: 'p2', roundNumber: 2 } }), { formatDate });
  assert.equal(read(amber), 'Archived | Pass 3 still live');
  assert.equal(amber.tone, 'warning');
  assert.equal(amber.key, 'archived-still-live');

  // 2. Archived, and that archive ended its live pass.
  const ended = walkListState(
    effort({
      status: 'archived',
      archivedAt: OCT27,
      archivedByName: 'Ada',
      endedPassId: 'p3',
      everLive: true,
      lastEndedPass: { ...pass3, archivedAt: OCT27, archivedVia: 'walk-list' },
    }),
    { formatDate }
  );
  assert.equal(read(ended), 'Archived | Oct 27 by Ada · Pass 3 ended');
  assert.equal(ended.tone, 'neutral');

  // 3. Archived, its pass ended by the one-time check (a pre-change archive: no date, no name).
  const repaired = walkListState(
    effort({ status: 'archived', endedPassId: 'p1', everLive: true, lastEndedPass: { _id: 'p1', roundNumber: 1, name: 'Pass 1', archivedVia: 'repair' } }),
    { formatDate }
  );
  assert.equal(read(repaired), 'Archived | Pass 1 ended by the one-time check');

  // 4. Archived with nothing live.
  assert.equal(read(walkListState(effort({ status: 'archived', archivedAt: OCT27, archivedByName: 'Ada' }), { formatDate })), 'Archived | Oct 27 by Ada');

  // 5. Archived before this change: nothing recorded who or when.
  const old = walkListState(effort({ status: 'archived' }), { formatDate });
  assert.equal(read(old), 'Archived');
  assert.equal(old.key, 'archived');

  // 6. Open with a live pass.
  const live = walkListState(effort({ activeRound: pass3, everLive: true }), { formatDate });
  assert.equal(read(live), 'Live | Pass 3');
  assert.equal(live.tone, 'success');

  // 7. Open, nothing live, a pass has been live — plus its waiting draft when the passes are known.
  const between = effort({ everLive: true, lastEndedPass: { _id: 'p1', roundNumber: 1, name: 'Pass 1', archivedAt: OCT20, archivedVia: 'pass' } });
  assert.equal(read(walkListState(between, { formatDate })), 'Between passes | Pass 1 ended Oct 20');
  const passes = [
    { _id: 'p1', effortId: 'e1', roundNumber: 1, status: 'archived' },
    { _id: 'p2', effortId: 'e1', roundNumber: 2, status: 'draft' },
    { _id: 'x9', effortId: 'other', roundNumber: 1, status: 'draft' },
  ];
  assert.equal(read(walkListState(between, { formatDate, passes })), 'Between passes | Pass 1 ended Oct 20 · Pass 2 draft');
  const twoDrafts = [...passes, { _id: 'p4', effortId: 'e1', roundNumber: 4, status: 'draft' }];
  assert.equal(read(walkListState(between, { formatDate, passes: twoDrafts })), 'Between passes | Pass 1 ended Oct 20 · 2 drafts');

  // 8. Open, no pass has ever been live.
  const settingUp = walkListState(effort({ setup: setup(4, 'Pass activated') }), { formatDate });
  assert.equal(read(settingUp), 'Setting up | 4/5 · next: Pass activated');
  assert.equal(settingUp.tone, 'info');

  // 9. Open with no pass at all.
  const none = walkListState(effort({ setup: setup(1, 'Pass created', false) }), { formatDate });
  assert.equal(read(none), 'No passes yet');
  assert.equal(none.key, 'no-passes');
});

test('an archived walk list never also reads Live', () => {
  for (const over of [
    { activeRound: pass3 },
    { activeRound: pass3, archivedAt: OCT27, archivedByName: 'Ada' },
    { archivedAt: OCT27, endedPassId: 'p3', lastEndedPass: { ...pass3, archivedVia: 'walk-list' } },
  ]) {
    const s = walkListState(effort({ status: 'archived', everLive: true, ...over }), { formatDate });
    assert.equal(s.label, 'Archived');
    assert.equal(isArchivedState(s), true);
    assert.doesNotMatch(s.detail, /^Live/);
  }
  assert.equal(isArchivedState(walkListState(effort({ activeRound: pass3 }))), false);
});

test('archived again after Unarchive only: the old ended pass is not claimed by the new archive', () => {
  // Unarchive clears endedPassId; the re-archive ended nothing, so the row says who archived it, no more.
  const s = walkListState(
    effort({
      status: 'archived',
      archivedAt: OCT27,
      archivedByName: 'Ada',
      endedPassId: null,
      everLive: true,
      lastEndedPass: { ...pass3, archivedAt: OCT20, archivedVia: 'walk-list' },
    }),
    { formatDate }
  );
  assert.equal(read(s), 'Archived | Oct 27 by Ada');
});

test('pre-change rows: older passes and walk lists show what was recorded, and never throw', () => {
  // A walk list archived before the change, whose last pass ended when the next went live (no archivedVia).
  const s = walkListState(
    { _id: 'e1', name: 'Main', status: 'archived', activeRound: null, lastEndedPass: { _id: 'p1', roundNumber: 1, archivedAt: OCT20 } },
    { formatDate }
  );
  assert.equal(read(s), 'Archived');
  // An open row without the new fields at all: an ended pass still reads as Between passes.
  assert.equal(
    read(walkListState({ _id: 'e2', status: 'active', lastEndedPass: { _id: 'p1', roundNumber: 1, archivedAt: OCT20 } }, { formatDate })),
    'Between passes | Pass 1 ended Oct 20'
  );
  // An open row with only today's setup chip.
  assert.equal(read(walkListState({ _id: 'e3', status: 'active', setup: setup(3, 'Canvassers assigned') })), 'Setting up | 3/5 · next: Canvassers assigned');
  // Nothing at all.
  assert.equal(read(walkListState(null)), 'No passes yet');
  assert.equal(read(walkListState({ status: 'archived' })), 'Archived');
  // The default date is the ISO day, so a caller that forgets the formatter still reads sensibly.
  assert.equal(read(walkListState(effort({ status: 'archived', archivedAt: OCT27 }))), 'Archived | 2026-10-27');
});

test('row actions: Manage/View, Archive/Unarchive, End Pass N, Delete only when it can work', () => {
  assert.deepEqual(walkListActions(effort({ canDelete: true })), { open: 'Manage', archive: true, unarchive: false, endPass: null, remove: true });
  assert.deepEqual(walkListActions(effort({ canDelete: false, activeRound: pass3 })), {
    open: 'Manage',
    archive: true,
    unarchive: false,
    endPass: null,
    remove: false,
  });
  assert.deepEqual(walkListActions(effort({ status: 'archived', canDelete: true })), {
    open: 'View',
    archive: false,
    unarchive: true,
    endPass: null,
    remove: true,
  });
  // The amber state offers Unarchive and End Pass 3.
  assert.deepEqual(walkListActions(effort({ status: 'archived', activeRound: pass3, canDelete: false })), {
    open: 'View',
    archive: false,
    unarchive: true,
    endPass: 'End Pass 3',
    remove: false,
  });
  // An archived campaign turns every change off.
  for (const e of [effort({ canDelete: true }), effort({ status: 'archived', activeRound: pass3, canDelete: true })]) {
    assert.deepEqual(walkListActions(e, { campaignArchived: true }), { open: 'View', archive: false, unarchive: false, endPass: null, remove: false });
  }
  // canDelete missing (an older server) hides Delete rather than offering one that may fail.
  assert.equal(walkListActions(effort()).remove, false);
});

test('how an archived pass ended, for its row', () => {
  assert.equal(passEndedHow({ archivedVia: 'pass' }), 'by hand');
  assert.equal(passEndedHow({ archivedVia: 'walk-list' }, 'North'), 'when North was archived');
  assert.equal(passEndedHow({ archivedVia: 'walk-list' }), 'when its walk list was archived');
  assert.equal(passEndedHow({ archivedVia: 'next-pass', endedByPassName: 'Pass 4 · GOTV' }), 'when Pass 4 · GOTV went live');
  assert.equal(passEndedHow({ archivedVia: 'next-pass', endedByPassName: null }), 'when the next pass went live', 'a deleted next pass');
  assert.equal(passEndedHow({ archivedVia: 'repair' }), 'by the one-time check');
  // Pre-change rows: inferred from the shared timestamp when the server could, else nothing.
  assert.equal(passEndedHow({ archivedVia: null, endedByPassName: 'Pass 3' }), 'when Pass 3 went live');
  assert.equal(passEndedHow({ archivedVia: null }), '');

  assert.equal(
    archivedPassDetail({ archivedAt: OCT27, archivedByName: 'Ada', archivedVia: 'pass' }, { formatDate }),
    'Oct 27 by Ada · by hand'
  );
  assert.equal(
    archivedPassDetail({ archivedAt: '2026-10-12T15:00:00.000Z', archivedVia: 'next-pass', endedByPassName: 'Pass 3' }, { formatDate }),
    'Oct 12 · when Pass 3 went live'
  );
  assert.equal(archivedPassDetail({ archivedAt: OCT27, archivedVia: 'walk-list' }, { formatDate, effortName: 'North' }), 'Oct 27 · when North was archived');
  assert.equal(archivedPassDetail({ archivedAt: null, archivedVia: null }, { formatDate }), '');
});
