import { NEXT_ACTION_RANK } from './invoicing.js';
import { fmtUsd } from './money.js';
import { formatDate } from './dates.js';

// THE DESK'S DATA LAYER — every join, filter, sort and count the Organizations page does, as pure
// functions over the three payloads it already fetches.
//
// It lives here rather than in the page for the reason fbtimeRoster.js does: the rules that decide
// what an operator SEES (which rows are hidden, which chip counts what, what "needs invoice" means)
// are exactly the rules worth pinning with tests, and they are impossible to test inside 700 lines
// of JSX. The page becomes rendering.

// ---- joining -----------------------------------------------------------------

// The list route answers instantly; the rollup is a walk per org and lands later. Rows therefore
// arrive in two phases and must render usefully in both — `pending` says which half is missing.
export const buildDeskRows = ({ organizations = [], deletingOrganizations = [], rollup, atRisk } = {}) => {
  const rollupById = new Map((rollup?.organizations || []).map((r) => [String(r.organizationId), r]));
  const atRiskById = new Map();
  for (const item of atRisk?.items || []) {
    const id = String(item.organizationId);
    if (!atRiskById.has(id)) atRiskById.set(id, []);
    atRiskById.get(id).push(item);
  }

  const rows = organizations.map((o) => {
    const money = rollupById.get(String(o.id)) || null;
    return {
      id: String(o.id),
      name: o.name,
      slug: o.slug,
      isActive: o.isActive,
      isInternal: Boolean(o.isInternal),
      createdAt: o.createdAt,
      memberCount: o.memberCount,
      campaignsActive: o.campaignsActive,
      campaignsArchived: o.campaignsArchived,
      billing: o.billing || {},
      // The full picture when the rollup has landed; otherwise the list's own cheap block, which
      // already carries the chase signal. Overdue must not wait on the expensive walk.
      invoicing: money?.invoicing || null,
      cheap: o.invoicing || null,
      rateCents: money?.rateCents ?? null,
      paymentTermsDays: money?.paymentTermsDays ?? null,
      nextAction: money?.nextAction || null,
      atRisk: atRiskById.get(String(o.id)) || [],
      pending: !money,
      deleting: null,
    };
  });

  // Mid-delete tenants render inert, with Retry as the only action. They arrive in their own array
  // precisely so every other consumer treats them as gone.
  const deleting = deletingOrganizations.map((o) => ({
    id: String(o.id),
    name: o.name,
    slug: o.slug,
    isActive: o.isActive,
    isInternal: Boolean(o.isInternal),
    billing: o.billing || {},
    invoicing: null,
    cheap: null,
    atRisk: [],
    pending: false,
    deleting: {
      status: o.deletionStatus || 'pending',
      error: o.deletionError || null,
      source: o.deletionSource || null,
    },
  }));

  return { rows, deleting };
};

// The money figures a row can show, from whichever source has landed. One place, so the desk
// cannot read `invoicing.overdue` in one cell and `cheap.overdueCents` in another.
export const rowMoney = (row) => {
  const inv = row?.invoicing;
  if (inv) {
    return {
      awaitingCents: inv.awaiting?.totalCents || 0,
      awaitingMonths: inv.awaiting?.months?.length || 0,
      awaitingList: inv.awaiting?.months || [],
      outstandingCents: inv.outstanding?.totalCents || 0,
      outstandingCount: inv.outstanding?.count || 0,
      overdueCents: inv.overdue?.totalCents || 0,
      overdueCount: inv.overdue?.count || 0,
      maxDaysOverdue: inv.overdue?.maxDaysOverdue || 0,
      oldestDueAt: inv.overdue?.oldestDueAt || inv.outstanding?.oldestDueAt || null,
      runningCents: inv.running?.totalCents || 0,
      billingSince: inv.billingSince || null,
      complete: true,
    };
  }
  const c = row?.cheap;
  if (c) {
    return {
      awaitingCents: 0,
      awaitingMonths: 0,
      awaitingList: [],
      outstandingCents: c.outstandingCents || 0,
      outstandingCount: c.outstandingCount || 0,
      overdueCents: c.overdueCents || 0,
      overdueCount: c.overdueCount || 0,
      maxDaysOverdue: c.maxDaysOverdue || 0,
      oldestDueAt: c.oldestDueAt || null,
      runningCents: 0,
      billingSince: null,
      // The awaiting backlog needs the recompute; only the chase signal is known this early.
      complete: false,
    };
  }
  return {
    awaitingCents: 0, awaitingMonths: 0, awaitingList: [], outstandingCents: 0, outstandingCount: 0,
    overdueCents: 0, overdueCount: 0, maxDaysOverdue: 0, oldestDueAt: null, runningCents: 0,
    billingSince: null, complete: false,
  };
};

// ---- chips -------------------------------------------------------------------

const hasAtRisk = (row, type) => row.atRisk.some((i) => i.type === type);

export const CHIPS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'needsInvoice', label: 'Needs invoice', needsRollup: true, match: (r) => rowMoney(r).awaitingMonths > 0 },
  { key: 'overdue', label: 'Overdue', match: (r) => rowMoney(r).overdueCount > 0 },
  { key: 'outstanding', label: 'Outstanding', match: (r) => rowMoney(r).outstandingCount > 0 },
  { key: 'drifting', label: 'Drifting', needsRollup: true, match: (r) => (r.invoicing?.drifting?.length || 0) > 0 },
  { key: 'trialEnding', label: 'Trial ending', match: (r) => hasAtRisk(r, 'trial_expiring') },
  {
    key: 'trialExpired',
    label: 'Trial expired',
    match: (r) => r.billing?.banner === 'trial_expired' || (r.billing?.status === 'trial' && r.billing?.effective === 'suspended'),
  },
  { key: 'pastDue', label: 'Past due', match: (r) => r.billing?.effective === 'past_due' },
  { key: 'suspended', label: 'Suspended', match: (r) => r.billing?.effective === 'suspended' },
  { key: 'windDown', label: 'Wind-down', match: (r) => r.billing?.effective === 'canceled' },
  { key: 'idle', label: 'Idle', match: (r) => hasAtRisk(r, 'idle') },
  { key: 'notStarted', label: 'Not started', needsRollup: true, match: (r) => r.invoicing && !r.invoicing.billingSince },
];

// Counted through the SAME visibility rules the table applies, so a chip can never say 1 and the
// table answer "No organizations match". The chip is a promise about what clicking it shows.
export const deskCounts = (rows, { showInternal = false, showInactive = false } = {}) => {
  const visible = rows.filter((r) => visibleUnderToggles(r, { showInternal, showInactive }));
  const out = {};
  for (const chip of CHIPS) out[chip.key] = visible.filter(chip.match).length;
  return out;
};

// ---- filtering ---------------------------------------------------------------

// The two visibility toggles, as one rule both the counter and the table read.
export const visibleUnderToggles = (r, { showInternal = false, showInactive = false } = {}) => {
  if (!showInternal && r.isInternal) return false;
  if (!showInactive && !r.isActive) {
    // A row carrying MONEY is never hidden by the inactive toggle. Deactivating an org switches
    // off sign-in; it does not settle an invoice, and an unpaid balance you cannot see is an
    // unpaid balance you will not chase.
    const m = rowMoney(r);
    if (m.outstandingCount === 0 && m.overdueCount === 0 && m.awaitingMonths === 0) return false;
  }
  return true;
};

export const filterDeskRows = (rows, { chip = 'all', q = '', showInternal = false, showInactive = false } = {}) => {
  const chipDef = CHIPS.find((c) => c.key === chip) || CHIPS[0];
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (!chipDef.match(r)) return false;
    if (!visibleUnderToggles(r, { showInternal, showInactive })) return false;
    if (needle) {
      const hay = `${r.name || ''} ${r.slug || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
};

// ---- sorting -----------------------------------------------------------------

// Nulls sink in BOTH directions. A row with no value is not "the smallest" — it is unknown, and
// flipping the sort must not parade unknowns to the top (the fbtimeRoster lesson).
const cmp = (a, b, dir) => {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a === b) return 0;
  return (a < b ? -1 : 1) * (dir === 'asc' ? 1 : -1);
};

export const DESK_SORTS = {
  desk: null, // the default comparator below
  name: (r) => String(r.name || '').toLowerCase(),
  created: (r) => (r.createdAt ? new Date(r.createdAt).getTime() : null),
  trialEnds: (r) => (r.billing?.trialEndsAt ? new Date(r.billing.trialEndsAt).getTime() : null),
  running: (r) => (r.pending ? null : rowMoney(r).runningCents),
  awaiting: (r) => (rowMoney(r).complete ? rowMoney(r).awaitingCents : null),
  outstanding: (r) => rowMoney(r).outstandingCents || null,
  overdueDays: (r) => rowMoney(r).maxDaysOverdue || null,
  billingSince: (r) => rowMoney(r).billingSince,
};

// What the desk opens on: the work, in the order it should be done. Rank first (chase before
// rescue before issue), then the size of the money, then name so the order is stable.
export const deskOrder = (a, b) => {
  const ra = NEXT_ACTION_RANK[a.nextAction] ?? NEXT_ACTION_RANK.none;
  const rb = NEXT_ACTION_RANK[b.nextAction] ?? NEXT_ACTION_RANK.none;
  if (ra !== rb) return ra - rb;
  const ma = rowMoney(a);
  const mb = rowMoney(b);
  if (mb.overdueCents !== ma.overdueCents) return mb.overdueCents - ma.overdueCents;
  if (mb.awaitingCents !== ma.awaitingCents) return mb.awaitingCents - ma.awaitingCents;
  return String(a.name || '').localeCompare(String(b.name || ''));
};

export const sortDeskRows = (rows, key = 'desk', dir = 'desc') => {
  const out = [...rows];
  if (key === 'desk' || !DESK_SORTS[key]) {
    out.sort(deskOrder);
    return out;
  }
  const pick = DESK_SORTS[key];
  out.sort((a, b) => cmp(pick(a), pick(b), dir));
  return out;
};

// ---- the URL -----------------------------------------------------------------

// Chip, search and sort live in the URL so a filtered desk is bookmarkable and Back restores it.
// The two visibility toggles do NOT: they are per-viewer preferences, not a view worth sharing.
export const parseDeskParams = (searchParams) => {
  const chip = searchParams.get('chip');
  const sort = searchParams.get('sort');
  return {
    chip: CHIPS.some((c) => c.key === chip) ? chip : 'all',
    q: searchParams.get('q') || '',
    sort: sort && (sort === 'desk' || DESK_SORTS[sort]) ? sort : 'desk',
    dir: searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
  };
};

export const deskParams = ({ chip, q, sort, dir }) => {
  const p = {};
  if (chip && chip !== 'all') p.chip = chip;
  if (q) p.q = q;
  if (sort && sort !== 'desk') {
    p.sort = sort;
    p.dir = dir === 'asc' ? 'asc' : 'desc';
  }
  return p;
};

export const pageSlice = (rows, skip, limit) => rows.slice(skip, skip + limit);

// ---- the needs-attention strip -----------------------------------------------

// One line per at-risk item. The server (organizations.js /at-risk) owns the definitions; this
// only says them. Shared with the Control Room so the same item can never read two ways.
export const atRiskLabel = (it) => {
  switch (it.type) {
    case 'trial_expiring':
      return it.trialDaysLeft === 0 ? 'trial expired' : `trial ends in ${it.trialDaysLeft}d`;
    case 'past_due':
      return `past due since ${formatDate(it.since)}`;
    case 'suspended':
      return `suspended since ${formatDate(it.since)}`;
    case 'wind_down':
      return `canceled — deletes ${formatDate(it.windDownEndsAt)}`;
    case 'idle':
      return `idle ${it.monthsIdle} mo at $0`;
    case 'invoice_overdue':
      return `${fmtUsd(it.totalCents)} overdue since ${formatDate(it.oldestDueAt)}`;
    default:
      return String(it.type || '').replace(/_/g, ' ');
  }
};

// Which tab an at-risk item wants you on.
export const atRiskTab = (it) => (it.type === 'invoice_overdue' ? 'statements' : 'account');
