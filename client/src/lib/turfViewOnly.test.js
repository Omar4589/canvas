import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewOnlyReason,
  endedSentence,
  viewOnlyNotice,
  viewOnlyLine,
  snapshotRestoreNote,
  crewHint,
  undoDiscardSnapshotId,
} from './turfViewOnly.js';

// Turf Cutting's view-only page (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.3). Fixtures are GET /passes and
// GET /efforts rows; `day` stands in for the page's "Oct 12" formatter.

const day = (iso) => ({ '2026-10-12T15:00:00Z': 'Oct 12', '2026-10-27T15:00:00Z': 'Oct 27' })[iso] || iso;
const north = { _id: 'e-n', name: 'North', status: 'active' };
const northArchived = { ...north, status: 'archived' };
const live = { isActive: true };
const pass = (extra = {}) => ({ _id: 'p2', effortId: 'e-n', roundNumber: 2, name: 'Pass 2', status: 'archived', archivedAt: '2026-10-12T15:00:00Z', ...extra });

test('view-only: the campaign first, then the walk list, then the pass', () => {
  assert.equal(viewOnlyReason({ pass: pass(), effort: northArchived, campaign: { isActive: false } }), 'campaign');
  assert.equal(viewOnlyReason({ pass: pass({ status: 'draft' }), effort: northArchived, campaign: live }), 'walk-list');
  assert.equal(viewOnlyReason({ pass: pass(), effort: north, campaign: live }), 'pass');
  assert.equal(viewOnlyReason({ pass: pass({ status: 'active' }), effort: north, campaign: live }), null);
  assert.equal(viewOnlyReason({ pass: pass({ status: 'draft' }), effort: north, campaign: null }), null, 'a campaign still loading is not archived');
  assert.equal(viewOnlyReason(), null);
});

test('how a pass ended, for every way it can end', () => {
  assert.equal(endedSentence(pass({ archivedVia: 'next-pass', endedByPassName: 'Pass 3' }), north, day), 'It ended Oct 12, when Pass 3 went live.');
  assert.equal(endedSentence(pass({ archivedVia: 'next-pass', endedByPassName: null }), north, day), 'It ended Oct 12, when the next pass went live.');
  assert.equal(endedSentence(pass({ archivedVia: 'walk-list' }), north, day), 'It ended Oct 12, when North was archived.');
  assert.equal(endedSentence(pass({ archivedVia: 'pass', archivedByName: 'Ada Lovelace' }), north, day), 'It ended Oct 12, when Ada Lovelace archived it.');
  assert.equal(endedSentence(pass({ archivedVia: 'pass' }), north, day), 'It ended Oct 12, archived by hand.');
  assert.equal(endedSentence(pass({ archivedVia: 'repair' }), north, day), 'The one-time check ended it on Oct 12.');
  assert.equal(endedSentence(pass({ archivedFrom: 'draft', archivedVia: 'pass', archivedByName: 'Ada' }), north, day), 'It was a draft when Ada archived it on Oct 12.');
  // Archived before archivedVia existed: the server infers the pass that ended it, or nothing.
  assert.equal(endedSentence(pass({ endedByPassName: 'Pass 3 · GOTV' }), north, day), 'It ended Oct 12, when Pass 3 · GOTV went live.');
  assert.equal(endedSentence(pass(), north, day), 'It ended Oct 12.');
  assert.equal(endedSentence(pass({ archivedAt: null }), north, day), 'It ended.');
});

test('the banner: an archived pass that ended when the next went live, with its live successor', () => {
  const p2 = pass({ archivedVia: 'next-pass', endedByPassName: 'Pass 3', bringBack: { ok: false, reason: 'ended-by-next-pass' }, bringBackMessage: 'This pass ended when Pass 3 went live, so it can’t come back.' });
  const p3 = { _id: 'p3', effortId: 'e-n', roundNumber: 3, name: 'Pass 3', status: 'active' };
  const other = { _id: 'x', effortId: 'e-s', roundNumber: 1, name: 'Pass 1', status: 'active' };
  const notice = viewOnlyNotice({ pass: p2, effort: north, campaign: live, passes: [p2, other, p3], day });
  assert.equal(notice.text, "Pass 2 is archived. It ended Oct 12, when Pass 3 went live. You're looking at its books as they were.");
  assert.deepEqual(notice.action, { kind: 'open', label: 'Open Pass 3', passId: 'p3' }, "this walk list's live pass, never another list's");
  assert.ok(!/nothing here can change/i.test(notice.text));
});

test('the banner: Bring back when the rule allows it', () => {
  const p = pass({ name: 'GOTV', archivedVia: 'pass', archivedByName: 'Ada', bringBack: { ok: true, to: 'active' } });
  const notice = viewOnlyNotice({ pass: p, effort: north, campaign: live, passes: [p], day });
  assert.equal(notice.text, "Pass 2 · GOTV is archived. It ended Oct 12, when Ada archived it. You're looking at its books as they were.");
  assert.deepEqual(notice.action, { kind: 'bring-back', label: 'Bring back Pass 2 · GOTV' });
});

test('the banner: a refusal other than the ended-by-next-pass one is said; no live pass means no action', () => {
  const p = pass({ archivedVia: 'pass', bringBack: { ok: false, reason: 'survey-required' }, bringBackMessage: 'Add a survey to this campaign before a pass can go live again.' });
  const notice = viewOnlyNotice({ pass: p, effort: north, campaign: live, passes: [p], day });
  assert.equal(notice.text, "Pass 2 is archived. It ended Oct 12, archived by hand. You're looking at its books as they were. Add a survey to this campaign before a pass can go live again.");
  assert.equal(notice.action, null);
});

test('the banner: an archived walk list offers Unarchive, for its ended pass, its other passes and its drafts', () => {
  const ended = viewOnlyNotice({ pass: pass({ archivedVia: 'walk-list', bringBack: { ok: false, reason: 'walk-list-archived' } }), effort: northArchived, campaign: live, day });
  assert.equal(ended.text, "Pass 2 is archived. It ended Oct 12, when North was archived. You're looking at its books as they were.");
  assert.deepEqual(ended.action, { kind: 'unarchive', label: 'Unarchive North' });

  const older = viewOnlyNotice({ pass: pass({ archivedVia: 'next-pass', endedByPassName: 'Pass 3' }), effort: northArchived, campaign: live, day });
  assert.equal(older.text, "Pass 2 is archived. It ended Oct 12, when Pass 3 went live. North is archived too. You're looking at its books as they were.");

  const draft = viewOnlyNotice({ pass: pass({ roundNumber: 4, name: 'Pass 4', status: 'draft', archivedAt: null }), effort: northArchived, campaign: live, day });
  assert.equal(draft.text, "North is archived, so Pass 4 stays a draft and can't be cut or started. You're looking at its books as they were.");
  assert.deepEqual(draft.action, { kind: 'unarchive', label: 'Unarchive North' });

  const stillLive = viewOnlyNotice({ pass: pass({ status: 'active', archivedAt: null }), effort: northArchived, campaign: live, day });
  assert.equal(stillLive.text, "North is archived, but Pass 2 is still live. You're looking at its books as they are; unarchive North to change them.");
});

test('the banner: an archived campaign gives the campaign message and no action', () => {
  const notice = viewOnlyNotice({ pass: pass({ status: 'active', archivedAt: null }), effort: north, campaign: { isActive: false }, day });
  assert.equal(notice.text, "This campaign is archived, so Pass 2 is view-only. You're looking at its books as they were. An org admin can reactivate the campaign from Campaigns.");
  assert.equal(notice.action, null);
  assert.equal(viewOnlyNotice({ pass: pass({ status: 'draft' }), effort: north, campaign: live }), null, 'an editable page has no banner');
});

test('the short reason a read-only control prints', () => {
  assert.equal(viewOnlyLine({ pass: pass(), effort: north, campaign: { isActive: false } }), 'This campaign is archived — view only.');
  assert.equal(viewOnlyLine({ pass: pass({ status: 'draft' }), effort: northArchived, campaign: live }), 'North is archived — view only.');
  assert.equal(viewOnlyLine({ pass: pass({ name: 'GOTV' }), effort: north, campaign: live }), 'Pass 2 · GOTV is archived — view only.');
  assert.equal(viewOnlyLine({ pass: pass({ status: 'active' }), effort: north, campaign: live }), null);
});

test('the snapshot note says what restoring takes, and never offers what cannot happen', () => {
  const at = (p, e = north, c = live) => snapshotRestoreNote({ pass: p, effort: e, campaign: c });
  assert.equal(at(pass({ archivedVia: 'pass', bringBack: { ok: true } })), 'Bring the pass back to restore a snapshot.');
  assert.equal(at(pass({ archivedVia: 'pass', bringBack: { ok: false, reason: 'recut-locked', temporary: true } })), 'Bring the pass back to restore a snapshot.');
  assert.equal(at(pass({ archivedVia: 'pass', bringBack: { ok: false, reason: 'another-pass-live' } })), 'Bring the pass back to restore a snapshot.');
  assert.equal(at(pass({ archivedVia: 'next-pass', bringBack: { ok: false, reason: 'ended-by-next-pass' } })), "This pass can't come back, so its snapshots can't be restored.");
  assert.equal(at(pass({ archivedVia: 'pass', bringBack: { ok: false, reason: 'later-pass-went-live' } })), "This pass can't come back, so its snapshots can't be restored.");
  assert.equal(at(pass({ status: 'draft', archivedAt: null }), northArchived), 'Unarchive North to restore a snapshot.');
  assert.equal(at(pass({ archivedVia: 'walk-list' }), northArchived), 'Unarchive North and bring the pass back to restore a snapshot.');
  assert.equal(at(pass({ endedByPassName: 'Pass 3' }), northArchived), "This pass can't come back, so its snapshots can't be restored.", 'an inferred next-pass end');
  assert.equal(at(pass(), north, { isActive: false }), 'Reactivate the campaign to restore a snapshot.');
  assert.equal(at(pass({ status: 'active' })), null);
});

test('the Canvassers hint is neutral on a view-only page', () => {
  assert.equal(crewHint({ unassignedBooks: 12, publishedCount: 30 }), '12 books unassigned');
  assert.equal(crewHint({ unassignedBooks: 0, publishedCount: 30 }), 'every book covered');
  assert.equal(crewHint({ unassignedBooks: 12, publishedCount: 30, viewOnly: true }), '12 books had no canvasser');
  assert.equal(crewHint({ unassignedBooks: 1, publishedCount: 30, viewOnly: true }), '1 book had no canvasser');
  assert.equal(crewHint({ unassignedBooks: 0, publishedCount: 30, viewOnly: true }), 'every book had a canvasser');
  assert.equal(crewHint({ unassignedBooks: 0, publishedCount: 0, viewOnly: true }), undefined, 'drafts were never assignable');
});

test('Undo last discard belongs to the pass it was made on', () => {
  const last = { passId: 'p1', snapshotId: 's9' };
  assert.equal(undoDiscardSnapshotId(last, 'p1'), 's9');
  assert.equal(undoDiscardSnapshotId(last, 'p2'), null, "another pass never restores p1's snapshot");
  assert.equal(undoDiscardSnapshotId({ passId: { toString: () => 'p1' }, snapshotId: 's9' }, 'p1'), 's9', 'ids compare as strings');
  assert.equal(undoDiscardSnapshotId(null, 'p1'), null);
  assert.equal(undoDiscardSnapshotId(last, ''), null);
  assert.equal(undoDiscardSnapshotId({ passId: 'p1', snapshotId: null }, 'p1'), null, 'a drafts-only discard wrote no snapshot');
});
