import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// DUE DATES AND PAYMENT over the real Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pay_test node --test test/statementPayment.int.test.js
//
// Covers what issuing now freezes (terms + due date), the two payment writes and every refusal
// they can answer, the void-while-paid guard, and the canonical history shape the org page reads.
// invoicingState.test.js owns the pure decisions; this proves the routes feed and persist them.
//
// Every date is FIXED except `now`, which only ever moves forward — a wall-clock fixture would
// make "overdue" true or false depending on when CI runs.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-payment';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SubscriptionEvent } = await import('../src/models/SubscriptionEvent.js');
const { Statement } = await import('../src/models/Statement.js');
const { effectiveDueAt } = await import('../src/services/billing/invoicingState.js');
const { billingStartMonth } = await import('../src/services/billing/billingMonths.js');
const { statementDrift } = await import('../src/services/billing/statementDrift.js');
const { addMonths, currentMonth } = await import('../src/services/billing/statement.js').then(async (m) => ({
  currentMonth: m.currentMonth,
  addMonths: (await import('../src/services/billing/billingMonths.js')).addMonths,
}));

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const DAY = 86400000;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity, Subscription, SubscriptionEvent, Statement]) {
    await M.deleteMany({});
  }
  await Statement.syncIndexes();

  // Born BEFORE the fixture's activity, deliberately: the invoicing window starts at the org's
  // creation month, because activity cannot predate the organization. An org created "now" with
  // back-dated knocks is a shape production can never produce, and testing against it would prove
  // nothing about the window.
  const org = await Organization.create({ name: 'Pay Org', slug: 'pay-org', isActive: true });
  // Born BEFORE the fixture's activity. Written through the RAW collection because Mongoose marks
  // `createdAt` immutable when timestamps are on — a model-level update is silently dropped, which
  // leaves the window starting today and every back-dated month outside it.
  // (The routes re-read the org, so only the collection write matters — assigning to the in-memory
  // document would be dropped by that same immutability.)
  await Organization.collection.updateOne(
    { _id: org._id },
    { $set: { createdAt: new Date('2024-11-01T00:00:00Z') } }
  );
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'padmin@t.co', passwordHash: 'x', isActive: true });
  const superU = await User.create({ firstName: 'Sue', lastName: 'Super', email: 'psuper@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, userId: admin._id, adminTok: signUserToken(admin), superTok: signUserToken(superU) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

let seq = 0;
async function makeCampaign({ tz = 'America/New_York', archivedAt = null } = {}) {
  seq += 1;
  return Campaign.create({
    organizationId: ctx.org._id,
    name: `Pay Camp ${seq}`,
    type: 'survey',
    state: 'KY',
    timeZone: tz,
    isActive: !archivedAt,
    archivedAt,
  });
}

async function visit(campaign, iso) {
  seq += 1;
  const hh = await Household.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    addressLine1: `${seq} Pay St`,
    city: 'Town',
    state: 'KY',
    zipCode: '40002',
    normalizedAddress: `${seq} PAY ST|TOWN|KY|40002`,
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  return CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: ctx.userId,
    actionType: 'not_home',
    timestamp: new Date(iso),
    location: { lat: 38.0, lng: -84.5 },
  });
}

const orgPath = (suffix) => `/super-admin/organizations/${ctx.org._id}${suffix}`;

// A month safely in the past, so MONTH_NOT_ENDED never fires and the fixture can never
// become "the current month" as the calendar moves.
const PAST_MONTH = '2026-01';

// ---- issuing freezes the terms and the date ----------------------------------

test('issuing stamps termsDays and dueAt exactly terms days after issuedAt', { skip }, async () => {
  const c = await makeCampaign();
  await visit(c, '2026-01-10T15:00:00Z');
  const r = await call('POST', orgPath(`/billing/statement/${PAST_MONTH}/issue`), {
    token: ctx.superTok,
    body: { externalRef: 'INV-100' },
  });
  assert.strictEqual(r.status, 201);
  const s = r.json.statement;
  assert.strictEqual(s.termsDays, 30, 'the org default');
  assert.strictEqual(
    new Date(s.dueAt).getTime() - new Date(s.issuedAt).getTime(),
    30 * DAY,
    'due exactly the terms later, to the millisecond'
  );
  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, 'changes.statementIssued.month': PAST_MONTH }).lean();
  assert.ok(ev.changes.statementIssued.dueAt, 'the audit records the due date it promised');
  assert.strictEqual(ev.changes.statementIssued.termsDays, 30);
  ctx.statementId = s._id;
});

test('a statement line carries the month the campaign bills from', { skip }, async () => {
  const s = await Statement.findById(ctx.statementId).lean();
  const line = s.lines[0];
  assert.strictEqual(
    line.billingStartMonth,
    billingStartMonth('2026-01-10'),
    'frozen on the line, so a two-year-old invoice explains its own start without the grace rule'
  );
  assert.strictEqual(line.billingStartMonth, '2026-01');
});

test('a legacy frozen line with no billingStartMonth never reads as drift', { skip }, async () => {
  const s = await Statement.findById(ctx.statementId).lean();
  const legacy = { ...s, lines: s.lines.map(({ billingStartMonth: _drop, ...rest }) => rest) };
  const live = { ...s, lines: s.lines };
  assert.strictEqual(
    statementDrift(legacy, live),
    null,
    'the drift field list is explicit — a new field cannot invent a disagreement'
  );
});

test('changing payment terms leaves an issued due date alone, and the NEXT issue uses the new terms', { skip }, async () => {
  const before = await Statement.findById(ctx.statementId).lean();
  const p = await call('PATCH', orgPath('/billing'), { token: ctx.superTok, body: { paymentTermsDays: 14 } });
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.json.subscription.paymentTermsDays, 14);

  const after_ = await Statement.findById(ctx.statementId).lean();
  assert.strictEqual(
    new Date(after_.dueAt).getTime(),
    new Date(before.dueAt).getTime(),
    'an invoice already sent keeps the date it was sent with'
  );

  // A second month, issued under the new terms.
  const c = await makeCampaign();
  await visit(c, '2026-02-10T15:00:00Z');
  const r = await call('POST', orgPath('/billing/statement/2026-02/issue'), { token: ctx.superTok });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.statement.termsDays, 14);
  assert.strictEqual(new Date(r.json.statement.dueAt).getTime() - new Date(r.json.statement.issuedAt).getTime(), 14 * DAY);
  ctx.febStatementId = r.json.statement._id;

  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, 'changes.paymentTermsDays': { $exists: true } }).lean();
  assert.deepStrictEqual(ev.changes.paymentTermsDays, { from: 30, to: 14 });
  // Put it back so later assertions read the default.
  await call('PATCH', orgPath('/billing'), { token: ctx.superTok, body: { paymentTermsDays: 30 } });
});

test('payment terms outside 0..365 are refused', { skip }, async () => {
  for (const bad of [-1, 366, 4.5]) {
    const r = await call('PATCH', orgPath('/billing'), { token: ctx.superTok, body: { paymentTermsDays: bad } });
    assert.strictEqual(r.status, 400, `${bad} must be refused`);
  }
  const ok = await call('PATCH', orgPath('/billing'), { token: ctx.superTok, body: { paymentTermsDays: 0 } });
  assert.strictEqual(ok.status, 200, '0 is a legal setting — due on issue');
  await call('PATCH', orgPath('/billing'), { token: ctx.superTok, body: { paymentTermsDays: 30 } });
});

// ---- marking paid ------------------------------------------------------------

test('mark paid records the date, the reference and who did it, and audits all three', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/paid`), {
    token: ctx.superTok,
    body: { paidAt: '2026-02-03T00:00:00.000Z', paymentRef: 'CHK 4471' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(new Date(r.json.statement.paidAt).toISOString(), '2026-02-03T00:00:00.000Z');
  assert.strictEqual(r.json.statement.paymentRef, 'CHK 4471');
  assert.ok(r.json.statement.paidByUserId, 'attribution is recorded');
  assert.strictEqual(r.json.statement.status, 'issued', 'paid is not a status — the row is still issued');

  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, 'changes.statementPaid': { $exists: true } }).lean();
  assert.strictEqual(ev.changes.statementPaid.month, PAST_MONTH);
  assert.strictEqual(ev.changes.statementPaid.paymentRef, 'CHK 4471');
});

test('marking an already-paid statement paid again is a clean 409', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/paid`), { token: ctx.superTok, body: {} });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'ALREADY_PAID');
});

test('a payment date far in the future is refused; a few hours ahead is fine', { skip }, async () => {
  const far = new Date(Date.now() + 3 * DAY).toISOString();
  const r = await call('POST', orgPath(`/billing/statement/${ctx.febStatementId}/paid`), {
    token: ctx.superTok,
    body: { paidAt: far },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'PAID_AT_FUTURE');

  const soon = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  const ok = await call('POST', orgPath(`/billing/statement/${ctx.febStatementId}/paid`), {
    token: ctx.superTok,
    body: { paidAt: soon },
  });
  assert.strictEqual(ok.status, 200, 'a date picker sending local midnight must not be rejected');
  await call('POST', orgPath(`/billing/statement/${ctx.febStatementId}/unpaid`), {
    token: ctx.superTok,
    body: { reason: 'resetting the fixture' },
  });
});

test('a payment dated BEFORE the statement was issued is allowed — prepays exist', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.febStatementId}/paid`), {
    token: ctx.superTok,
    body: { paidAt: '2025-12-01T00:00:00.000Z', paymentRef: 'prepay' },
  });
  assert.strictEqual(r.status, 200);
  await call('POST', orgPath(`/billing/statement/${ctx.febStatementId}/unpaid`), {
    token: ctx.superTok,
    body: { reason: 'resetting the fixture' },
  });
});

test('a $0 statement can never be marked paid', { skip }, async () => {
  const zero = await Statement.create({
    organizationId: ctx.org._id,
    month: '2025-06',
    status: 'issued',
    rateCents: 30000,
    rulesVersion: 3,
    totalCents: 0,
    lines: [],
    issuedAt: new Date('2025-07-01T00:00:00Z'),
  });
  const r = await call('POST', orgPath(`/billing/statement/${zero._id}/paid`), { token: ctx.superTok, body: {} });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'NOT_PAYABLE');
  ctx.zeroStatementId = String(zero._id);
});

test('a voided statement cannot be marked paid, and neither can another org’s', { skip }, async () => {
  const other = await Organization.create({ name: 'Other Pay', slug: 'other-pay', isActive: true });
  const foreign = await Statement.create({
    organizationId: other._id,
    month: '2025-05',
    status: 'issued',
    rateCents: 30000,
    rulesVersion: 3,
    totalCents: 30000,
    lines: [],
    issuedAt: new Date('2025-06-01T00:00:00Z'),
  });
  const r = await call('POST', orgPath(`/billing/statement/${foreign._id}/paid`), { token: ctx.superTok, body: {} });
  assert.strictEqual(r.status, 409, 'the organizationId in the filter is the cross-org guard');
  assert.strictEqual(r.json.code, 'NOT_ISSUED');
});

test('an org admin cannot touch payment state', { skip }, async () => {
  for (const suffix of ['paid', 'unpaid']) {
    const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/${suffix}`), {
      token: ctx.adminTok,
      orgId: ctx.org._id,
      body: { reason: 'nope' },
    });
    assert.strictEqual(r.status, 403, `${suffix} is super-admin only`);
  }
});

// ---- unmarking, and the void guard -------------------------------------------

test('voiding a PAID statement is refused; unmark it first', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/void`), {
    token: ctx.superTok,
    body: { reason: 'wrong month' },
  });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'STATEMENT_PAID');
  const still = await Statement.findById(ctx.statementId).lean();
  assert.strictEqual(still.status, 'issued', 'the refusal left the row alone');
});

test('unmark requires a reason and keeps the cleared values in the audit', { skip }, async () => {
  const bad = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/unpaid`), { token: ctx.superTok, body: {} });
  assert.strictEqual(bad.status, 400, 'a reason is required — the fields it clears are the only record');

  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/unpaid`), {
    token: ctx.superTok,
    body: { reason: 'the check bounced' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.statement.paidAt, null);
  assert.strictEqual(r.json.statement.paymentRef, '');
  assert.strictEqual(r.json.statement.paidByUserId, null);

  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, 'changes.statementUnpaid': { $exists: true } }).lean();
  assert.strictEqual(new Date(ev.changes.statementUnpaid.previousPaidAt).toISOString(), '2026-02-03T00:00:00.000Z');
  assert.strictEqual(ev.changes.statementUnpaid.previousPaymentRef, 'CHK 4471');
  assert.strictEqual(ev.reason, 'the check bounced');
});

test('unmarking something that was never paid is a clean 409', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/unpaid`), {
    token: ctx.superTok,
    body: { reason: 'again' },
  });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'NOT_PAID');
});

test('after unmarking, the statement can be voided as normal', { skip }, async () => {
  const r = await call('POST', orgPath(`/billing/statement/${ctx.statementId}/void`), {
    token: ctx.superTok,
    body: { reason: 'reissuing under a corrected rate' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.statement.status, 'void');
  assert.strictEqual(r.json.statement.paidAt, null, 'a void row never carries payment fields');
});

test('a voided month returns to awaiting, and reissuing starts a fresh due date', { skip }, async () => {
  const h = await call('GET', orgPath('/billing/history?from=origin'), { token: ctx.superTok });
  const jan = h.json.months.find((m) => m.month === PAST_MONTH);
  assert.strictEqual(jan.state, 'awaiting', 'voided and not reissued is owed again');
  assert.ok(h.json.invoicing.awaiting.months.some((m) => m.month === PAST_MONTH));

  const again = await call('POST', orgPath(`/billing/statement/${PAST_MONTH}/issue`), {
    token: ctx.superTok,
    body: { externalRef: 'INV-100R' },
  });
  assert.strictEqual(again.status, 201);
  assert.ok(again.json.statement.dueAt, 'the replacement gets its own due date');
  ctx.statementId = again.json.statement._id;
});

// ---- the canonical history the org page reads --------------------------------

test('history?from=origin resolves the window, carries the invoicing block and per-row state', { skip }, async () => {
  const r = await call('GET', orgPath('/billing/history?from=origin'), { token: ctx.superTok });
  assert.strictEqual(r.status, 200);
  const b = r.json;
  assert.ok(b.window.from <= PAST_MONTH, 'the window reaches back past the first billed month');
  assert.strictEqual(b.window.to, b.currentMonth);
  assert.strictEqual(b.currentMonth, currentMonth(), 'the SERVER month, not the browser’s');
  assert.ok(b.asOf, 'the response stamps when it was computed');
  assert.strictEqual(b.paymentTermsDays, 30);
  assert.ok(Array.isArray(b.campaigns), 'the per-campaign facts ride along');
  assert.ok(b.campaigns[0].billingStartMonth !== undefined);

  const jan = b.months.find((m) => m.month === PAST_MONTH);
  assert.strictEqual(jan.state, 'issued');
  assert.ok(jan.dueAt);
  assert.strictEqual(jan.paymentState, 'outstanding');
  assert.ok(Array.isArray(jan.lines), 'lines ride along so the ledger expands without a fetch');

  const running = b.months.find((m) => m.month === b.currentMonth);
  assert.strictEqual(running.state, 'open', 'the running month is never awaiting');
  assert.strictEqual(b.invoicing.billingSince, PAST_MONTH);
});

test('an explicit from/to range keeps its old shape and gains the new row fields', { skip }, async () => {
  const r = await call('GET', orgPath(`/billing/history?from=${PAST_MONTH}&to=2026-02`), { token: ctx.superTok });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.from, PAST_MONTH);
  assert.strictEqual(r.json.to, '2026-02');
  assert.strictEqual(r.json.months.length, 2);
  assert.strictEqual(r.json.invoicing, undefined, 'the invoicing block is the canonical window’s job');
  const row = r.json.months.find((m) => m.month === PAST_MONTH);
  assert.ok(row.state && row.dueAt !== undefined && row.paymentState !== undefined);
  assert.ok(row.totalCents !== undefined && row.issued === true, 'every legacy key survives');
});

test('the single-month statement and the paper trail carry the due date and payment state', { skip }, async () => {
  const s = await call('GET', orgPath(`/billing/statement?month=${PAST_MONTH}`), { token: ctx.superTok });
  assert.strictEqual(s.status, 200);
  assert.ok(s.json.dueAt);
  assert.strictEqual(s.json.paymentState, 'outstanding');
  assert.strictEqual(s.json.currentMonth, currentMonth());

  const p = await call('GET', orgPath('/billing/statements'), { token: ctx.superTok });
  assert.strictEqual(p.status, 200);
  const voided = p.json.statements.find((x) => x.status === 'void');
  assert.ok(voided, 'the paper trail still shows voided rows');
  assert.strictEqual(voided.paymentState, null, 'a void row has no payment state');
  const live = p.json.statements.find((x) => x.status === 'issued' && x.month === PAST_MONTH);
  assert.strictEqual(live.paymentState, 'outstanding');
});

test('a legacy statement with no dueAt reads as issuedAt plus the org’s terms', { skip }, async () => {
  const legacy = await Statement.create({
    organizationId: ctx.org._id,
    month: '2025-03',
    status: 'issued',
    rateCents: 30000,
    rulesVersion: 3,
    totalCents: 30000,
    lines: [],
    issuedAt: new Date('2025-04-01T00:00:00Z'),
    // dueAt deliberately absent — this is what every statement issued before this feature looks like
  });
  const p = await call('GET', orgPath('/billing/statements'), { token: ctx.superTok });
  const row = p.json.statements.find((x) => String(x._id) === String(legacy._id));
  assert.strictEqual(
    new Date(row.dueAt).toISOString(),
    '2025-05-01T00:00:00.000Z',
    'issuedAt + net-30, exactly what the backfill will persist'
  );
  assert.strictEqual(row.paymentState, 'overdue', 'and long past due, which is the truth');
  assert.strictEqual(
    new Date(effectiveDueAt(legacy.toObject(), 30)).toISOString(),
    new Date(row.dueAt).toISOString(),
    'the route and the pure resolver agree'
  );
  ctx.legacyStatementId = String(legacy._id);
});

test('an unpaid statement OLDER than the scan window still counts as owed', { skip }, async () => {
  const r = await call('GET', orgPath('/billing/history?from=origin'), { token: ctx.superTok });
  const ids = r.json.invoicing.overdue.count;
  assert.ok(ids >= 1, 'the 2025-03 legacy row is outside the org’s recent months but still chased');
  assert.ok(r.json.invoicing.outstanding.totalCents >= 30000);
});

test('the payment work adds NO index, so migrate:build-indexes stays a dry run', { skip }, async () => {
  // The exact set that existed before this change. The cross-org unpaid scan
  // (Statement.find({status:'issued', paidAt:null})) rides the single-field `status` index, and
  // every per-org read rides {organizationId, month}. If a future change adds one here, the
  // deploy immediately acquires a `migrate:build-indexes -- --apply` gate (prod autoIndex is OFF)
  // and the hand-over has to say so — which is exactly why this is pinned.
  const declared = Statement.schema.indexes().map(([keys]) => JSON.stringify(keys)).sort();
  assert.deepStrictEqual(declared, [
    JSON.stringify({ organizationId: 1 }),
    JSON.stringify({ organizationId: 1, month: 1 }),
    JSON.stringify({ organizationId: 1, month: -1 }),
    JSON.stringify({ status: 1 }),
  ].sort());
});
