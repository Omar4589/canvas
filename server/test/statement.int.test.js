import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The billing engine end-to-end over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/stmt_test node --test test/statement.int.test.js
// Covers: the grace rules and the floor as statement.js actually feeds them (billingMonths.test.js
// owns the pure rule math), per-campaign negotiated rates and the privilege boundary around them,
// and issuing / voiding / drift on the frozen Statement record.
//
// Every date here is FIXED. A wall-clock fixture would make the start grace fire (or not) depending
// on what day of the month CI runs — the exact bug this suite exists to prevent.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-statement';

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
const { monthlyStatement } = await import('../src/services/billing/statement.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity, Subscription, SubscriptionEvent, Statement]) {
    await M.deleteMany({});
  }
  // Statement's unique partial index is the race guard the concurrency test below proves. Prod
  // builds it via `npm run migrate:build-indexes --apply`; here we build it explicitly rather than
  // trusting autoIndex to have finished before the first insert.
  await Statement.syncIndexes();

  const org = await Organization.create({ name: 'Stmt Org', slug: 'stmt-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'sadmin@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'slead@t.co', passwordHash: 'x', isActive: true });
  const superU = await User.create({ firstName: 'Sue', lastName: 'Super', email: 'ssuper@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org,
    userId: admin._id,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
    superTok: signUserToken(superU),
  });
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

// ---- fixtures ----------------------------------------------------------------

let seq = 0;
async function makeCampaign({ name, tz = 'America/New_York', archivedAt = null, rate = undefined } = {}) {
  seq += 1;
  const c = await Campaign.create({
    organizationId: ctx.org._id,
    name: name || `Camp ${seq}`,
    type: 'survey',
    state: 'KY',
    timeZone: tz,
    isActive: !archivedAt,
    archivedAt,
    ...(rate === undefined ? {} : { pricePerCampaignCents: rate }),
  });
  return c;
}

async function visit(campaign, iso, { actionType = 'not_home', via } = {}) {
  seq += 1;
  const hh = await Household.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    addressLine1: `${seq} Test St`,
    city: 'Town',
    state: 'KY',
    zipCode: '40002',
    normalizedAddress: `${seq} TEST ST|TOWN|KY|40002`,
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  return CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: ctx.userId,
    actionType,
    ...(via ? { via } : {}),
    timestamp: new Date(iso),
    location: { lat: 38.0, lng: -84.5 },
  });
}

// The reason + billable verdict for one campaign in one month.
async function verdict(campaign, month) {
  const s = await monthlyStatement(ctx.org._id, month);
  const line = s.lines.find((l) => String(l.campaignId) === String(campaign._id));
  return { billable: line.billable, reason: line.reason, amountCents: line.amountCents, rateCents: line.rateCents };
}

// How many months across a span this campaign actually bills.
async function billedMonths(campaign, months) {
  const out = [];
  for (const m of months) {
    const v = await verdict(campaign, m);
    if (v.billable) out.push(m);
  }
  return out;
}

// ---- start grace ---------------------------------------------------------------

test('start grace: a first visit in the last 7 days makes that month free', { skip }, async () => {
  const c = await makeCampaign({ name: 'Late start' });
  await visit(c, '2026-01-28T15:00:00Z'); // Jan has 31 days → threshold 24 → grace
  assert.deepStrictEqual(await verdict(c, '2026-01'), {
    billable: false, reason: 'start-grace', amountCents: 0, rateCents: 30000,
  });
  const feb = await verdict(c, '2026-02');
  assert.strictEqual(feb.billable, true);
  assert.strictEqual(feb.amountCents, 30000);
});

test('start-grace boundary: day 24 bills, day 25 does not (31-day month)', { skip }, async () => {
  const bills = await makeCampaign({ name: 'Day 24' });
  await visit(bills, '2026-01-24T15:00:00Z');
  const free = await makeCampaign({ name: 'Day 25' });
  await visit(free, '2026-01-25T15:00:00Z');
  assert.strictEqual((await verdict(bills, '2026-01')).reason, 'billable');
  assert.strictEqual((await verdict(free, '2026-01')).reason, 'start-grace');
});

test('start grace is leap-aware: Feb 2026 (28d) vs Feb 2028 (29d)', { skip }, async () => {
  // 28-day Feb → threshold 21: day 22 is graced.
  const short = await makeCampaign({ name: 'Feb 2026' });
  await visit(short, '2026-02-22T15:00:00Z');
  assert.strictEqual((await verdict(short, '2026-02')).reason, 'start-grace');
  // 29-day Feb → threshold 22: the SAME day 22 bills.
  const leap = await makeCampaign({ name: 'Feb 2028' });
  await visit(leap, '2028-02-22T15:00:00Z');
  assert.strictEqual((await verdict(leap, '2028-02')).reason, 'billable');
});

test('grace is evaluated in the CAMPAIGN timezone, not UTC', { skip }, async () => {
  // 9pm Jan 31 in Denver is 4am Feb 1 UTC. It must count as a JANUARY visit (and so earn
  // January's start grace), which is only true if the day string is resolved in the campaign tz.
  const c = await makeCampaign({ name: 'Denver', tz: 'America/Denver' });
  await visit(c, '2026-02-01T04:00:00Z');
  assert.strictEqual((await verdict(c, '2026-01')).reason, 'start-grace', 'a January visit');
  assert.strictEqual((await verdict(c, '2026-02')).billable, true);
});

// ---- end grace ------------------------------------------------------------------

test('end grace: archived in the first 3 days with nobody out → free', { skip }, async () => {
  const c = await makeCampaign({ name: 'Quiet exit', archivedAt: new Date('2026-04-02T12:00:00Z') });
  await visit(c, '2026-02-10T15:00:00Z');
  await visit(c, '2026-03-05T15:00:00Z');
  assert.strictEqual((await verdict(c, '2026-03')).reason, 'billable');
  assert.strictEqual((await verdict(c, '2026-04')).reason, 'end-grace');
  assert.strictEqual((await verdict(c, '2026-05')).reason, 'archived-earlier');
});

test('end grace is DENIED when someone knocked that month', { skip }, async () => {
  const c = await makeCampaign({ name: 'Worked then quit', archivedAt: new Date('2026-04-03T12:00:00Z') });
  await visit(c, '2026-02-10T15:00:00Z');
  await visit(c, '2026-04-01T15:00:00Z'); // real work on the 1st
  const apr = await verdict(c, '2026-04');
  assert.strictEqual(apr.reason, 'billable', 'two days of real canvassing is a billable month');
  assert.strictEqual(apr.amountCents, 30000);
});

test('end grace is DENIED on the 4th', { skip }, async () => {
  const c = await makeCampaign({ name: 'One day late', archivedAt: new Date('2026-04-04T12:00:00Z') });
  await visit(c, '2026-02-10T15:00:00Z');
  assert.strictEqual((await verdict(c, '2026-04')).reason, 'billable');
});

test('a non-bulk RESTRICTED mark is a field visit — it denies the end grace', { skip }, async () => {
  // The trap this asserts: "did anyone go out" must be flag-independent. Reading it through
  // billableDoorsOf() would collapse to the KNOCK count with billRestrictedDoors off, so a month
  // of restricted marks would look empty and win a free month — even though canvassers walked.
  const c = await makeCampaign({ name: 'Gated only', archivedAt: new Date('2026-04-02T12:00:00Z') });
  await visit(c, '2026-02-10T15:00:00Z');
  await visit(c, '2026-04-01T15:00:00Z', { actionType: 'restricted' });
  assert.strictEqual(
    (await verdict(c, '2026-04')).reason, 'billable',
    'someone walked to a gated community in April — not a free month'
  );
});

test('a BULK restricted row is desk work — the end grace still applies', { skip }, async () => {
  const c = await makeCampaign({ name: 'Desk only', archivedAt: new Date('2026-04-02T12:00:00Z') });
  await visit(c, '2026-02-10T15:00:00Z');
  await visit(c, '2026-04-01T15:00:00Z', { actionType: 'restricted', via: 'bulk' });
  assert.strictEqual(
    (await verdict(c, '2026-04')).reason, 'end-grace',
    'bulk-restricting a book from the Turf page is not a trip to the field'
  );
});

// ---- the floor ------------------------------------------------------------------

test('floor: the Oct 29 → Nov 2 campaign bills exactly one month', { skip }, async () => {
  // Both graces fire — first visit in October's last week, archived Nov 2 with nobody out in
  // November — and would net to a completely free campaign without the floor.
  const c = await makeCampaign({ name: 'GOTV blitz', archivedAt: new Date('2026-11-02T12:00:00Z') });
  await visit(c, '2026-10-29T15:00:00Z');
  assert.strictEqual((await verdict(c, '2026-10')).reason, 'floor');
  assert.strictEqual((await verdict(c, '2026-10')).amountCents, 30000);
  assert.strictEqual((await verdict(c, '2026-11')).reason, 'end-grace');
  assert.deepStrictEqual(
    await billedMonths(c, ['2026-09', '2026-10', '2026-11', '2026-12']),
    ['2026-10'],
    'exactly one month — never zero, never two'
  );
});

test('floor does NOT double-charge when the start month earned its own charge', { skip }, async () => {
  // Same shape, but canvassers DID go out on Nov 1 — so November bills on its own merits and
  // October keeps its start grace. This is the case that proves the F+1 probe actually runs:
  // October's verdict is only distinguishable from the test above by November's visit count.
  const c = await makeCampaign({ name: 'Worked into November', archivedAt: new Date('2026-11-02T12:00:00Z') });
  await visit(c, '2026-10-29T15:00:00Z');
  await visit(c, '2026-11-01T15:00:00Z');
  assert.strictEqual((await verdict(c, '2026-10')).reason, 'start-grace');
  assert.strictEqual((await verdict(c, '2026-11')).reason, 'billable');
  assert.deepStrictEqual(await billedMonths(c, ['2026-10', '2026-11', '2026-12']), ['2026-11']);
});

test('floor: archived in the same month as a graced first visit', { skip }, async () => {
  const c = await makeCampaign({ name: 'One week only', archivedAt: new Date('2026-01-30T12:00:00Z') });
  await visit(c, '2026-01-28T15:00:00Z');
  assert.strictEqual((await verdict(c, '2026-01')).reason, 'floor');
  assert.deepStrictEqual(await billedMonths(c, ['2026-01', '2026-02', '2026-03']), ['2026-01']);
});

test('a campaign that never went to the field never bills', { skip }, async () => {
  const c = await makeCampaign({ name: 'Setup only' });
  assert.deepStrictEqual(await verdict(c, '2026-05'), {
    billable: false, reason: 'no-field-visit', amountCents: 0, rateCents: 30000,
  });
  const usage = await monthlyStatement(ctx.org._id, '2026-05');
  assert.ok(usage.lines.some((l) => l.reason === 'no-field-visit'));
});

// ---- per-campaign rates ---------------------------------------------------------

test('per-campaign rate: override beats the org rate, null inherits, 0 is legal', { skip }, async () => {
  const inherits = await makeCampaign({ name: 'Inherits' });
  const premium = await makeCampaign({ name: 'Governor', rate: 120000 });
  const comped = await makeCampaign({ name: 'Comped', rate: 0 });
  for (const c of [inherits, premium, comped]) await visit(c, '2026-06-10T15:00:00Z');

  const s = await monthlyStatement(ctx.org._id, '2026-06');
  const line = (c) => s.lines.find((l) => String(l.campaignId) === String(c._id));

  assert.strictEqual(line(inherits).rateCents, 30000);
  assert.strictEqual(line(inherits).pricePerCampaignCents, null, 'null marks "inherits" in the UI');
  assert.strictEqual(line(premium).amountCents, 120000);
  // 0 must survive as 0 — the `||` trap would promote a deliberately comped campaign back to $300.
  assert.strictEqual(line(comped).billable, true, 'a comped campaign is still BILLABLE');
  assert.strictEqual(line(comped).amountCents, 0, 'at $0');
  assert.strictEqual(line(comped).pricePerCampaignCents, 0);

  // The total is the SUM of per-line amounts, never count × the org rate.
  const sum = s.lines.reduce((n, l) => n + l.amountCents, 0);
  assert.strictEqual(s.totalCents, sum);
  assert.notStrictEqual(s.totalCents, s.lines.filter((l) => l.billable).length * s.rateCents);
  assert.strictEqual(s.rateCents, 30000, 'the top-level rate stays the ORG default');
});

test('a super admin can set and clear a per-campaign rate, with an audit event', { skip }, async () => {
  const c = await makeCampaign({ name: 'Repriced' });
  const set = await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing/campaigns/${c._id}`, {
    token: ctx.superTok, body: { pricePerCampaignCents: 75000 },
  });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(set.json.effectiveRateCents, 75000);

  const listed = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/campaigns`, { token: ctx.superTok });
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.json.campaigns.find((x) => x.campaignId === String(c._id)).effectiveRateCents, 75000);

  const cleared = await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing/campaigns/${c._id}`, {
    token: ctx.superTok, body: { pricePerCampaignCents: null },
  });
  assert.strictEqual(cleared.json.effectiveRateCents, 30000, 'null restores the org rate');

  const events = await SubscriptionEvent.find({ organizationId: ctx.org._id, 'changes.campaignRate': { $exists: true } }).lean();
  assert.strictEqual(events.length, 2, 'both the set and the clear are audited');
});

test('the per-campaign rate never reaches org admins or leads', { skip }, async () => {
  const c = await makeCampaign({ name: 'Secret price' });
  await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing/campaigns/${c._id}`, {
    token: ctx.superTok, body: { pricePerCampaignCents: 99000 },
  });

  // Reads: the field is `select: false`, so it can't ride along in the lean-doc spread.
  for (const [who, tok] of [['admin', ctx.adminTok], ['lead', ctx.leadTok]]) {
    const list = await call('GET', '/admin/campaigns', { token: tok, orgId: ctx.org._id });
    assert.strictEqual(list.status, 200, who);
    assert.ok(!JSON.stringify(list.json).includes('99000'), `the ${who} campaign list carries no price`);
    assert.ok(!JSON.stringify(list.json).includes('pricePerCampaignCents'), `no price FIELD for the ${who}`);
  }

  // Writes: the zod schema strips the unknown key, so an org admin can't set their own price.
  const attempt = await call('PATCH', `/admin/campaigns/${c._id}`, {
    token: ctx.adminTok, orgId: ctx.org._id, body: { pricePerCampaignCents: 1 },
  });
  assert.ok([200, 403].includes(attempt.status), `unexpected ${attempt.status}`);
  const after = await Campaign.findById(c._id).select('+pricePerCampaignCents').lean();
  assert.strictEqual(after.pricePerCampaignCents, 99000, 'an org-admin PATCH cannot move the rate');
});

test('a cross-org campaign id cannot be repriced through this org', { skip }, async () => {
  const other = await Organization.create({ name: 'Other', slug: 'other-org', isActive: true });
  const foreign = await Campaign.create({ organizationId: other._id, name: 'Foreign', type: 'survey', state: 'KY' });
  const r = await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing/campaigns/${foreign._id}`, {
    token: ctx.superTok, body: { pricePerCampaignCents: 1 },
  });
  assert.strictEqual(r.status, 404);
});

// ---- issue / void / drift --------------------------------------------------------

test('issuing freezes a month; reissuing is a 409', { skip }, async () => {
  const c = await makeCampaign({ name: 'Issue me' });
  await visit(c, '2026-02-10T15:00:00Z');

  const r = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-02/issue`, {
    token: ctx.superTok, body: { externalRef: 'INV-1001' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.statement.month, '2026-02');
  assert.strictEqual(r.json.statement.rulesVersion, 3);
  assert.strictEqual(r.json.statement.externalRef, 'INV-1001');
  assert.ok(r.json.statement.lines.length > 0, 'campaign lines are frozen into the row');

  const again = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-02/issue`, {
    token: ctx.superTok, body: {},
  });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.json.code, 'ALREADY_ISSUED');

  const ev = await SubscriptionEvent.findOne({ organizationId: ctx.org._id, 'changes.statementIssued.month': '2026-02' }).lean();
  assert.ok(ev, 'issuing is audited');
});

test('two concurrent issues: exactly one wins (the partial unique index)', { skip }, async () => {
  const c = await makeCampaign({ name: 'Race' });
  await visit(c, '2026-06-10T15:00:00Z');
  // A CLOSED month on purpose: an unfinished one is refused by the not-ended guard before it ever
  // reaches the index, so the race would never be exercised.
  const url = `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-06/issue`;
  const [a, b] = await Promise.all([
    call('POST', url, { token: ctx.superTok, body: {} }),
    call('POST', url, { token: ctx.superTok, body: {} }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepStrictEqual(codes, [201, 409], `expected one win and one conflict, got ${codes}`);
  const n = await Statement.countDocuments({ organizationId: ctx.org._id, month: '2026-06', status: 'issued' });
  assert.strictEqual(n, 1, 'never two live issued statements for one org-month');
});

test('an unfinished month is refused unless forced', { skip }, async () => {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const url = `/super-admin/organizations/${ctx.org._id}/billing/statement/${thisMonth}/issue`;
  const refused = await call('POST', url, { token: ctx.superTok, body: {} });
  assert.strictEqual(refused.status, 422);
  assert.strictEqual(refused.json.code, 'MONTH_NOT_ENDED');

  const forced = await call('POST', url, { token: ctx.superTok, body: { force: true } });
  assert.strictEqual(forced.status, 201);
});

test('internal organizations can never have a statement issued', { skip }, async () => {
  const internal = await Organization.create({ name: 'Doorline Internal', slug: 'dl-int', isActive: true, isInternal: true });
  await Subscription.create({ organizationId: internal._id, status: 'internal', statusChangedAt: new Date() });
  const r = await call('POST', `/super-admin/organizations/${internal._id}/billing/statement/2026-02/issue`, {
    token: ctx.superTok, body: {},
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'INTERNAL_NOT_BILLABLE');
});

test('voiding requires a reason; double-void is a 409; then it can be reissued', { skip }, async () => {
  const c = await makeCampaign({ name: 'Void me' });
  await visit(c, '2026-03-10T15:00:00Z');
  const issued = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-03/issue`, {
    token: ctx.superTok, body: {},
  });
  const id = issued.json.statement._id;

  const noReason = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/${id}/void`, {
    token: ctx.superTok, body: {},
  });
  assert.strictEqual(noReason.status, 400);

  const ok = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/${id}/void`, {
    token: ctx.superTok, body: { reason: 'Wrong rate applied' },
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.statement.status, 'void');
  assert.strictEqual(ok.json.statement.voidReason, 'Wrong rate applied');

  const twice = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/${id}/void`, {
    token: ctx.superTok, body: { reason: 'again' },
  });
  assert.strictEqual(twice.status, 409);

  // A voided month is issuable again, and BOTH rows survive — the partial index only constrains
  // the issued one.
  const reissued = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-03/issue`, {
    token: ctx.superTok, body: { externalRef: 'INV-REDO' },
  });
  assert.strictEqual(reissued.status, 201);
  const rows = await Statement.find({ organizationId: ctx.org._id, month: '2026-03' }).lean();
  assert.strictEqual(rows.length, 2);
  const voided = rows.find((r) => r.status === 'void');
  assert.strictEqual(String(voided.supersededByStatementId), String(reissued.json.statement._id));
});

test('a frozen statement does not move when the rate changes; drift reports it', { skip }, async () => {
  const c = await makeCampaign({ name: 'Frozen' });
  await visit(c, '2026-05-10T15:00:00Z');
  const issued = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statement/2026-05/issue`, {
    token: ctx.superTok, body: {},
  });
  assert.strictEqual(issued.status, 201);
  const frozenTotal = issued.json.statement.totalCents;

  const before = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/statement?month=2026-05`, {
    token: ctx.superTok,
  });
  assert.strictEqual(before.json.drift, null, 'nothing has changed yet');

  // Renegotiate the org rate — this is the action that silently rewrote history before.
  await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing`, {
    token: ctx.superTok, body: { pricePerCampaignCents: 45000 },
  });

  const after = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/statement?month=2026-05`, {
    token: ctx.superTok,
  });
  assert.strictEqual(after.json.statement.totalCents, frozenTotal, 'the ISSUED figure is unmoved');
  assert.ok(after.json.totalCents > frozenTotal, 'the live recompute did move');
  assert.ok(after.json.drift, 'the divergence is reported, never hidden');
  assert.strictEqual(after.json.drift.material, true, 'it changes what is owed');
  assert.strictEqual(after.json.drift.totalCents.issued, frozenTotal);
  assert.ok(after.json.drift.lines.length > 0, 'named per campaign');

  // Put it back so later tests see the default rate.
  await call('PATCH', `/super-admin/organizations/${ctx.org._id}/billing`, {
    token: ctx.superTok, body: { pricePerCampaignCents: 30000 },
  });
});

// ---- month-close board -----------------------------------------------------------

test('the month-close board lists issued vs unissued, and is super-admin only', { skip }, async () => {
  const board = await call('GET', '/super-admin/billing/statements?month=2026-02', { token: ctx.superTok });
  assert.strictEqual(board.status, 200);
  const row = board.json.organizations.find((r) => r.organizationId === String(ctx.org._id));
  assert.ok(row, 'the org appears');
  assert.strictEqual(row.issued, true, '2026-02 was issued earlier in this suite');
  assert.ok(board.json.issuedCount >= 1);
  assert.ok(
    !board.json.organizations.some((r) => r.name === 'Doorline Internal'),
    'internal orgs never appear on a revenue surface'
  );

  // A month in the PAST that this suite never issues. It must not be the CURRENT month: the
  // force-issue test above issues currentMonth(), so a hardcoded near-future month silently becomes
  // "issued" the day the wall clock reaches it — which is exactly what happened to 2026-09 on
  // 2026-09-01, turning a green suite red with no code change.
  const unissued = await call('GET', '/super-admin/billing/statements?month=2025-01', { token: ctx.superTok });
  assert.strictEqual(unissued.json.organizations.find((r) => r.organizationId === String(ctx.org._id)).issued, false);

  const denied = await call('GET', '/super-admin/billing/statements?month=2026-02', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(denied.status, 403, 'an org admin cannot see the platform revenue board');

  const bad = await call('GET', '/super-admin/billing/statements?month=nope', { token: ctx.superTok });
  assert.strictEqual(bad.status, 400);
});

// ---- issuing several months at once ---------------------------------------------

test('two months issue in ONE call, each with its own statement and audit event', { skip }, async () => {
  const c = await makeCampaign({ name: 'Two-month client' });
  await visit(c, '2026-01-06T18:00:00Z');
  await visit(c, '2026-02-06T18:00:00Z');

  const before = await SubscriptionEvent.countDocuments({ organizationId: ctx.org._id });
  const res = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statements/issue`, {
    token: ctx.superTok,
    body: { months: ['2026-08', '2026-07'], externalRef: 'INV-778' },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.ok, true);
  assert.strictEqual(res.json.issuedCount, 2);
  // Oldest first, whatever order they arrived in — the audit should read in calendar order.
  assert.deepStrictEqual(res.json.results.map((r) => r.month), ['2026-07', '2026-08']);
  assert.strictEqual(
    res.json.totalCents,
    res.json.results.reduce((sum, r) => sum + r.totalCents, 0),
    'the batch total is the sum of its months'
  );

  const rows = await Statement.find({ organizationId: ctx.org._id, month: { $in: ['2026-07', '2026-08'] }, status: 'issued' }).lean();
  assert.strictEqual(rows.length, 2, 'one frozen statement PER MONTH, never one spanning both');
  assert.ok(rows.every((r) => r.externalRef === 'INV-778'), 'both carry the one invoice number');

  const after = await SubscriptionEvent.countDocuments({ organizationId: ctx.org._id });
  assert.strictEqual(after - before, 2, 'one audit event per month, not one per batch');
});

test('a batch skips an already-issued month and still issues the rest', { skip }, async () => {
  const res = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statements/issue`, {
    token: ctx.superTok,
    body: { months: ['2026-07', '2026-04'] },
  });
  // 200, not an error: a partial batch is a NORMAL outcome and the account manager needs to see
  // which month did what rather than have the whole request rejected.
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.ok, false, 'not every month issued');
  assert.strictEqual(res.json.issuedCount, 1);
  const jul = res.json.results.find((r) => r.month === '2026-07');
  const apr = res.json.results.find((r) => r.month === '2026-04');
  assert.strictEqual(jul.ok, false);
  assert.strictEqual(jul.code, 'ALREADY_ISSUED');
  assert.ok(jul.statementId, 'it points at the statement already standing');
  assert.strictEqual(apr.ok, true, 'April issued anyway');
});

test('a batch refuses the unfinished current month unless forced', { skip }, async () => {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const res = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statements/issue`, {
    token: ctx.superTok,
    body: { months: [thisMonth] },
  });
  assert.strictEqual(res.json.results[0].ok, false);
  assert.strictEqual(res.json.results[0].code, 'MONTH_NOT_ENDED');
});

test('a repeated month in one payload issues once, not twice', { skip }, async () => {
  const res = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statements/issue`, {
    token: ctx.superTok,
    body: { months: ['2026-01', '2026-01'] },
  });
  assert.strictEqual(res.json.results.length, 1, 'deduplicated before issuing');
  assert.strictEqual(res.json.results[0].ok, true);
  const rows = await Statement.countDocuments({ organizationId: ctx.org._id, month: '2026-01', status: 'issued' });
  assert.strictEqual(rows, 1);
});

test('issuing a batch is super-admin only', { skip }, async () => {
  const denied = await call('POST', `/super-admin/organizations/${ctx.org._id}/billing/statements/issue`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { months: ['2026-04'] },
  });
  assert.strictEqual(denied.status, 403);
});

// ---- the per-org history ledger --------------------------------------------------

test('the history ledger reads frozen where issued and live where not, newest first', { skip }, async () => {
  const res = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/history?from=2026-05&to=2026-08`, {
    token: ctx.superTok,
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.months.map((m) => m.month), ['2026-08', '2026-07', '2026-06', '2026-05']);

  const aug = res.json.months.find((m) => m.month === '2026-08');
  assert.strictEqual(aug.issued, true);
  assert.strictEqual(aug.externalRef, 'INV-778');
  assert.ok(aug.issuedBy, 'the ledger names who issued it');

  // Every month carries the lines behind it, so a combined export never re-fetches month by month.
  assert.ok(Array.isArray(aug.lines) && aug.lines.length > 0);
  assert.strictEqual(
    aug.totalCents,
    aug.lines.reduce((sum, l) => sum + l.amountCents, 0),
    'the month total is its own lines'
  );
});

test('the history ledger agrees with the single-month statement route, month for month', { skip }, async () => {
  const hist = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/history?from=2026-03&to=2026-06`, {
    token: ctx.superTok,
  });
  for (const m of hist.json.months) {
    const one = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/statement?month=${m.month}`, {
      token: ctx.superTok,
    });
    const expected = one.json.statement ? one.json.statement.totalCents : one.json.totalCents;
    assert.strictEqual(m.totalCents, expected, `${m.month}: the ledger and the statement page agree`);
  }
});

test('the history ledger is super-admin only', { skip }, async () => {
  const denied = await call('GET', `/super-admin/organizations/${ctx.org._id}/billing/history`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
  });
  assert.strictEqual(denied.status, 403);
});

// ---- the month-close board, over a RANGE -----------------------------------------

test('the month-close board closes a RANGE, and single-month callers are unaffected', { skip }, async () => {
  const board = await call('GET', '/super-admin/billing/statements?from=2026-05&to=2026-07', { token: ctx.superTok });
  assert.strictEqual(board.status, 200);
  assert.strictEqual(board.json.range, true);
  assert.deepStrictEqual(board.json.months, ['2026-05', '2026-06', '2026-07']);

  const row = board.json.organizations.find((r) => r.organizationId === String(ctx.org._id));
  assert.strictEqual(row.months.length, 3, 'one cell per month');
  assert.ok(row.months.every((m) => m.issued), 'all three were issued above');
  assert.strictEqual(
    row.rangeTotalCents,
    row.months.reduce((sum, m) => sum + m.issuedTotalCents, 0),
    'the org range total is its months'
  );

  // The single-month shape is untouched — the range fields are purely additive.
  const single = await call('GET', '/super-admin/billing/statements?month=2026-05', { token: ctx.superTok });
  assert.strictEqual(single.json.range, false);
  const srow = single.json.organizations.find((r) => r.organizationId === String(ctx.org._id));
  assert.strictEqual(srow.issued, true);
  assert.strictEqual(srow.issuedTotalCents, row.months.find((m) => m.month === '2026-05').issuedTotalCents);
});

test('an inverted or malformed range is a 400', { skip }, async () => {
  const bad = await call('GET', '/super-admin/billing/statements?from=2026-07&to=2026-05', { token: ctx.superTok });
  assert.strictEqual(bad.status, 400);
  const worse = await call('GET', '/super-admin/billing/statements?from=nope&to=2026-05', { token: ctx.superTok });
  assert.strictEqual(worse.status, 400);
});

test('deleting an organization takes its statements with it', { skip }, async () => {
  const doomed = await Organization.create({ name: 'Doomed', slug: 'doomed-org', isActive: true });
  await Statement.create({
    organizationId: doomed._id, month: '2026-01', status: 'issued',
    rateCents: 30000, rulesVersion: 3, totalCents: 30000, lines: [],
  });
  const { deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
  await deleteOrganization(doomed);
  assert.strictEqual(await Statement.countDocuments({ organizationId: doomed._id }), 0);
});
