import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultPass, groupPassesByEffortStatus } from './passPicker.js';

const effort = (id, status, day) => ({ _id: id, status, createdAt: `2026-08-${day}T00:00:00Z` });
const pass = (id, effortId, { status = 'draft', turfCount = 3, day = '01' } = {}) => ({
  _id: id,
  effortId,
  status,
  turfCount,
  createdAt: `2026-08-${day}T00:00:00Z`,
});

test('an ACTIVE walk list wins over a draft one holding uncut work — the reported bug', () => {
  const efforts = [effort('e-draft', 'draft', '07'), effort('e-active', 'active', '02')];
  const passes = [
    pass('p-draft-uncut', 'e-draft', { turfCount: 0, day: '08' }), // old rule picked this
    pass('p-active-cut', 'e-active', { status: 'active', turfCount: 5 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-active-cut');
});

test('within the active list, an uncut pass beats an already-cut active one', () => {
  const efforts = [effort('e', 'active', '01')];
  const passes = [
    pass('p-cut', 'e', { status: 'active', turfCount: 5 }),
    pass('p-uncut', 'e', { status: 'draft', turfCount: 0 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-uncut');
});

test('several active lists with uncut work: the NEWEST walk list wins', () => {
  const efforts = [effort('e-old', 'active', '02'), effort('e-new', 'active', '07')];
  const passes = [
    pass('p-old', 'e-old', { turfCount: 0, day: '08' }), // newer PASS, older list
    pass('p-new', 'e-new', { turfCount: 0, day: '03' }),
  ];
  assert.equal(
    pickDefaultPass({ passes, efforts })._id,
    'p-new',
    'the walk list date is the tie-break, not the pass date'
  );
});

test('same walk list, two uncut passes: the newest pass wins', () => {
  const efforts = [effort('e', 'active', '01')];
  const passes = [
    pass('p-older', 'e', { turfCount: 0, day: '03' }),
    pass('p-newer', 'e', { turfCount: 0, day: '09' }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-newer');
});

test('no active walk list: a DRAFT list is next, and its uncut pass is preferred', () => {
  const efforts = [effort('e-arch', 'archived', '09'), effort('e-draft', 'draft', '02')];
  const passes = [
    pass('p-arch', 'e-arch', { turfCount: 0 }),
    pass('p-draft-cut', 'e-draft', { turfCount: 4 }),
    pass('p-draft-uncut', 'e-draft', { turfCount: 0 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-draft-uncut');
});

test('archived is the last resort, never chosen while anything else exists', () => {
  const efforts = [effort('e-arch', 'archived', '09'), effort('e-draft', 'draft', '01')];
  const passes = [pass('p-arch', 'e-arch', { turfCount: 0 }), pass('p-draft', 'e-draft', { turfCount: 9 })];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-draft');
});

test('an ARCHIVED pass never wins over a live one on the same list', () => {
  const efforts = [effort('e', 'active', '01')];
  const passes = [
    pass('p-archived', 'e', { status: 'archived', turfCount: 0 }), // uncut, but archived
    pass('p-live', 'e', { status: 'draft', turfCount: 7 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-live');
});

test('a campaign whose only passes are archived still lands somewhere', () => {
  const efforts = [effort('e', 'archived', '01')];
  const passes = [pass('p', 'e', { status: 'archived', turfCount: 2 })];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p');
});

test('degenerate inputs do not throw', () => {
  assert.equal(pickDefaultPass({ passes: [], efforts: [] }), null);
  assert.equal(pickDefaultPass(), null);
  // A pass whose walk list is missing from the efforts list still resolves.
  assert.equal(pickDefaultPass({ passes: [pass('p', 'gone')], efforts: [] })._id, 'p');
});

test('grouping keeps every pass reachable and drops empty groups', () => {
  const efforts = [effort('e-a', 'active', '01'), effort('e-x', 'archived', '01')];
  const passes = [pass('p1', 'e-a'), pass('p2', 'e-x'), pass('p3', 'orphan')];
  const groups = groupPassesByEffortStatus({ passes, efforts });

  assert.deepEqual(groups.map((g) => g.key), ['active', 'archived'], 'empty Draft group dropped');
  assert.equal(groups[0].passes.length, 1);
  // The orphan is filed under Archived rather than vanishing.
  assert.deepEqual(groups[1].passes.map((p) => p._id).sort(), ['p2', 'p3']);
  const total = groups.reduce((n, g) => n + g.passes.length, 0);
  assert.equal(total, passes.length, 'grouping never loses a pass');
});
