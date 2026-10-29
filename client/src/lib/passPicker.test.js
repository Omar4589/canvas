import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultPass, groupPassesByState, passPickerLabel, passState } from './passPicker.js';

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

// ── The dropdown: grouped by what each pass IS (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.3) ──

const named = (id, name, status = 'active') => ({ _id: id, name, status, createdAt: '2026-08-01T00:00:00Z' });
const round = (id, effortId, roundNumber, status = 'draft', name = `Pass ${roundNumber}`) => ({
  _id: id,
  effortId,
  roundNumber,
  name,
  status,
  turfCount: 3,
  createdAt: '2026-08-01T00:00:00Z',
});
const ids = (group) => group.options.map((o) => o.value);
const labels = (group) => group.options.map((o) => o.label);
const groupOf = (groups, key) => groups.find((g) => g.key === key);

test('grouping: Live, Drafts, Archived by the pass itself, and every pass of an archived walk list is Archived', () => {
  const efforts = [named('e-north', 'North'), named('e-west', 'West', 'archived')];
  const passes = [
    round('n1', 'e-north', 1, 'archived'), // ended by Pass 2 — an archived pass of a RUNNING walk list
    round('n2', 'e-north', 2, 'active'),
    round('n3', 'e-north', 3, 'draft'),
    round('w1', 'e-west', 1, 'archived'),
    round('w2', 'e-west', 2, 'draft'), // a frozen draft of an archived walk list
    round('orphan', 'gone', 1, 'draft'),
  ];
  const groups = groupPassesByState({ passes, efforts });

  assert.deepEqual(groups.map((g) => g.key), ['live', 'drafts', 'archived']);
  assert.deepEqual(groups.map((g) => g.label), ['Live', 'Drafts', 'Archived']);
  assert.deepEqual(ids(groupOf(groups, 'live')), ['n2']);
  // The old grouping put North's ended Pass 1 under "Active round" and an orphan under "Not started".
  assert.deepEqual(ids(groupOf(groups, 'drafts')), ['n3', 'orphan'], 'an orphan goes by its own status, never hidden');
  assert.deepEqual(ids(groupOf(groups, 'archived')), ['n1', 'w1', 'w2']);

  const total = groups.reduce((n, g) => n + g.options.length, 0);
  assert.equal(total, passes.length, 'grouping never loses a pass');
});

test('grouping: a running walk list keeps its live pass under Live — not under Archived like the old tiers', () => {
  // The old tiers sorted by the WALK LIST: a live pass of a list with an archived Effort.status went
  // under "Archived", and an ended pass of a running list under "Active round".
  const efforts = [named('e', 'Main')];
  const passes = [round('p1', 'e', 1, 'archived'), round('p2', 'e', 2, 'active')];
  const groups = groupPassesByState({ passes, efforts });
  assert.deepEqual(ids(groupOf(groups, 'live')), ['p2']);
  assert.deepEqual(ids(groupOf(groups, 'archived')), ['p1']);
});

test('labels: walk list · Pass N · name, skipping a name that only repeats "Pass N", marked on an archived walk list', () => {
  const efforts = [named('e-north', 'North'), named('e-west', 'West', 'archived')];
  const passes = [
    round('n2', 'e-north', 2, 'archived'), // auto-named "Pass 2"
    round('n3', 'e-north', 3, 'active', 'GOTV'),
    round('w1', 'e-west', 1, 'archived'),
    round('w2', 'e-west', 2, 'draft'),
    round('w3', 'e-west', 3, 'active'), // still live: an archive from before the one-time repair
  ];
  const groups = groupPassesByState({ passes, efforts });
  assert.deepEqual(labels(groupOf(groups, 'live')), ['North · Pass 3 · GOTV']);
  assert.deepEqual(labels(groupOf(groups, 'archived')), [
    'North · Pass 2', // an archived pass of an open walk list: the heading says it all
    'West · Pass 1 · walk list archived',
    'West · Pass 2 (draft) · walk list archived',
    'West · Pass 3 (still live) · walk list archived',
  ]);
  // A pass whose walk list is missing still gets a readable label.
  assert.equal(passPickerLabel(round('o', 'gone', 4), null), 'Walk list · Pass 4');
});

test('sorting: by walk list name, then round number, within each group', () => {
  const efforts = [named('e-s', 'South'), named('e-c', 'Central'), named('e-p10', 'Precinct 10'), named('e-p2', 'Precinct 2')];
  const passes = [
    round('s3', 'e-s', 3),
    round('c1', 'e-c', 1),
    round('s1', 'e-s', 1),
    round('p10', 'e-p10', 1),
    round('p2', 'e-p2', 1),
  ];
  const drafts = groupOf(groupPassesByState({ passes, efforts }), 'drafts');
  assert.deepEqual(labels(drafts), [
    'Central · Pass 1',
    'Precinct 2 · Pass 1', // numeric: "Precinct 2" before "Precinct 10"
    'Precinct 10 · Pass 1',
    'South · Pass 1',
    'South · Pass 3',
  ]);
});

test('sorting: two walk lists with the same name keep their passes apart', () => {
  const efforts = [named('e-a', 'Main'), named('e-b', 'Main')];
  const passes = [round('b1', 'e-b', 1), round('a2', 'e-a', 2), round('b2', 'e-b', 2), round('a1', 'e-a', 1)];
  assert.deepEqual(ids(groupOf(groupPassesByState({ passes, efforts }), 'drafts')), ['a1', 'a2', 'b1', 'b2']);
});

test('passState: own status, overridden by an archived walk list', () => {
  const open = named('e', 'North');
  const archived = named('e', 'North', 'archived');
  assert.equal(passState({ status: 'active' }, open), 'live');
  assert.equal(passState({ status: 'draft' }, open), 'drafts');
  assert.equal(passState({ status: 'archived' }, open), 'archived');
  assert.equal(passState({ status: 'draft' }, archived), 'archived');
  assert.equal(passState({ status: 'active' }, archived), 'archived');
  assert.equal(passState({ status: 'draft' }, null), 'drafts');
});

test('degenerate grouping inputs do not throw', () => {
  assert.deepEqual(groupPassesByState(), []);
  assert.deepEqual(groupPassesByState({ passes: [], efforts: null }), []);
});

test('the default is never under Archived unless every pass is (every small campaign shape)', () => {
  // Guards the landing rule and the headings against drifting apart. Exhaustive over two walk lists
  // (each open or archived) holding up to two passes each, in every status, cut or uncut.
  const kinds = [];
  for (const status of ['draft', 'active', 'archived']) for (const turfCount of [0, 3]) kinds.push({ status, turfCount });
  const passSets = [[], ...kinds.map((k) => [k]), ...kinds.flatMap((a) => kinds.map((b) => [a, b]))];
  let checked = 0;
  for (const aState of ['active', 'archived']) {
    for (const bState of ['active', 'archived']) {
      const efforts = [effort('e-a', '02', aState), effort('e-b', '07', bState)];
      for (const aSet of passSets) {
        for (const bSet of passSets) {
          const passes = [
            ...aSet.map((k, i) => pass(`a${i}`, 'e-a', { ...k, day: `0${i + 1}` })),
            ...bSet.map((k, i) => pass(`b${i}`, 'e-b', { ...k, day: `0${i + 3}` })),
          ];
          if (!passes.length) continue;
          const chosen = pickDefaultPass({ passes, efforts });
          const archived = groupPassesByState({ passes, efforts }).find((g) => g.key === 'archived');
          const archivedIds = new Set((archived?.options || []).map((o) => o.value));
          if (archivedIds.has(String(chosen._id))) {
            assert.equal(
              archivedIds.size,
              passes.length,
              `default ${chosen._id} sits under Archived while a live or draft pass exists: ${JSON.stringify({ efforts, passes })}`
            );
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 7000, `checked ${checked} shapes`);
});
