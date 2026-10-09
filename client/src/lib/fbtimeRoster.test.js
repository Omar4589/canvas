import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildRosterRows,
  filterRosterRows,
  sortRosterRows,
  rosterCounts,
  resolveSelection,
  linkCandidates,
  suggestedPairs,
  asksLinkQuestion,
  cantRelink,
  unlinkQuestion,
  ROW_STATUS,
} from './fbtimeRoster.js';

// The visibility rules here are the ones a redesign gets wrong quietly: hiding a
// row that is the only evidence of a problem looks identical to not having the
// problem. Each of the four below pins a way that could happen.

const member = (id, over = {}) => ({
  membershipId: `m${id}`,
  role: 'canvasser',
  isActive: true,
  campaignIds: [],
  managedCampaignIds: [],
  fbtime: null,
  ...over,
  user: {
    id,
    firstName: 'First',
    lastName: id.toUpperCase(),
    email: `${id}@org.com`,
    isActive: true,
    isDeleted: false,
    ...(over.user || {}),
  },
});

const person = (id, over = {}) => ({
  fbtimePersonId: id,
  firstName: 'Fb',
  lastName: id.toUpperCase(),
  email: `${id}@fb.com`,
  isActive: true,
  linkedUserId: null,
  linkSource: null,
  hasUnmatchedHours: false,
  ...over,
});

const CAMPAIGNS = [
  { _id: 'c1', name: 'Ward 5', isActive: true },
  { _id: 'c2', name: 'Old Race', isActive: false },
];

test('folds both sides into one row list, one row per pairing', () => {
  const { rows } = buildRosterRows({
    people: [person('p1', { linkedUserId: 'u1' }), person('p2')],
    members: [member('u1'), member('u2')],
    campaigns: CAMPAIGNS,
  });
  assert.equal(rows.length, 3, 'one pair + one FbTime-only + one Doorline-only');
  assert.deepEqual(
    rows.map((r) => r.kind).sort(),
    ['linked', 'needs-link', 'no-fbtime']
  );
  // A linked member must not ALSO appear as a Doorline-only row.
  assert.equal(rows.filter((r) => r.userId === 'u1').length, 1);
});

test('keys never collide across the two id spaces', () => {
  // A user id and a person id that are the SAME STRING — the collision a naive
  // key would produce, since both are 24-hex from different systems.
  const { rows } = buildRosterRows({
    people: [person('abc')],
    members: [member('abc')],
    campaigns: CAMPAIGNS,
  });
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  assert.deepEqual(keys.sort(), ['d:abc', 'f:abc']);
});

test('a LINKED row is never hidden by Include inactive, even when FbTime says inactive', () => {
  // Hiding a pairing makes it unfixable: you cannot unlink what you cannot see.
  const { rows } = buildRosterRows({
    people: [person('p1', { linkedUserId: 'u1', isActive: false })],
    members: [member('u1')],
    campaigns: CAMPAIGNS,
  });
  assert.equal(rows[0].inactiveSide, false);
  assert.deepEqual(filterRosterRows(rows, { includeInactive: false }).length, 1);
  assert.ok(rows[0].flags.includes('fbtime-inactive'), 'still FLAGGED, just not hidden');
});

test('unassigned hours are never hidden, even on an inactive FbTime person', () => {
  // Hours accruing into nothing are the only state actively costing the customer
  // accuracy right now. A toggle must not be able to bury one.
  const { rows } = buildRosterRows({
    people: [person('p1', { isActive: false, hasUnmatchedHours: true })],
    members: [],
    campaigns: CAMPAIGNS,
  });
  assert.equal(rows[0].inactiveSide, false);
  assert.equal(rows[0].status, 'needs-link-hours');
  assert.equal(filterRosterRows(rows, { includeInactive: false }).length, 1);
});

test('a dangling link becomes an orphan row, sorts first, and is never filtered out', () => {
  // The regression: the old page rendered this as the bare word "Linked", so the
  // most dangerous row on the page (hours attributed to someone who left) was the
  // tidiest-looking one.
  const { rows } = buildRosterRows({
    people: [person('p1', { linkedUserId: 'gone' }), person('p2', { linkedUserId: 'u1' })],
    members: [member('u1')],
    campaigns: CAMPAIGNS,
  });
  const orphan = rows.find((r) => r.kind === 'orphan');
  assert.ok(orphan, 'a link pointing at a non-member is an orphan');
  assert.equal(orphan.status, 'orphan');
  assert.equal(orphan.inactiveSide, false);
  assert.equal(sortRosterRows(rows, { key: 'status', dir: 'asc' })[0].kind, 'orphan');
  assert.equal(filterRosterRows(rows, { includeInactive: false }).some((r) => r.kind === 'orphan'), true);
});

test('orphanLinks and ghostPersonIds surface people the roster proxy cannot return', () => {
  const { rows } = buildRosterRows({
    people: [],
    members: [member('u1')],
    orphanLinks: [
      { fbtimePersonId: 'p9', userId: 'u1', fbtimeName: 'Gone Person', fbtimeEmail: 'g@fb.com', source: 'manual' },
    ],
    ghostPersonIds: ['p8'],
    campaigns: CAMPAIGNS,
  });
  const orphan = rows.find((r) => r.kind === 'orphan');
  const ghost = rows.find((r) => r.kind === 'ghost');
  assert.equal(orphan.fbtimeName, 'Gone Person', 'identity comes from the denormalized link');
  assert.equal(orphan.name, 'First U1', 'the Doorline side is still resolved when they ARE a member');
  assert.equal(ghost.hasUnmatchedHours, true);
  assert.equal(ghost.status, 'ghost');
  assert.equal(rows.filter((r) => r.kind === 'no-fbtime').length, 0, 'u1 is consumed by the orphan link');
});

test('a deletion tombstone is flagged, hidden when unlinked, and shown when linked', () => {
  const dead = member('u1', { isActive: false, user: { isDeleted: true, firstName: 'Deleted', lastName: 'user' } });
  const solo = buildRosterRows({ people: [], members: [dead], campaigns: CAMPAIGNS }).rows[0];
  assert.ok(solo.flags.includes('member-deleted'));
  assert.equal(solo.inactiveSide, true, 'noise when there is no FbTime side at all');

  const linked = buildRosterRows({
    people: [person('p1', { linkedUserId: 'u1' })],
    members: [dead],
    campaigns: CAMPAIGNS,
  }).rows[0];
  assert.equal(linked.inactiveSide, false, 'but a live link to a dead account must stay visible');
});

test('campaign chips are active-only, while the filter still matches an archived id', () => {
  const { rows } = buildRosterRows({
    people: [],
    members: [member('u1', { campaignIds: ['c1', 'c2'] })],
    campaigns: CAMPAIGNS,
  });
  assert.deepEqual(rows[0].campaigns.map((c) => c.name), ['Ward 5'], 'archived campaign is not a chip');
  assert.deepEqual(rows[0].campaignIds, ['c1', 'c2'], 'but both ids are held for filtering');
  assert.equal(filterRosterRows(rows, { campaignId: 'c2' }).length, 1);
});

test('a campaign id that resolves to nothing renders, rather than vanishing', () => {
  // /admin/campaigns ships mid-deletion campaigns in a SEPARATE array, so an
  // unresolvable id is expected. Dropping it would desync the chips and the filter.
  const { rows } = buildRosterRows({
    people: [],
    members: [member('u1', { campaignIds: ['deleting1'] })],
    campaigns: CAMPAIGNS,
  });
  assert.deepEqual(rows[0].campaignIds, ['deleting1']);
  assert.equal(rows[0].campaigns.length, 0, 'not an ACTIVE chip');
});

test('null-sink survives BOTH sort directions', () => {
  // The bug this pins: partitioning after applying direction floats every empty
  // value to the top on desc, making one of the two directions useless.
  const { rows } = buildRosterRows({
    people: [person('p1', { lastName: 'AAA' })],
    members: [member('u1'), member('u2')],
    campaigns: CAMPAIGNS,
  });
  for (const dir of ['asc', 'desc']) {
    const sorted = sortRosterRows(rows, { key: 'fbtime', dir });
    assert.equal(sorted[0].kind, 'needs-link', `the row WITH an FbTime name leads on ${dir}`);
    assert.ok(sorted.slice(1).every((r) => !r.fbtimeName), `rows without one sink on ${dir}`);
  }
});

test('sorting is deterministic across shuffled input', () => {
  const build = (people) => buildRosterRows({ people, members: [], campaigns: CAMPAIGNS }).rows;
  const a = sortRosterRows(build([person('p1'), person('p2'), person('p3')]), { key: 'status' });
  const b = sortRosterRows(build([person('p3'), person('p1'), person('p2')]), { key: 'status' });
  assert.deepEqual(a.map((r) => r.key), b.map((r) => r.key));
});

test('default status order puts the work at the top', () => {
  const { rows } = buildRosterRows({
    people: [
      person('pA', { linkedUserId: 'u1' }),
      person('pB'),
      person('pC', { hasUnmatchedHours: true }),
      person('pD', { linkedUserId: 'gone' }),
    ],
    members: [member('u1')],
    campaigns: CAMPAIGNS,
  });
  const order = sortRosterRows(rows, { key: 'status', dir: 'asc' }).map((r) => r.status);
  assert.deepEqual(order.slice(0, 3), ['orphan', 'needs-link-hours', 'needs-link']);
  assert.equal(order.at(-1), 'linked', 'the done pile is last');
  assert.ok(ROW_STATUS.orphan.rank < ROW_STATUS.linked.rank);
});

test('counts describe exactly what the count line claims', () => {
  const { rows } = buildRosterRows({
    people: [person('p1', { isActive: false }), person('p2', { linkedUserId: 'u1' })],
    members: [member('u1'), member('u2', { isActive: false })],
    campaigns: CAMPAIGNS,
  });
  const visible = filterRosterRows(rows, { includeInactive: false });
  const c = rosterCounts(rows, visible);
  assert.equal(c.total, 3);
  assert.equal(c.shown, 1, 'the dormant FbTime person and the switched-off member are hidden');
  assert.equal(c.inactiveHidden, 2);
  assert.equal(c.shown + c.inactiveHidden, c.total, 'the line adds up');
});

test('selection drops rows a narrowed search made invisible', () => {
  const { rows } = buildRosterRows({
    people: [person('p1'), person('p2')],
    members: [],
    campaigns: CAMPAIGNS,
  });
  const selected = new Set(rows.map((r) => r.key));
  const visible = filterRosterRows(rows, { term: 'p1' });
  assert.equal(resolveSelection(selected, visible).length, 1, 'never act on an off-screen row');
});

test('link candidates exclude the already-linked and pin the email match first', () => {
  const { rows } = buildRosterRows({
    people: [person('p1', { email: 'u2@org.com' }), person('p2', { linkedUserId: 'u1' })],
    members: [member('u1'), member('u2'), member('u3')],
    campaigns: CAMPAIGNS,
  });
  const target = { side: 'doorline', row: rows.find((r) => r.fbtimePersonId === 'p1') };
  const cands = linkCandidates(rows, target);
  assert.deepEqual(cands.map((c) => c.id), ['u2', 'u3'], 'u1 is linked already');
  assert.equal(cands[0].badge, 'Same email');
});

test('suggested pairs dedupe two FbTime people pointing at one member', () => {
  // Both would target the same {organizationId,userId} unique index; the second
  // would 409. Counting it beats surfacing a confusing failure.
  const { rows } = buildRosterRows({
    people: [person('p1'), person('p2')],
    members: [member('u1')],
    suggestions: [
      { fbtimePersonId: 'p1', userId: 'u1' },
      { fbtimePersonId: 'p2', userId: 'u1' },
    ],
    campaigns: CAMPAIGNS,
  });
  const { pairs, skippedConflicts } = suggestedPairs(rows);
  assert.equal(pairs.length, 1);
  assert.equal(skippedConflicts, 1);
  assert.equal(pairs[0].userName, 'First U1', 'the pair names both sides for review');
});

test('recent projects attach per person and never block a row from rendering', () => {
  const { rows } = buildRosterRows({
    people: [person('p1', { linkedUserId: 'u1' }), person('p2')],
    members: [member('u1', { campaignIds: ['c1'] })],
    campaigns: CAMPAIGNS,
    projects: [{ fbtimePersonId: 'p1', lastShiftAt: '2026-09-01T12:00:00Z', projects: [{ id: 'x', name: 'Ward 5 Field', lastAt: '2026-09-01T12:00:00Z', shifts: 3 }] }],
  });
  const pair = rows.find((r) => r.fbtimePersonId === 'p1');
  const bare = rows.find((r) => r.fbtimePersonId === 'p2');
  assert.equal(pair.fbtimeProjects[0].name, 'Ward 5 Field');
  assert.deepEqual(bare.fbtimeProjects, [], 'a person with no projects payload is empty, not broken');
  assert.ok(pair.searchText.includes('ward 5 field'), 'project names are searchable');
});

// ── Door counts: the two halves of a Broken link, kept accounts, and clears ─────

test('fbtime-gone and member-gone are separate chips — the two halves of a Broken link', () => {
  // The FbTime person left FbTime, the member is still here: unlinking is the fix.
  // Before this, every orphan row was chipped "No longer in this organization",
  // which was false for exactly this row.
  const { rows } = buildRosterRows({
    people: [person('p2', { linkedUserId: 'gone' })],
    members: [member('u1')],
    orphanLinks: [{ fbtimePersonId: 'p9', userId: 'u1', fbtimeName: 'Gone Person', source: 'manual' }],
    campaigns: CAMPAIGNS,
  });
  const fbGone = rows.find((r) => r.fbtimePersonId === 'p9');
  assert.equal(fbGone.kind, 'orphan');
  assert.ok(fbGone.flags.includes('fbtime-gone'));
  assert.ok(!fbGone.flags.includes('member-gone'), 'the member is still here');
  assert.ok(!fbGone.flags.includes('fbtime-inactive'), 'gone outranks inactive');
  assert.equal(fbGone.status, 'orphan', 'still a Broken link');

  // The member left, the FbTime person is still in FbTime: usually leave it linked.
  const memberGone = rows.find((r) => r.fbtimePersonId === 'p2');
  assert.ok(memberGone.flags.includes('member-gone'));
  assert.ok(!memberGone.flags.includes('fbtime-gone'));
  assert.equal(memberGone.name, 'Former member');

  // Both at once.
  const both = buildRosterRows({
    members: [],
    orphanLinks: [{ fbtimePersonId: 'p9', userId: 'gone', fbtimeName: 'Gone Person' }],
    campaigns: CAMPAIGNS,
  }).rows[0];
  assert.deepEqual(
    both.flags.filter((f) => f.endsWith('-gone')).sort(),
    ['fbtime-gone', 'member-gone']
  );
});

test('door-count fields ride every person and orphan link, and default to nothing', () => {
  const kept = { userId: 'u9', name: 'Maria Old', deleted: true, until: '2026-09-01T00:00:00Z' };
  const { rows } = buildRosterRows({
    people: [
      person('p1', { linkedUserId: 'u1', doorsSent: true, alsoCounts: [kept] }),
      person('p2', { doorsSent: true, canClearSent: true }),
      person('p3', { doorsSent: true, clearWaiting: true }),
      person('p4'),
    ],
    members: [member('u1'), member('u2'), member('u3')],
    orphanLinks: [{ fbtimePersonId: 'p8', userId: 'u2', fbtimeName: 'Off Roster', doorsSent: true }],
    campaigns: CAMPAIGNS,
  });
  const by = (pid) => rows.find((r) => r.fbtimePersonId === pid);

  assert.deepEqual(by('p1').alsoCounts, [kept], 'also counts: the kept earlier account, as the server sent it');
  assert.equal(by('p1').doorsSent, true);
  assert.equal(by('p1').canClearSent, false, 'linked now — its clear is Unlink → No');

  assert.equal(by('p2').canClearSent, true, 'sent, not linked now, no clear waiting');
  assert.equal(by('p2').kind, 'needs-link');

  assert.equal(by('p3').clearWaiting, true);
  assert.ok(by('p3').flags.includes('clear-waiting'), 'shown as "Clear waiting"');
  assert.equal(by('p3').canClearSent, false, 'never offered twice');

  assert.equal(by('p8').doorsSent, true, 'an orphan link carries them too');

  // An older server sends none of these: nothing sent, nothing kept, nothing to clear.
  const doorlineOnly = rows.find((x) => x.kind === 'no-fbtime');
  assert.ok(doorlineOnly, 'u3 has no FbTime side');
  for (const r of [by('p4'), doorlineOnly]) {
    assert.equal(r.doorsSent, false);
    assert.equal(r.canClearSent, false);
    assert.equal(r.clearWaiting, false);
    assert.deepEqual(r.alsoCounts, []);
  }
});

test('a kept earlier account is chipped on its own Doorline row, not left reading "No FbTime person"', () => {
  const { rows } = buildRosterRows({
    people: [],
    members: [member('u1', { fbtime: { linked: true, kept: true, personName: 'Maria D.' } }), member('u2')],
    campaigns: CAMPAIGNS,
  });
  const keptRow = rows.find((r) => r.userId === 'u1');
  assert.equal(keptRow.kind, 'no-fbtime');
  assert.ok(keptRow.flags.includes('kept-account'));
  assert.ok(!rows.find((r) => r.userId === 'u2').flags.includes('kept-account'));
});

test('the people route’s own "deleted" marks the row deleted even before the member list catches up', () => {
  const { rows } = buildRosterRows({
    people: [person('p1', { linkedUserId: 'u1', deleted: true }), person('p2', { linkedUserId: 'gone', deleted: true })],
    members: [member('u1')],
    campaigns: CAMPAIGNS,
  });
  assert.equal(rows.find((r) => r.fbtimePersonId === 'p1').memberDeleted, true);
  const gone = rows.find((r) => r.fbtimePersonId === 'p2');
  assert.equal(gone.memberDeleted, true);
  assert.equal(gone.memberGone, true);
});

test('Unlink asks "Was the link right?" only when the answer changes something', () => {
  const { rows } = buildRosterRows({
    people: [
      person('p1', { linkedUserId: 'u1', doorsSent: true }),
      person('p2', { linkedUserId: 'u2' }),
      person('p3', { linkedUserId: 'u3' }),
      person('p4', { linkedUserId: 'gone' }),
    ],
    members: [
      member('u1'),
      member('u2'),
      member('u3', { isActive: false, user: { isDeleted: true, firstName: 'Deleted', lastName: 'user' } }),
    ],
    campaigns: CAMPAIGNS,
  });
  const by = (pid) => rows.find((r) => r.fbtimePersonId === pid);

  assert.equal(asksLinkQuestion(by('p1')), true, 'door counts sent for the person');
  assert.equal(asksLinkQuestion(by('p2')), false, 'neither: a plain unlink, and must be SENT plain');
  assert.equal(asksLinkQuestion(by('p3')), true, 'a deleted account — keeping it keeps its hours its own');
  assert.equal(asksLinkQuestion(by('p4')), false, 'a member who left, nothing sent: plain');

  assert.equal(cantRelink(by('p3')), true, 'deleted');
  assert.equal(cantRelink(by('p4')), true, 'left the organization');
  assert.equal(cantRelink(by('p2')), false);

  const all = unlinkQuestion([by('p1'), by('p2'), by('p3'), by('p4')]);
  assert.deepEqual(all, { ask: true, withDoors: 1, deleted: 1, cantRelink: 2, plain: 2 });
  assert.equal(unlinkQuestion([by('p2'), by('p4')]).ask, false, 'the inline confirm keeps selections with neither');
});
