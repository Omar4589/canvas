import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_STEP,
  memberRow,
  campaignRows,
  inStatus,
  filterHubRows,
  crewOptions,
  sortHubRows,
  sortOptionsFor,
  rowBadge,
  pagingFor,
  pagingReducer,
  limitOf,
  pageOfRows,
  moveTargets,
  resendTargets,
  assignTargets,
} from './usersHub.js';

// The phone's Users hub (docs/PROPOSAL_PEOPLE_PAGES.md §G): rows, status pills, the Crew filter, the
// 50-row paging and who each "all shown" row acts on.

const member = (i, over = {}) => ({
  role: 'canvasser',
  isActive: true,
  addedAt: `2026-0${1 + (i % 9)}-01T00:00:00Z`,
  deletion: null,
  ...over,
  user: {
    id: `u${i}`,
    firstName: `First${i}`,
    lastName: `Last${String(i).padStart(3, '0')}`,
    email: `p${i}@t.co`,
    isActive: true,
    isDeleted: false,
    isSuperAdmin: false,
    lastLoginAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    ...(over.user || {}),
  },
});

const rosterRow = (i, over = {}) => ({
  userId: `u${i}`,
  firstName: `First${i}`,
  lastName: `Last${String(i).padStart(3, '0')}`,
  email: `p${i}@t.co`,
  status: 'active',
  isActive: true,
  isSuperAdmin: false,
  lastLoginAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  coordinatorName: null,
  ...over,
});

test('rows: an org member reads its standing; the campaign view keeps a roster row with no membership', () => {
  assert.equal(memberRow(member(1)).status, 'active');
  assert.equal(memberRow(member(2, { isActive: false })).status, 'deactivated');
  assert.equal(memberRow(member(3, { user: { isDeleted: true, isActive: false } })).status, 'deleted');

  const members = [member(1), member(2), member(3)];
  const roster = [
    rosterRow(1, { coordinatorId: 'c9', coordinatorName: 'Dana Cruz' }),
    rosterRow(7, { status: 'removed', firstName: 'Gone' }), // no longer in the org
  ];
  const { on, off } = campaignRows(members, roster);
  assert.deepEqual(on.map((r) => r.userId), ['u1', 'u7']);
  assert.equal(on[0].coordinatorName, 'Dana Cruz');
  assert.equal(on[0].addedAt, members[0].addedAt, 'the org member’s facts ride along');
  assert.equal(on[1].status, 'removed');
  assert.equal(on[1].inOrg, false);
  assert.deepEqual(off.map((r) => r.userId), ['u2', 'u3']);
  assert.ok(off.every((r) => !r.onCampaign && !r.coordinatorId));
});

test('status pills: Active is an account that is on and in the org; Paused and Never signed in are rosterView’s', () => {
  const paused = new Set(['u4']);
  const rows = [
    rosterRow(1),
    rosterRow(2, { status: 'deactivated' }),
    rosterRow(3, { status: 'deleted' }),
    rosterRow(4),
    rosterRow(5, { lastLoginAt: null, createdAt: '2026-07-01T00:00:00Z' }),
    rosterRow(6, { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }), // before sign-ins were recorded
    rosterRow(7, { status: 'removed' }),
  ];
  const ids = (status) => rows.filter((r) => inStatus(r, status, paused)).map((r) => r.userId);
  assert.deepEqual(ids('active'), ['u1', 'u4', 'u5', 'u6']);
  assert.deepEqual(ids('inactive'), ['u2', 'u3', 'u7']);
  assert.deepEqual(ids('paused'), ['u4']);
  assert.deepEqual(ids('never-signed-in'), ['u5']);
  assert.equal(ids('all').length, rows.length);
});

test('search matches every word in the name or email; a deleted row matches only its label', () => {
  const rows = [
    rosterRow(1, { firstName: 'Sam', lastName: 'Rivera', email: 'sam@x.co' }),
    rosterRow(2, { firstName: 'Deleted', lastName: 'user', email: 'deleted+u2@deleted.doorline.invalid', status: 'deleted' }),
  ];
  assert.deepEqual(filterHubRows(rows, { q: 'rivera sam' }).map((r) => r.userId), ['u1']);
  assert.deepEqual(filterHubRows(rows, { q: 'doorline' }).map((r) => r.userId), [], 'never the tombstone email');
  assert.deepEqual(filterHubRows(rows, { q: 'deleted account' }).map((r) => r.userId), ['u2']);
  assert.deepEqual(filterHubRows(rows, { role: 'lead' }), []);
});

test('the Crew sheet lists this roster’s crews A–Z then No crew, counting what the other filters leave', () => {
  const roster = [
    rosterRow(1, { coordinatorId: 'cy', coordinatorName: 'Yan Ortiz' }),
    rosterRow(2, { coordinatorId: 'cd', coordinatorName: 'Dana Cruz' }),
    rosterRow(3, { coordinatorId: 'cd', coordinatorName: 'Dana Cruz', role: 'lead' }),
    rosterRow(4),
  ];
  const canvassersOnly = filterHubRows(roster, { role: 'canvasser' });
  const opts = crewOptions(roster, canvassersOnly);
  assert.deepEqual(
    opts.map((o) => [o.key, o.label, o.count]),
    [
      ['all', 'All crews', 3],
      ['cd', 'Dana Cruz', 1],
      ['cy', 'Yan Ortiz', 1],
      ['none', 'No crew', 1],
    ]
  );
  for (const o of opts) {
    assert.equal(o.count, filterHubRows(roster, { role: 'canvasser', crew: o.key }).length, `${o.key}: the count equals the rows`);
  }
  // Everyone moved off Dana's crew while it was picked: it stays listed, at 0, so it can be cleared.
  const after = roster.map((r) => ({ ...r, coordinatorId: null, coordinatorName: null }));
  const kept = crewOptions(after, after, { key: 'cd', label: 'Dana Cruz' });
  assert.deepEqual(kept.find((o) => o.key === 'cd'), { key: 'cd', label: 'Dana Cruz', count: 0 });
});

test('sorts: Crew is offered only on a campaign and groups by coordinator, No crew last', () => {
  assert.ok(!sortOptionsFor(false).some((o) => o.key === 'crew'));
  assert.ok(sortOptionsFor(true).some((o) => o.key === 'crew'));
  const rows = [
    rosterRow(1, { lastName: 'Bell' }),
    rosterRow(2, { lastName: 'Able', coordinatorId: 'cy', coordinatorName: 'Yan' }),
    rosterRow(3, { lastName: 'Cole', coordinatorId: 'cd', coordinatorName: 'Dana' }),
  ];
  assert.deepEqual(sortHubRows(rows, 'crew').map((r) => r.userId), ['u3', 'u2', 'u1']);
  assert.deepEqual(sortHubRows(rows, 'name-asc').map((r) => r.userId), ['u2', 'u1', 'u3']);
  assert.deepEqual(sortHubRows(rows, 'name-desc').map((r) => r.userId), ['u3', 'u1', 'u2']);
  const dated = [rosterRow(1, { lastLoginAt: null }), rosterRow(2, { lastLoginAt: '2026-10-02T00:00:00Z' }), rosterRow(3)];
  assert.deepEqual(sortHubRows(dated, 'recent-signin').map((r) => r.userId), ['u2', 'u3', 'u1'], 'no date sorts last');
  assert.deepEqual(rows.map((r) => r.userId), ['u1', 'u2', 'u3'], 'a copy, never in place');
});

test('one badge, the most exceptional state', () => {
  const paused = new Set(['u4']);
  assert.equal(rowBadge(rosterRow(1, { status: 'deleted' }), paused).text, 'deleted');
  assert.equal(rowBadge(rosterRow(2, { status: 'removed' }), paused).text, 'not in org');
  assert.equal(rowBadge(rosterRow(3, { status: 'deactivated' }), paused).text, 'inactive');
  assert.equal(rowBadge(rosterRow(4), paused).text, 'paused');
  assert.deepEqual(rowBadge(rosterRow(5, { lastLoginAt: null }), paused), { text: 'never signed in', tone: 'warn' });
  assert.equal(rowBadge(rosterRow(6, { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }), paused), null);
  assert.equal(rowBadge(rosterRow(7), paused), null);
});

test('paging: 50 a section, Show 50 more adds 50, and new filters start every section at 50 again', () => {
  const rows = Array.from({ length: 123 }, (_, i) => rosterRow(i));
  let paging = pagingFor('k1');
  assert.equal(limitOf(paging, 'k1', 'on'), PAGE_STEP);
  let page = pageOfRows(rows, limitOf(paging, 'k1', 'on'));
  assert.equal(page.shown.length, 50);
  assert.equal(page.left, 73);
  assert.equal(page.next, 50);

  paging = pagingReducer(paging, { type: 'more', key: 'k1', section: 'on' });
  page = pageOfRows(rows, limitOf(paging, 'k1', 'on'));
  assert.deepEqual([page.shown.length, page.left, page.next], [100, 23, 23], 'the last step says how many are left');
  assert.equal(limitOf(paging, 'k1', 'off'), 50, 'each section pages on its own');

  paging = pagingReducer(paging, { type: 'more', key: 'k1', section: 'on' });
  page = pageOfRows(rows, limitOf(paging, 'k1', 'on'));
  assert.deepEqual([page.shown.length, page.left, page.next], [123, 0, 0]);

  // A new search or filter: the old state is never read, even before a reset lands.
  assert.equal(limitOf(paging, 'k2', 'on'), 50);
  paging = pagingReducer(paging, { type: 'more', key: 'k2', section: 'off' });
  assert.deepEqual(paging, { key: 'k2', limits: { off: 100 } });
  assert.equal(pagingReducer(paging, { type: 'reset', key: 'k2' }), paging, 'a reset to the same filters changes nothing');
  assert.deepEqual(pagingReducer(paging, { type: 'reset', key: 'k3' }), { key: 'k3', limits: {} });
  assert.deepEqual(pageOfRows([], 50), { shown: [], left: 0, next: 0 });
});

test('paging: going back to an earlier filter starts at 50 again, as the screen resets on every change', () => {
  // The screen dispatches a reset in render whenever the filters' key changes.
  const screen = (paging, key) => (paging.key === key ? paging : pagingReducer(paging, { type: 'reset', key }));
  let paging = pagingFor('all-status');
  paging = pagingReducer(paging, { type: 'more', key: 'all-status', section: 'on' });
  paging = pagingReducer(paging, { type: 'more', key: 'all-status', section: 'on' });
  assert.equal(limitOf(paging, 'all-status', 'on'), 150);
  paging = screen(paging, 'paused'); // tap Paused
  assert.equal(limitOf(paging, 'paused', 'on'), 50);
  paging = screen(paging, 'all-status'); // and back to All status
  assert.equal(limitOf(paging, 'all-status', 'on'), 50, 'not the 150 from before');
});

test('"all shown" counts only the rows on screen', () => {
  const paused = new Set();
  // 60 people on the campaign: 12 never signed in, of whom 3 are leads and 1 is Doorline staff.
  const onRows = Array.from({ length: 60 }, (_, i) =>
    rosterRow(i, {
      onCampaign: true,
      lastLoginAt: i % 5 === 0 ? null : '2026-10-01T00:00:00Z',
      role: i === 0 || i === 5 || i === 50 ? 'lead' : 'canvasser',
      isSuperAdmin: i === 10,
    })
  );
  const shownOn = pageOfRows(onRows, 50).shown; // the first 50 render
  assert.equal(moveTargets(shownOn).length, 50, 'Move all shown: everyone rendered, never the 10 below');
  // Rendered never-signed-in rows: i = 0,5,10,…,45 → 10; staff (10) is out → 9; a lead also drops the two leads (0, 5).
  assert.equal(resendTargets(shownOn, { pausedIds: paused }).length, 9);
  assert.equal(resendTargets(shownOn, { pausedIds: paused, lead: true }).length, 7);
  assert.ok(resendTargets(shownOn, { pausedIds: paused }).every((r) => shownOn.includes(r)));

  // A switched-off person never-signed-in isn't invited; neither is an older account with no sign-in on record.
  assert.equal(resendTargets([rosterRow(1, { lastLoginAt: null, status: 'deactivated' })]).length, 0);
  assert.equal(resendTargets([rosterRow(2, { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' })]).length, 0);

  const offRows = [
    { ...memberRow(member(1)) },
    { ...memberRow(member(2, { isActive: false })) },
    { ...memberRow(member(3, { user: { isDeleted: true, isActive: false } })) },
    { ...memberRow(member(4)) },
  ];
  const shownOff = pageOfRows(offRows, 3).shown;
  assert.deepEqual(assignTargets(shownOff).map((r) => r.userId), ['u1'], 'an account that is on, and only the rows rendered');
});
