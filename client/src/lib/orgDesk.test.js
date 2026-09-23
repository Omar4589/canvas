import { test } from 'node:test';
import assert from 'node:assert';
import { formatDate } from './dates.js';
import {
  buildDeskRows,
  rowMoney,
  deskCounts,
  filterDeskRows,
  sortDeskRows,
  parseDeskParams,
  deskParams,
  atRiskLabel,
  atRiskTab,
  CHIPS,
} from './orgDesk.js';

// What an operator SEES on the desk. These rules decide whether an unpaid invoice is visible at
// all, so they are worth more than the rendering that follows them.

const org = (over = {}) => ({
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  isActive: true,
  isInternal: false,
  createdAt: '2026-01-05T00:00:00Z',
  memberCount: 4,
  campaignsActive: 2,
  campaignsArchived: 1,
  billing: { status: 'active', effective: 'active', trialEndsAt: null, trialDaysLeft: null, banner: null },
  ...over,
});

const invoicing = (over = {}) => ({
  billingSince: '2026-02',
  running: { totalCents: 30000 },
  awaiting: { months: [], totalCents: 0 },
  outstanding: { count: 0, totalCents: 0, oldestDueAt: null },
  overdue: { count: 0, totalCents: 0, maxDaysOverdue: 0, oldestDueAt: null },
  drifting: [],
  ...over,
});

const rollupRow = (id, over = {}) => ({
  organizationId: id,
  rateCents: 30000,
  paymentTermsDays: 30,
  nextAction: 'none',
  invoicing: invoicing(),
  ...over,
});

// ---- joining -----------------------------------------------------------------

test('rows join the three payloads and keep deleting orgs separate', () => {
  const { rows, deleting } = buildDeskRows({
    organizations: [org(), org({ id: 'o2', name: 'Beta' })],
    deletingOrganizations: [{ id: 'o3', name: 'Doomed', slug: 'doomed', deletionStatus: 'failed', deletionError: 'boom' }],
    rollup: { organizations: [rollupRow('o1')] },
    atRisk: { items: [{ organizationId: 'o2', type: 'idle', monthsIdle: 4 }] },
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(deleting.length, 1, 'a mid-delete tenant is never an ordinary row');
  assert.strictEqual(deleting[0].deleting.status, 'failed');
  assert.strictEqual(rows[0].pending, false, 'o1 has its rollup');
  assert.strictEqual(rows[1].pending, true, 'o2 is still waiting on the walk');
  assert.strictEqual(rows[1].atRisk[0].type, 'idle');
});

test('rowMoney reads the cheap block until the rollup lands, then the full one', () => {
  const pendingRow = buildDeskRows({
    organizations: [org({ invoicing: { outstandingCount: 2, outstandingCents: 60000, overdueCount: 1, overdueCents: 30000, maxDaysOverdue: 12, oldestDueAt: '2026-08-01T00:00:00Z', lastPaidAt: null } })],
  }).rows[0];
  const m = rowMoney(pendingRow);
  assert.strictEqual(m.overdueCount, 1, 'the chase signal paints before the expensive walk');
  assert.strictEqual(m.overdueCents, 30000);
  assert.strictEqual(m.complete, false, 'but the awaiting backlog is not known yet');
  assert.strictEqual(m.awaitingMonths, 0);

  const fullRow = buildDeskRows({
    organizations: [org()],
    rollup: { organizations: [rollupRow('o1', { invoicing: invoicing({ awaiting: { months: [{ month: '2026-08', totalCents: 60000 }], totalCents: 60000 } }) })] },
  }).rows[0];
  const m2 = rowMoney(fullRow);
  assert.strictEqual(m2.complete, true);
  assert.strictEqual(m2.awaitingMonths, 1);
});

// ---- chips -------------------------------------------------------------------

test('chip counts key on the right fact, and a $0 org is not "needs invoice"', () => {
  const { rows } = buildDeskRows({
    organizations: [
      org({ id: 'a', name: 'Owed' }),
      org({ id: 'b', name: 'Clean' }),
      org({ id: 'c', name: 'Expired', billing: { status: 'trial', effective: 'suspended', banner: 'trial_expired' } }),
      org({ id: 'd', name: 'Suspended', billing: { status: 'suspended', effective: 'suspended', banner: 'suspended' } }),
    ],
    rollup: {
      organizations: [
        rollupRow('a', { invoicing: invoicing({ awaiting: { months: [{ month: '2026-08', totalCents: 60000 }], totalCents: 60000 } }) }),
        // A closed $0 month produces NO awaiting entry — the single easiest way this feature
        // could have lied is by calling every unissued month a backlog.
        rollupRow('b', { invoicing: invoicing({ awaiting: { months: [], totalCents: 0 } }) }),
        rollupRow('c'),
        rollupRow('d'),
      ],
    },
  });
  const counts = deskCounts(rows);
  assert.strictEqual(counts.needsInvoice, 1, 'only the org with a non-zero closed month');
  assert.strictEqual(counts.trialExpired, 1, 'an expired trial is its own chip');
  assert.strictEqual(
    counts.suspended,
    2,
    'both read effective suspended — which is exactly why Trial expired exists as a separate chip'
  );
  assert.strictEqual(counts.all, 4);
});

test('a chip never counts a row the table would hide', () => {
  // The number on a chip is a promise about what clicking it shows. Counting unfiltered rows meant
  // "Trial expired 1" could open onto "No organizations match".
  const { rows } = buildDeskRows({
    organizations: [
      org({ id: 'hidden', name: 'Lapsed', isActive: false, billing: { status: 'trial', effective: 'suspended', banner: 'trial_expired' } }),
      org({ id: 'shown', name: 'Live' }),
      org({ id: 'demo', name: 'Demo', isInternal: true, billing: { status: 'trial', effective: 'suspended', banner: 'trial_expired' } }),
    ],
  });
  const counts = deskCounts(rows);
  assert.strictEqual(counts.trialExpired, 0, 'both expired rows are hidden by the default toggles');
  assert.strictEqual(filterDeskRows(rows, { chip: 'trialExpired' }).length, 0, 'and the table agrees');

  const withHidden = deskCounts(rows, { showInternal: true, showInactive: true });
  assert.strictEqual(withHidden.trialExpired, 2);
  assert.strictEqual(
    filterDeskRows(rows, { chip: 'trialExpired', showInternal: true, showInactive: true }).length,
    2,
    'and still agrees once they are revealed'
  );
});

test('every chip has a label and a matcher', () => {
  for (const c of CHIPS) {
    assert.ok(c.key && c.label && typeof c.match === 'function', `${c.key} is complete`);
  }
});

// ---- filtering ---------------------------------------------------------------

test('internal orgs are hidden by default and shown on request', () => {
  const { rows } = buildDeskRows({ organizations: [org(), org({ id: 'i', name: 'Demo', isInternal: true })] });
  assert.strictEqual(filterDeskRows(rows, {}).length, 1);
  assert.strictEqual(filterDeskRows(rows, { showInternal: true }).length, 2);
});

test('an inactive org carrying MONEY is never hidden by the inactive toggle', () => {
  const { rows } = buildDeskRows({
    organizations: [
      org({ id: 'quiet', name: 'Quiet', isActive: false }),
      org({ id: 'owes', name: 'Owes', isActive: false, invoicing: { outstandingCount: 1, outstandingCents: 30000, overdueCount: 1, overdueCents: 30000, maxDaysOverdue: 40, oldestDueAt: null, lastPaidAt: null } }),
    ],
  });
  const visible = filterDeskRows(rows, {}).map((r) => r.name);
  assert.deepStrictEqual(visible, ['Owes'], 'switching off sign-in does not settle an invoice');
  assert.strictEqual(filterDeskRows(rows, { showInactive: true }).length, 2);
});

test('search matches name and slug', () => {
  const { rows } = buildDeskRows({ organizations: [org(), org({ id: 'o2', name: 'Bright PAC', slug: 'bright-pac' })] });
  assert.deepStrictEqual(filterDeskRows(rows, { q: 'bright' }).map((r) => r.id), ['o2']);
  assert.deepStrictEqual(filterDeskRows(rows, { q: 'BRIGHT-PAC' }).map((r) => r.id), ['o2'], 'case-insensitive on the slug too');
  assert.strictEqual(filterDeskRows(rows, { q: 'nothing' }).length, 0);
});

// ---- sorting -----------------------------------------------------------------

test('the default order is the work, most urgent first', () => {
  const { rows } = buildDeskRows({
    organizations: [
      org({ id: 'a', name: 'Await' }),
      org({ id: 'b', name: 'Chase big' }),
      org({ id: 'c', name: 'Chase small' }),
      org({ id: 'd', name: 'Trial' }),
      org({ id: 'e', name: 'Issue' }),
      org({ id: 'f', name: 'Nothing' }),
    ],
    rollup: {
      organizations: [
        rollupRow('a', { nextAction: 'await_payment' }),
        rollupRow('b', { nextAction: 'chase', invoicing: invoicing({ overdue: { count: 1, totalCents: 90000, maxDaysOverdue: 5 } }) }),
        rollupRow('c', { nextAction: 'chase', invoicing: invoicing({ overdue: { count: 1, totalCents: 30000, maxDaysOverdue: 5 } }) }),
        rollupRow('d', { nextAction: 'rescue_trial' }),
        rollupRow('e', { nextAction: 'issue' }),
        rollupRow('f', { nextAction: 'none' }),
      ],
    },
  });
  const order = sortDeskRows(rows).map((r) => r.name);
  // await_payment ranks above none: "we sent it, waiting" is still an open thread; "nothing to
  // do" genuinely is not.
  assert.deepStrictEqual(order, ['Chase big', 'Chase small', 'Trial', 'Issue', 'Await', 'Nothing']);
});

test('nulls sink in BOTH directions', () => {
  const { rows } = buildDeskRows({
    organizations: [org({ id: 'a', name: 'Has trial', billing: { effective: 'trial', trialEndsAt: '2026-10-01T00:00:00Z' } }), org({ id: 'b', name: 'No trial' })],
  });
  assert.deepStrictEqual(sortDeskRows(rows, 'trialEnds', 'asc').map((r) => r.name), ['Has trial', 'No trial']);
  assert.deepStrictEqual(
    sortDeskRows(rows, 'trialEnds', 'desc').map((r) => r.name),
    ['Has trial', 'No trial'],
    'an unknown value is not "the smallest" — flipping the sort must not parade unknowns to the top'
  );
});

test('sorting by name works in both directions', () => {
  const { rows } = buildDeskRows({ organizations: [org({ id: 'z', name: 'Zeta' }), org({ id: 'a', name: 'Alpha' })] });
  assert.deepStrictEqual(sortDeskRows(rows, 'name', 'asc').map((r) => r.name), ['Alpha', 'Zeta']);
  assert.deepStrictEqual(sortDeskRows(rows, 'name', 'desc').map((r) => r.name), ['Zeta', 'Alpha']);
});

// ---- the URL -----------------------------------------------------------------

test('desk params round-trip through the URL, rejecting garbage', () => {
  const sp = new URLSearchParams({ chip: 'overdue', q: 'acme', sort: 'awaiting', dir: 'asc' });
  assert.deepStrictEqual(parseDeskParams(sp), { chip: 'overdue', q: 'acme', sort: 'awaiting', dir: 'asc' });

  const bad = new URLSearchParams({ chip: 'nonsense', sort: 'nonsense', dir: 'sideways' });
  assert.deepStrictEqual(parseDeskParams(bad), { chip: 'all', q: '', sort: 'desk', dir: 'desc' });

  assert.deepStrictEqual(deskParams({ chip: 'all', q: '', sort: 'desk' }), {}, 'defaults leave the URL clean');
  assert.deepStrictEqual(deskParams({ chip: 'overdue', q: 'x', sort: 'name', dir: 'asc' }), {
    chip: 'overdue', q: 'x', sort: 'name', dir: 'asc',
  });
});

// ---- the strip ---------------------------------------------------------------

test('every at-risk type says something human, including the new overdue one', () => {
  assert.strictEqual(atRiskLabel({ type: 'trial_expiring', trialDaysLeft: 3 }), 'trial ends in 3d');
  assert.strictEqual(atRiskLabel({ type: 'trial_expiring', trialDaysLeft: 0 }), 'trial expired');
  assert.match(atRiskLabel({ type: 'past_due', since: '2026-08-01T00:00:00Z' }), /^past due since /);
  assert.match(atRiskLabel({ type: 'wind_down', windDownEndsAt: '2026-11-01T00:00:00Z' }), /deletes /);
  assert.strictEqual(atRiskLabel({ type: 'idle', monthsIdle: 5 }), 'idle 5 mo at $0');
  // Compared against formatDate itself rather than a pinned string: these render in the reader's
  // LOCAL timezone, so a hard-coded date would pass in one zone and fail in another.
  assert.strictEqual(
    atRiskLabel({ type: 'invoice_overdue', count: 2, totalCents: 60000, oldestDueAt: '2026-08-01T00:00:00Z' }),
    `$600 overdue since ${formatDate('2026-08-01T00:00:00Z')}`
  );
  assert.strictEqual(atRiskLabel({ type: 'some_future_type' }), 'some future type', 'a new type degrades, never shows a raw key');
});

test('an at-risk item points at the tab that fixes it', () => {
  assert.strictEqual(atRiskTab({ type: 'invoice_overdue' }), 'statements');
  assert.strictEqual(atRiskTab({ type: 'trial_expiring' }), 'account');
});
