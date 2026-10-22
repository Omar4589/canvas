import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversionBusy, editBusy, conversionListInterval, editListInterval, landedSince, nextToFollow, cardLandsIt, sameConversionState,
  sameEditState, refusedAsBusy, MOVING_MS, WAITING_MS,
} from './changeWatch.js';

// The Door Outcomes change lists' watch, as the page's effects use it (code review of 12b56fa).

test('a conversion is at work while queued, converting or being undone — never once landed or open', () => {
  for (const status of ['pending', 'running', 'reverting']) assert.equal(conversionBusy({ status }), true, status);
  for (const status of ['completed', 'failed', 'reverted', 'revert_failed', 'open']) assert.equal(conversionBusy({ status }), false, status);
});

test('a list is read every 3 s while a run moves, every 30 s while the only ones at work wait on the worker, and not otherwise', () => {
  assert.deepEqual([MOVING_MS, WAITING_MS], [3000, 30000]);
  assert.equal(conversionListInterval([{ status: 'completed' }, { status: 'running' }]), MOVING_MS);
  assert.equal(conversionListInterval([{ status: 'completed' }, { status: 'open' }]), false);
  assert.equal(conversionListInterval([]), false);
  assert.equal(editListInterval([{ status: 'running' }]), MOVING_MS);
  assert.equal(editListInterval([{ status: 'running', stalled: true }]), WAITING_MS, 'stopped responding: moves only on Start again');
  assert.equal(editListInterval([{ status: 'pending', waitingForWorker: true }]), WAITING_MS);
  assert.equal(editListInterval([{ status: 'completed', undo: { status: 'pending', waitingForWorker: true } }]), WAITING_MS);
  assert.equal(editListInterval([{ status: 'pending', waitingForWorker: true }, { status: 'running' }]), MOVING_MS, 'one moving is enough');
  assert.equal(editListInterval([{ status: 'completed' }, { status: 'open', mode: 'queue' }]), false, 'an open one-person session is settled');
});

test('a run landed since the last read is one that was at work and isn\'t now — one a live card lands is left to it', () => {
  const was = new Set(['a', 'b', 'c']);
  const now = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }, { id: 'c', status: 'reverted' }, { id: 'd', status: 'completed' }];
  assert.deepEqual(landedSince(was, now, conversionBusy).map((r) => r.id), ['a', 'c']);
  assert.deepEqual(landedSince(was, now, conversionBusy, { skip: (r) => r.id === 'a' }).map((r) => r.id), ['c']);
  assert.deepEqual(landedSince(new Set(), now, conversionBusy), [], 'nothing was at work: nothing landed (a first read)');
});

test('a live card lands a row itself only while its copy is at work, or already shows that same landing', () => {
  const conv = { busy: conversionBusy, same: sameConversionState };
  const row = { id: 'a', status: 'reverted', updatedAt: 't2' };
  assert.equal(cardLandsIt({ id: 'a', status: 'reverting', updatedAt: 't1' }, row, conv), true, 'its poll will see it');
  assert.equal(cardLandsIt({ id: 'a', status: 'reverted', updatedAt: 't2' }, row, conv), true, 'it already did');
  assert.equal(cardLandsIt({ id: 'a', status: 'completed', updatedAt: 't0' }, row, conv), false, 'settled earlier: the list lands it');
  assert.equal(cardLandsIt({ id: 'b', status: 'running' }, row, conv), false, 'another run');
  assert.equal(cardLandsIt(null, row, conv), false);
  const edit = { busy: editBusy, same: sameEditState };
  const editRow = { id: 'e', status: 'completed', undo: { status: 'done' } };
  assert.equal(cardLandsIt({ id: 'e', status: 'completed', undo: { status: 'running' } }, editRow, edit), true);
  assert.equal(cardLandsIt({ id: 'e', status: 'completed', undo: null }, editRow, edit), false, 'its undo, run elsewhere: the list lands it');
});

test('the card slot follows the first run at work not dismissed — and a settled card gives way, or follows its own run again', () => {
  const runs = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'pending' }, { id: 'c', status: 'running' }];
  const follow = (over) => {
    const next = nextToFollow({ runs, busy: conversionBusy, dismissed: new Set(), ...over });
    if (next) assert.equal(next.refresh, false, 'another run: followed from the list');
    return next?.run.id ?? null;
  };
  assert.equal(follow({}), 'b', 'no card: the first at work');
  assert.equal(follow({ dismissed: new Set(['b']) }), 'c');
  assert.equal(follow({ dismissed: new Set(['b', 'c']) }), null);
  assert.equal(follow({ cardId: 'c', card: { id: 'c', status: 'running' } }), null, 'a card at work stays');
  assert.equal(follow({ cardId: 'c', card: null }), null, 'a card still loading stays');
  assert.equal(follow({ cardId: 'a', card: { id: 'a', status: 'completed' } }), 'b', 'a settled card gives way to a run at work');
  // Its own run at work by the list: read again from the server — never the list's copy, which may be older than
  // the card's (the card had just landed, and the list hadn't caught up).
  const listBehind = [{ id: 'a', status: 'reverting' }, { id: 'b', status: 'pending' }];
  assert.deepEqual(nextToFollow({ runs: listBehind, busy: conversionBusy, dismissed: new Set(), cardId: 'a', card: { id: 'a', status: 'completed' } }), { run: listBehind[0], refresh: true });
  assert.equal(nextToFollow({ runs: [{ id: 'e', status: 'running', stalled: true }], busy: editBusy, dismissed: new Set() })?.run.id, 'e', 'a stalled edit still gets its card — it says Start again');
});

test('a refusal saying another change holds the campaign is told apart from any other', () => {
  assert.equal(refusedAsBusy({ code: 'ANOTHER_CHANGE_RUNNING' }), true);
  assert.equal(refusedAsBusy({ code: 'RUN_BUSY' }), true);
  assert.equal(refusedAsBusy({ code: 'REVIEW_STALE' }), false);
  assert.equal(refusedAsBusy(null), false);
});
