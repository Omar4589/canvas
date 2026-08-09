import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultPass, groupPassesByEffortStatus } from './passPicker.js';

// NOTE THE DEFAULT. Effort.status defaults to 'active' in the model, so in real data virtually
// every walk list is 'active' regardless of whether anyone is walking it. These fixtures mirror
// that on purpose — the first version of this ranking keyed on Effort.status, which therefore
// tiered everything into the top bucket and silently degraded to the old pass-only behaviour.
const effort = (id, day, status = 'active') => ({
  _id: id,
  status,
  createdAt: `2026-08-${day}T00:00:00Z`,
});
const pass = (id, effortId, { status = 'draft', turfCount = 3, day = '01' } = {}) => ({
  _id: id,
  effortId,
  status,
  turfCount,
  createdAt: `2026-08-${day}T00:00:00Z`,
});

test('REGRESSION: a walk list with an active round beats an idle one holding uncut work', () => {
  // Both efforts carry status 'active' — the model default — so only the PASSES distinguish them.
  const efforts = [effort('e-idle', '07'), effort('e-running', '02')];
  const passes = [
    pass('p-idle-uncut', 'e-idle', { turfCount: 0, day: '08' }), // what the buggy version picked
    pass('p-running', 'e-running', { status: 'active', turfCount: 5 }),
  ];
  assert.equal(
    pickDefaultPass({ passes, efforts })._id,
    'p-running',
    'Effort.status is useless here — the active PASS is what marks a list as being walked'
  );
});

test('within the running list, an uncut pass beats the already-cut active one', () => {
  const efforts = [effort('e', '01')];
  const passes = [
    pass('p-active-cut', 'e', { status: 'active', turfCount: 5 }),
    pass('p-uncut', 'e', { status: 'draft', turfCount: 0 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-uncut');
});

test('several running lists with uncut work: the NEWEST walk list wins', () => {
  const efforts = [effort('e-old', '02'), effort('e-new', '07')];
  const passes = [
    pass('p-old-live', 'e-old', { status: 'active', turfCount: 4 }),
    pass('p-old-uncut', 'e-old', { turfCount: 0, day: '09' }), // newer PASS, older list
    pass('p-new-live', 'e-new', { status: 'active', turfCount: 4 }),
    pass('p-new-uncut', 'e-new', { turfCount: 0, day: '03' }),
  ];
  assert.equal(
    pickDefaultPass({ passes, efforts })._id,
    'p-new-uncut',
    'the walk list date is the tie-break, not the pass date'
  );
});

test('same walk list, two uncut passes: the newest pass wins', () => {
  const efforts = [effort('e', '01')];
  const passes = [
    pass('p-live', 'e', { status: 'active', turfCount: 2 }),
    pass('p-older', 'e', { turfCount: 0, day: '03' }),
    pass('p-newer', 'e', { turfCount: 0, day: '09' }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-newer');
});

test('no list has an active round: the idle tier is next, uncut preferred', () => {
  const efforts = [effort('e-arch', '09', 'archived'), effort('e-idle', '02')];
  const passes = [
    pass('p-arch', 'e-arch', { turfCount: 0 }),
    pass('p-idle-cut', 'e-idle', { turfCount: 4 }),
    pass('p-idle-uncut', 'e-idle', { turfCount: 0 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-idle-uncut');
});

test('an ARCHIVED walk list is the last resort even when it is the one being walked', () => {
  const efforts = [effort('e-arch', '09', 'archived'), effort('e-idle', '01')];
  const passes = [
    pass('p-arch-live', 'e-arch', { status: 'active', turfCount: 0 }),
    pass('p-idle', 'e-idle', { turfCount: 9 }),
  ];
  assert.equal(
    pickDefaultPass({ passes, efforts })._id,
    'p-idle',
    'archived is what Effort.status is genuinely for, and it still demotes'
  );
});

test('an ARCHIVED pass never wins over a live one on the same list', () => {
  const efforts = [effort('e', '01')];
  const passes = [
    pass('p-archived', 'e', { status: 'archived', turfCount: 0 }), // uncut, but archived
    pass('p-live', 'e', { status: 'active', turfCount: 7 }),
  ];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p-live');
});

test('a campaign whose only passes are archived still lands somewhere', () => {
  const efforts = [effort('e', '01', 'archived')];
  const passes = [pass('p', 'e', { status: 'archived', turfCount: 2 })];
  assert.equal(pickDefaultPass({ passes, efforts })._id, 'p');
});

test('degenerate inputs do not throw', () => {
  assert.equal(pickDefaultPass({ passes: [], efforts: [] }), null);
  assert.equal(pickDefaultPass(), null);
  // A pass whose walk list is missing from the efforts list still resolves.
  assert.equal(pickDefaultPass({ passes: [pass('p', 'gone')], efforts: [] })._id, 'p');
});

test('grouping uses the same tiers as the ranking, keeps every pass, drops empty groups', () => {
  const efforts = [effort('e-run', '01'), effort('e-arch', '01', 'archived')];
  const passes = [
    pass('p-run', 'e-run', { status: 'active' }),
    pass('p-arch', 'e-arch'),
    pass('p-orphan', 'gone'),
  ];
  const groups = groupPassesByEffortStatus({ passes, efforts });

  assert.deepEqual(groups.map((g) => g.key), ['running', 'idle', 'archived']);
  assert.deepEqual(groups[0].passes.map((p) => p._id), ['p-run']);
  assert.deepEqual(groups[1].passes.map((p) => p._id), ['p-orphan'], 'an orphan is idle, not hidden');
  assert.deepEqual(groups[2].passes.map((p) => p._id), ['p-arch']);

  const total = groups.reduce((n, g) => n + g.passes.length, 0);
  assert.equal(total, passes.length, 'grouping never loses a pass');
});

test('the chosen default is always inside the FIRST non-empty group', () => {
  // Guards the ranking and the grouping against drifting apart.
  const efforts = [effort('e-run', '03'), effort('e-idle', '09'), effort('e-arch', '01', 'archived')];
  const passes = [
    pass('p-idle-uncut', 'e-idle', { turfCount: 0, day: '09' }),
    pass('p-run-cut', 'e-run', { status: 'active', turfCount: 6 }),
    pass('p-arch', 'e-arch', { turfCount: 0 }),
  ];
  const chosen = pickDefaultPass({ passes, efforts });
  const first = groupPassesByEffortStatus({ passes, efforts })[0];
  assert.ok(
    first.passes.some((p) => p._id === chosen._id),
    `default ${chosen._id} should sit in the first group (${first.key})`
  );
});
