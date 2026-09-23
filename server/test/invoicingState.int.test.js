import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// THE INVOICING VERDICT against a real mongod — services/billing/invoicing.js feeding
// invoicingState.js with facts it actually fetched.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/inv_test node --test test/invoicingState.int.test.js
//
// invoicingState.test.js owns the pure decisions. What this file proves is the part that can only
// be wrong against a database: that the window covers the months that matter, that "awaiting" is
// exactly the closed months with money and no statement, that a month's total here is byte-equal
// to what monthlyStatement says for that month, and that the corners (the floor, a $0 month, an
// internal org, an org with no subscription row) land where they should.
//
// Every date is FIXED. `now` is passed in explicitly, never read from the clock.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-invoicing';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SubscriptionEvent } = await import('../src/models/SubscriptionEvent.js');
const { Statement } = await import('../src/models/Statement.js');
const { orgInvoicing, canonicalWindow } = await import('../src/services/billing/invoicing.js');
const { monthlyStatement } = await import('../src/services/billing/statement.js');
const { DEFAULT_PAYMENT_TERMS_DAYS } = await import('../src/services/billing/invoicingState.js');
const { DEFAULT_RATE_CENTS } = await import('../src/services/billing/rate.js');
const { addMonths } = await import('../src/services/billing/billingMonths.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

// The fixture lives entirely in the past so no assertion here can drift as the calendar moves.
const NOW = new Date('2026-09-23T12:00:00Z');
const CURRENT_MONTH = '2026-09';
const ctx = {};
let seq = 0;

// An org whose creation month precedes every fact about it — the only shape production can make.
async function makeOrg(name, slug, { bornIso = '2025-10-01T00:00:00Z', internal = false, status = 'active', isActive = true } = {}) {
  const created = await Organization.create({ name, slug, isActive, ...(internal ? { isInternal: true } : {}) });
  // Raw write AND a re-read: Mongoose marks `createdAt` immutable when timestamps are on, so both
  // a model-level update and an in-memory assignment are silently dropped. Only the collection
  // write lands, and only a fresh read sees it — a lean object is what the service takes anyway.
  await Organization.collection.updateOne({ _id: created._id }, { $set: { createdAt: new Date(bornIso) } });
  if (status) {
    await Subscription.create({ organizationId: created._id, status, statusChangedAt: new Date(bornIso) });
  }
  return Organization.findById(created._id).lean();
}

async function makeCampaign(org, { tz = 'America/New_York', archivedAt = null } = {}) {
  seq += 1;
  return Campaign.create({
    organizationId: org._id,
    name: `Inv Camp ${seq}`,
    type: 'survey',
    state: 'KY',
    timeZone: tz,
    isActive: !archivedAt,
    archivedAt,
  });
}

async function visit(org, campaign, iso) {
  seq += 1;
  const hh = await Household.create({
    organizationId: org._id,
    campaignId: campaign._id,
    addressLine1: `${seq} Inv St`,
    city: 'Town',
    state: 'KY',
    zipCode: '40002',
    normalizedAddress: `${seq} INV ST|TOWN|KY|40002`,
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  return CanvassActivity.create({
    organizationId: org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: ctx.userId,
    actionType: 'not_home',
    timestamp: new Date(iso),
    location: { lat: 38.0, lng: -84.5 },
  });
}

async function issue(org, month, { issuedAt, dueAt, paidAt = null, totalCents, lines = [], ref = '' }) {
  return Statement.create({
    organizationId: org._id,
    month,
    status: 'issued',
    rateCents: DEFAULT_RATE_CENTS,
    rulesVersion: 3,
    totalCents,
    lines,
    issuedAt: new Date(issuedAt),
    dueAt: dueAt ? new Date(dueAt) : null,
    termsDays: dueAt ? DEFAULT_PAYMENT_TERMS_DAYS : null,
    paidAt: paidAt ? new Date(paidAt) : null,
    externalRef: ref,
  });
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Campaign, Household, CanvassActivity, Subscription, SubscriptionEvent, Statement]) {
    await M.deleteMany({});
  }
  await Statement.syncIndexes();
  const u = await User.create({ firstName: 'Ivy', lastName: 'Inv', email: 'inv@t.co', passwordHash: 'x', isActive: true });
  ctx.userId = u._id;

  // ── The main fixture: one org, four campaigns, covering every corner at once. ──
  const org = await makeOrg('Inv Org', 'inv-org');
  ctx.org = org;

  // A campaign canvassing since December — bills every month from then on.
  const steady = await makeCampaign(org);
  await visit(org, steady, '2025-12-05T15:00:00Z');
  await visit(org, steady, '2026-07-05T15:00:00Z');
  await visit(org, steady, '2026-08-05T15:00:00Z');
  await visit(org, steady, '2026-09-05T15:00:00Z');
  ctx.steady = steady;

  // A campaign that never went to the field — free forever, and must never make a month "awaiting".
  ctx.setupOnly = await makeCampaign(org);

  // Issued + PAID (June), issued + OVERDUE (July), issued within terms (August is left unissued).
  await issue(org, '2026-06', {
    issuedAt: '2026-07-01T00:00:00Z',
    dueAt: '2026-07-31T00:00:00Z',
    paidAt: '2026-07-20T00:00:00Z',
    totalCents: 30000,
    lines: [{ campaignId: steady._id, name: 'steady', billable: true, reason: 'billable', amountCents: 30000, rateCents: 30000 }],
    ref: 'INV-JUN',
  });
  await issue(org, '2026-07', {
    issuedAt: '2026-08-01T00:00:00Z',
    dueAt: '2026-08-31T00:00:00Z',
    totalCents: 30000,
    lines: [{ campaignId: steady._id, name: 'steady', billable: true, reason: 'billable', amountCents: 30000, rateCents: 30000 }],
    ref: 'INV-JUL',
  });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

// ---- the window --------------------------------------------------------------

test('the window starts at the org’s creation month, because activity cannot predate it', { skip }, async () => {
  const w = canonicalWindow(ctx.org, NOW);
  assert.strictEqual(w.from, '2025-10');
  assert.strictEqual(w.to, CURRENT_MONTH);
  assert.strictEqual(w.truncated, false, 'an org younger than the cap is scanned in full');
});

test('an org older than the cap truncates and says so', { skip }, async () => {
  const ancient = await makeOrg('Ancient', 'ancient-org', { bornIso: '2019-01-01T00:00:00Z' });
  const w = canonicalWindow(ancient, NOW);
  assert.strictEqual(w.from, '2023-10', '36 months back from 2026-09');
  assert.strictEqual(w.truncated, true, 'a silently narrowed window would be a wrong number wearing a right one’s clothes');
});

// ---- the headline verdicts ---------------------------------------------------

test('awaiting is exactly the closed months with money and no issued statement', { skip }, async () => {
  const { invoicing } = await orgInvoicing(ctx.org, { now: NOW });
  const awaiting = invoicing.awaiting.months.map((m) => m.month);

  assert.ok(awaiting.includes('2026-08'), 'August closed, owed, never invoiced');
  assert.ok(!awaiting.includes('2026-06'), 'June is paid');
  assert.ok(!awaiting.includes('2026-07'), 'July is issued');
  assert.ok(!awaiting.includes(CURRENT_MONTH), 'the running month has not finished');
  // Every month from the first knock (December) onward carries the steady campaign, so the only
  // $0 months are the ones before it — and those must be absent.
  assert.ok(!awaiting.includes('2025-10'), 'a month before any field visit owes nothing');
  assert.ok(!awaiting.includes('2025-11'));
  assert.ok(invoicing.awaiting.totalCents > 0);
});

test('a closed month with nothing to bill is "zero", never "awaiting"', { skip }, async () => {
  const { invoicing } = await orgInvoicing(ctx.org, { now: NOW });
  const byMonth = new Map(invoicing.monthStates.map((m) => [m.month, m.state]));
  assert.strictEqual(byMonth.get('2025-10'), 'zero', 'no campaign had been to the field yet');
  assert.strictEqual(byMonth.get('2025-11'), 'zero');
  assert.strictEqual(byMonth.get('2026-08'), 'awaiting');
  assert.strictEqual(byMonth.get('2026-07'), 'overdue', 'due 2026-08-31, unpaid on 2026-09-23');
  assert.strictEqual(byMonth.get('2026-06'), 'paid');
  assert.strictEqual(byMonth.get(CURRENT_MONTH), 'open');
});

test('outstanding and overdue read the FROZEN figure — what is owed is what was sent', { skip }, async () => {
  const { invoicing } = await orgInvoicing(ctx.org, { now: NOW });
  assert.strictEqual(invoicing.outstanding.count, 1, 'July only — June is paid, August was never sent');
  assert.strictEqual(invoicing.outstanding.totalCents, 30000);
  assert.strictEqual(invoicing.overdue.count, 1);
  assert.strictEqual(invoicing.overdue.totalCents, 30000);
  assert.strictEqual(new Date(invoicing.overdue.oldestDueAt).toISOString(), '2026-08-31T00:00:00.000Z');
  assert.strictEqual(invoicing.paid.count, 1);
  assert.strictEqual(invoicing.paid.totalCents, 30000);
  assert.strictEqual(new Date(invoicing.paid.lastPaidAt).toISOString(), '2026-07-20T00:00:00.000Z');
});

test('billing since is the first month that actually carried a billable line', { skip }, async () => {
  const { invoicing } = await orgInvoicing(ctx.org, { now: NOW });
  assert.strictEqual(invoicing.billingSince, '2025-12', 'the first knock was 2025-12-05');
  assert.strictEqual(new Date(invoicing.firstVisitAt).toISOString(), '2025-12-05T15:00:00.000Z');
});

// ---- the one-owner invariant -------------------------------------------------

test('every month in the window equals what monthlyStatement says for that month', { skip }, async () => {
  const state = await orgInvoicing(ctx.org, { now: NOW, includeLines: true });
  // This is THE invariant the whole feature rests on: the desk, the org page and an invoice must
  // be three views of one computation, never three computations.
  for (const row of state.rows) {
    if (row.issued) continue; // a frozen month is deliberately NOT the live recompute
    const single = await monthlyStatement(ctx.org._id, row.month);
    assert.strictEqual(row.totalCents, single.totalCents, `${row.month} total`);
    assert.strictEqual(
      row.lines.length,
      single.lines.length,
      `${row.month} line count`
    );
    assert.deepStrictEqual(
      row.lines.map((l) => [String(l.campaignId), l.billable, l.reason, l.amountCents]),
      single.lines.map((l) => [String(l.campaignId), l.billable, l.reason, l.amountCents]),
      `${row.month} lines`
    );
  }
});

test('the rollup’s legacy usage numbers survive the swap to a range walk', { skip }, async () => {
  const state = await orgInvoicing(ctx.org, { now: NOW });
  const single = await monthlyStatement(ctx.org._id, CURRENT_MONTH);
  assert.strictEqual(state.usage.totalCents, single.totalCents);
  assert.strictEqual(state.usage.rateCents, single.rateCents);
  assert.strictEqual(state.usage.billableCampaigns, single.lines.filter((l) => l.billable).length);
  assert.strictEqual(
    state.usage.setupCount,
    single.lines.filter((l) => l.reason === 'no-field-visit' && l.isActive).length
  );
});

// ---- the corners -------------------------------------------------------------

test('the floor corner: billing since names the month that billed, the campaign still says which month it starts from', { skip }, async () => {
  // First visit Oct 29 (start grace → bills from November), archived Nov 2 with nobody out in
  // November. The floor makes OCTOBER bill. billingStartMonth() says November — a month AFTER the
  // one that carried money — so the org-level date must read the line, not the campaign.
  const org = await makeOrg('Floor Org', 'floor-org', { bornIso: '2025-09-01T00:00:00Z' });
  const c = await makeCampaign(org, { archivedAt: new Date('2025-11-02T18:00:00Z') });
  await visit(org, c, '2025-10-29T15:00:00Z');

  const { invoicing, range } = await orgInvoicing(org, { now: NOW });
  assert.strictEqual(invoicing.billingSince, '2025-10', 'October is where the money was');
  const facts = range.campaigns.find((x) => String(x.campaignId) === String(c._id));
  assert.strictEqual(facts.billingStartMonth, '2025-11', 'and the campaign still reports its start-grace month');

  const byMonth = new Map(invoicing.monthStates.map((m) => [m.month, m.state]));
  assert.strictEqual(byMonth.get('2025-10'), 'awaiting', 'the floor month is owed');
  assert.strictEqual(byMonth.get('2025-11'), 'zero', 'the end grace made November free');
});

test('an internal org produces no money signals and every month reads internal', { skip }, async () => {
  const org = await makeOrg('Internal Inv', 'internal-inv', { internal: true, status: 'internal' });
  const c = await makeCampaign(org);
  await visit(org, c, '2026-01-10T15:00:00Z');
  const { invoicing, internal } = await orgInvoicing(org, { now: NOW });
  assert.strictEqual(internal, true);
  assert.strictEqual(invoicing.awaiting.months.length, 0);
  assert.strictEqual(invoicing.outstanding.count, 0);
  assert.ok(invoicing.monthStates.every((m) => m.state === 'internal'));
});

test('an org with no subscription row computes at the defaults and stays unwritten', { skip }, async () => {
  const org = await makeOrg('No Sub', 'no-sub-org', { status: null });
  const c = await makeCampaign(org);
  await visit(org, c, '2026-01-10T15:00:00Z');

  const before = await Subscription.countDocuments({ organizationId: org._id });
  assert.strictEqual(before, 0);
  const { invoicing, termsDays, range } = await orgInvoicing(org, { now: NOW });
  const after_ = await Subscription.countDocuments({ organizationId: org._id });
  assert.strictEqual(after_, 0, 'a READ must never materialize a subscription — that is loadOrgSub’s job');
  assert.strictEqual(termsDays, DEFAULT_PAYMENT_TERMS_DAYS);
  assert.strictEqual(range.rateCents, DEFAULT_RATE_CENTS);
  assert.ok(invoicing.awaiting.months.length > 0, 'it still bills — no subscription record is not a free pass');
});

test('a DEACTIVATED org still owes what it owes', { skip }, async () => {
  const org = await makeOrg('Gone Quiet', 'gone-quiet', { bornIso: '2026-01-01T00:00:00Z', isActive: false });
  await issue(org, '2026-03', {
    issuedAt: '2026-04-01T00:00:00Z',
    dueAt: '2026-05-01T00:00:00Z',
    totalCents: 30000,
    lines: [],
  });
  const { invoicing } = await orgInvoicing(org, { now: NOW });
  assert.strictEqual(invoicing.overdue.count, 1, 'switching off sign-in does not settle an invoice');
  assert.strictEqual(invoicing.overdue.totalCents, 30000);
});

test('a legacy statement with no dueAt is resolved, and an unpaid one outside the window still counts', { skip }, async () => {
  const org = await makeOrg('Legacy Inv', 'legacy-inv', { bornIso: '2026-06-01T00:00:00Z' });
  // Issued long before the org's own window starts, with no due date — the pre-feature shape.
  await issue(org, '2023-01', { issuedAt: '2023-02-01T00:00:00Z', dueAt: null, totalCents: 45000, lines: [] });
  const { invoicing } = await orgInvoicing(org, { now: NOW });
  assert.strictEqual(invoicing.overdue.count, 1, 'statements are read org-wide, never window-bound');
  assert.strictEqual(invoicing.overdue.totalCents, 45000);
  assert.strictEqual(
    new Date(invoicing.overdue.oldestDueAt).toISOString(),
    '2023-03-03T00:00:00.000Z',
    'issuedAt + net-30, exactly what the backfill will persist'
  );
});

test('a force-issued current month shows the live meter and is still owed', { skip }, async () => {
  const org = await makeOrg('Early Close', 'early-close', { bornIso: '2026-08-01T00:00:00Z' });
  const c = await makeCampaign(org);
  await visit(org, c, '2026-09-04T15:00:00Z');
  await issue(org, CURRENT_MONTH, {
    issuedAt: '2026-09-20T00:00:00Z',
    dueAt: '2026-10-20T00:00:00Z',
    totalCents: 30000,
    lines: [{ campaignId: c._id, name: 'early', billable: true, reason: 'billable', amountCents: 30000, rateCents: 30000 }],
  });
  const { invoicing } = await orgInvoicing(org, { now: NOW });
  assert.ok(invoicing.running.issuedEarly, 'the running card says it was frozen early');
  assert.strictEqual(invoicing.awaiting.months.length, 0, 'never awaiting — it already has a statement');
  assert.strictEqual(invoicing.outstanding.count, 1, 'but it carries a due date and someone has to pay it');
});

// ---- the cheap desk path -----------------------------------------------------

test('the desk path and the full-window path agree on every figure that matters', { skip }, async () => {
  // The desk recomputes only the BACKLOG (closed months with no statement) plus the running month;
  // the org page recomputes the whole window. That is a large performance difference and must be
  // ZERO behavioural difference, or the two screens disagree about what a customer owes — the exact
  // failure this feature was built to remove.
  const cheap = await orgInvoicing(ctx.org, { now: NOW });
  const full = await orgInvoicing(ctx.org, { now: NOW, includeLines: true });

  for (const key of ['billingSince']) {
    assert.strictEqual(cheap.invoicing[key], full.invoicing[key], key);
  }
  assert.deepStrictEqual(
    cheap.invoicing.awaiting.months.map((m) => [m.month, m.totalCents]),
    full.invoicing.awaiting.months.map((m) => [m.month, m.totalCents]),
    'the backlog is identical'
  );
  assert.strictEqual(cheap.invoicing.awaiting.totalCents, full.invoicing.awaiting.totalCents);
  assert.deepStrictEqual(cheap.invoicing.outstanding, full.invoicing.outstanding);
  assert.deepStrictEqual(cheap.invoicing.overdue, full.invoicing.overdue);
  assert.deepStrictEqual(cheap.invoicing.paid, full.invoicing.paid);
  assert.strictEqual(cheap.invoicing.running.totalCents, full.invoicing.running.totalCents);
  assert.strictEqual(cheap.invoicing.running.billableCampaigns, full.invoicing.running.billableCampaigns);
  assert.strictEqual(cheap.usage.totalCents, full.usage.totalCents);
  assert.strictEqual(cheap.usage.setupCount, full.usage.setupCount);
});

test('the desk skips the recompute entirely for an org with nothing outstanding to work out', { skip }, async () => {
  // An org invoiced up to date has no closed month without a statement, so the only month worth
  // recomputing is the running one. Proven by the SHAPE of the range it walks, which is what the
  // cost is proportional to.
  const org = await makeOrg('Up To Date', 'up-to-date', { bornIso: '2025-01-01T00:00:00Z' });
  const c = await makeCampaign(org);
  await visit(org, c, '2025-02-10T15:00:00Z');
  // Issue EVERY closed month in the org's window — including the $0 ones before the first knock,
  // because a month with no statement is what makes the desk look, whatever it comes to.
  for (let m = '2025-01'; m < CURRENT_MONTH; m = addMonths(m, 1)) {
    await issue(org, m, { issuedAt: '2026-01-01T00:00:00Z', dueAt: '2026-02-01T00:00:00Z', totalCents: 30000, lines: [] });
  }
  const cheap = await orgInvoicing(org, { now: NOW });
  assert.strictEqual(
    cheap.range.from,
    CURRENT_MONTH,
    'with no backlog the walk is one month — not the org’s whole life'
  );
  assert.strictEqual(cheap.range.to, CURRENT_MONTH);
  assert.strictEqual(cheap.invoicing.awaiting.months.length, 0);
  // And the window it REPORTS is still the canonical one, so the footer does not claim a narrow
  // scan hid something.
  assert.strictEqual(cheap.window.from, '2025-01');
});

test('a backlog narrows the scan to the backlog, not to nothing', { skip }, async () => {
  const org = await makeOrg('Behind', 'behind-org', { bornIso: '2025-01-01T00:00:00Z' });
  const c = await makeCampaign(org);
  await visit(org, c, '2026-06-10T15:00:00Z');
  await issue(org, '2026-06', { issuedAt: '2026-07-01T00:00:00Z', dueAt: '2026-08-01T00:00:00Z', totalCents: 30000, lines: [] });
  const cheap = await orgInvoicing(org, { now: NOW });
  // June is issued, so the earliest month still needing a live answer is January 2025 (the org's
  // creation month) — every month before the first knock is $0, and the scan has to prove that.
  assert.strictEqual(cheap.range.from, '2025-01');
  assert.strictEqual(cheap.range.to, CURRENT_MONTH);
  assert.deepStrictEqual(
    cheap.invoicing.awaiting.months.map((m) => m.month),
    ['2026-07', '2026-08'],
    'July and August closed with money and no statement'
  );
});
