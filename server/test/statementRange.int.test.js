import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// PARITY: monthlyStatementRange() must answer, for every month, exactly what monthlyStatement()
// answers for that month.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/stmtrange_test node --test test/statementRange.int.test.js
//
// This is the whole reason the range function is allowed to exist. It replaces one $match per month
// with one wide $match plus $dateToString month buckets, and drops the needsStartMonthVisitCount
// probe by reading that fact out of the bucket map instead. Every one of those is a chance to be
// subtly wrong in a way that only shows up as an invoice disagreeing with the history that is
// supposed to be evidence of it — so the assertion is deepStrictEqual on the whole statement, not a
// spot check on totals.
//
// Every date is FIXED, for the same reason the rest of the billing suite fixes them: a wall-clock
// fixture makes the graces fire (or not) depending on the day CI runs.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-stmtrange';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Statement } = await import('../src/models/Statement.js');
const { monthlyStatement, monthlyStatementRange, monthsBetween, publicMonthHistory, historyRange } =
  await import('../src/services/billing/statement.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Campaign, Household, CanvassActivity, Subscription, Statement]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Range Org', slug: 'range-org', isActive: true });
  const user = await User.create({
    firstName: 'Ray', lastName: 'Range', email: 'range@t.co', passwordHash: 'x', isActive: true,
  });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });
  Object.assign(ctx, { org, userId: user._id });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

let seq = 0;
async function makeCampaign({ name, tz = 'America/New_York', archivedAt = null, rate = undefined } = {}) {
  seq += 1;
  return Campaign.create({
    organizationId: ctx.org._id,
    name: name || `Range camp ${seq}`,
    type: 'survey',
    state: 'KY',
    timeZone: tz,
    isActive: !archivedAt,
    archivedAt,
    ...(rate === undefined ? {} : { pricePerCampaignCents: rate }),
  });
}

// A door. `household` reuses an existing one so the (household, pass) dedup can actually be
// exercised — the thing most likely to differ between a windowed run and a bucketed one.
async function visit(campaign, iso, { actionType = 'not_home', via, household, passId } = {}) {
  seq += 1;
  const hh =
    household ||
    (await Household.create({
      organizationId: ctx.org._id,
      campaignId: campaign._id,
      addressLine1: `${seq} Range St`,
      city: 'Town',
      state: 'KY',
      zipCode: '40002',
      normalizedAddress: `${seq} RANGE ST|TOWN|KY|40002`,
      location: { type: 'Point', coordinates: [-84.5, 38.0] },
    }));
  await CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    householdId: hh._id,
    userId: ctx.userId,
    actionType,
    ...(via ? { via } : {}),
    ...(passId ? { passId } : {}),
    timestamp: new Date(iso),
    location: { lat: 38.0, lng: -84.5 },
  });
  return hh;
}

// The assertion this file exists for.
async function assertParity(from, to, label) {
  const range = await monthlyStatementRange(ctx.org._id, { from, to });
  const months = monthsBetween(from, to);
  assert.deepStrictEqual(
    range.statements.map((s) => s.month),
    months,
    `${label}: the range covers exactly the requested months`
  );
  for (const month of months) {
    const single = await monthlyStatement(ctx.org._id, month);
    const fromRange = range.statements.find((s) => s.month === month);
    // Lines are ordered by campaign createdAt in both paths, so a straight deep-equal is legal.
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(fromRange)),
      JSON.parse(JSON.stringify(single)),
      `${label}: ${month} must be identical to the single-month statement`
    );
  }
  return range;
}

// ---- the fixture: one campaign per rule the range path could break ---------------

test('fixture: campaigns spanning every billing rule', { skip }, async () => {
  // 1. An ordinary campaign, still running. Bills from March onward, forever.
  const ordinary = await makeCampaign({ name: 'Ordinary' });
  await visit(ordinary, '2026-03-10T18:00:00Z');
  await visit(ordinary, '2026-04-14T18:00:00Z');
  // A door re-knocked in the SAME month and pass — must dedup to one, in that month only.
  const repeat = await visit(ordinary, '2026-05-02T18:00:00Z');
  await visit(ordinary, '2026-05-03T18:00:00Z', { household: repeat });
  // The SAME door again in a LATER month — one door in each month, not one overall.
  await visit(ordinary, '2026-06-03T18:00:00Z', { household: repeat });

  // 2. Start grace: first visit in the last 7 days of March → March free, April onward billable.
  const lateStart = await makeCampaign({ name: 'Late start' });
  await visit(lateStart, '2026-03-27T18:00:00Z');
  await visit(lateStart, '2026-04-06T18:00:00Z');

  // 3. End grace: archived in the first 3 days of May with nobody out that month.
  const endGrace = await makeCampaign({ name: 'End grace', archivedAt: new Date('2026-05-02T15:00:00Z') });
  await visit(endGrace, '2026-03-09T18:00:00Z');
  await visit(endGrace, '2026-04-09T18:00:00Z');

  // 4. THE FLOOR, and the corner the range path optimises away: first visit Apr 28 (start grace →
  //    May), archived May 2 with nobody out in May. Both graces fire; the floor makes April bill.
  //    Deciding April needs MAY's visit count — a different month from the one being evaluated.
  const floor = await makeCampaign({ name: 'Floor', archivedAt: new Date('2026-05-02T15:00:00Z') });
  await visit(floor, '2026-04-28T18:00:00Z');

  // 5. A non-New_York campaign whose knock lands on the far side of the tz month boundary:
  //    2026-05-01T05:30Z is April 30, 23:30 in Denver, so it is an APRIL door in both paths.
  const denver = await makeCampaign({ name: 'Denver', tz: 'America/Denver' });
  await visit(denver, '2026-05-01T05:30:00Z');
  await visit(denver, '2026-06-11T18:00:00Z');

  // 6. Desk work only: a via:'bulk' restricted mark must NOT start the clock, in either path.
  const deskOnly = await makeCampaign({ name: 'Desk only' });
  await visit(deskOnly, '2026-04-08T18:00:00Z', { actionType: 'restricted', via: 'bulk' });

  // 7. A FIELD restricted mark does start it — and on a negotiated rate, so the range path is
  //    forced to resolve per-campaign rates rather than multiply the org rate by a count.
  const gated = await makeCampaign({ name: 'Gated', rate: 12500 });
  // No `via` at all is what a canvasser's restricted mark looks like (the enum is [null,'bulk']).
  await visit(gated, '2026-04-15T18:00:00Z', { actionType: 'restricted' });

  // 8. Never been to the field at all.
  await makeCampaign({ name: 'Setup only' });

  const count = await Campaign.countDocuments({ organizationId: ctx.org._id });
  assert.strictEqual(count, 8, 'eight campaigns in the fixture');
});

// ---- parity ---------------------------------------------------------------------

test('every month in a range is identical to its single-month statement', { skip }, async () => {
  await assertParity('2026-02', '2026-07', 'six-month span');
});

test('parity holds across a year boundary and over months with no activity at all', { skip }, async () => {
  await assertParity('2025-11', '2026-02', 'year rollover');
});

test('parity holds for a one-month range', { skip }, async () => {
  await assertParity('2026-04', '2026-04', 'single');
});

// The corner the range path optimises away: the floor needs the NEXT month's visit count, which for
// this range lives outside it. If the aggregation window didn't overrun by a month, April would be
// decided from a bucket map that simply has no May in it.
test('the floor is right even when the range ENDS on the first-visit month', { skip }, async () => {
  const range = await assertParity('2026-03', '2026-04', 'range ending on the floor month');
  const april = range.statements.find((s) => s.month === '2026-04');
  const floorLine = april.lines.find((l) => l.name === 'Floor');
  assert.strictEqual(floorLine.billable, true, 'April bills on the floor');
  assert.strictEqual(floorLine.reason, 'floor');
});

test('a campaign on a negotiated rate keeps it in the range path', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-05', to: '2026-05' });
  const line = range.statements[0].lines.find((l) => l.name === 'Gated');
  assert.strictEqual(line.rateCents, 12500);
  assert.strictEqual(line.amountCents, 12500, 'billed at its own rate, not the org default');
  assert.notStrictEqual(range.statements[0].rateCents, 12500, 'the ORG rate is still the default');
});

test('a desk-only bulk restrict never starts the clock in either path', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-04', to: '2026-06' });
  for (const stmt of range.statements) {
    const line = stmt.lines.find((l) => l.name === 'Desk only');
    assert.strictEqual(line.billable, false, `${stmt.month}: desk work never bills`);
    assert.strictEqual(line.reason, 'no-field-visit');
    assert.strictEqual(line.firstKnockAt, null);
  }
});

test('the tz-boundary knock buckets into April, not May', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-04', to: '2026-05' });
  const april = range.statements.find((s) => s.month === '2026-04').lines.find((l) => l.name === 'Denver');
  const may = range.statements.find((s) => s.month === '2026-05').lines.find((l) => l.name === 'Denver');
  assert.strictEqual(april.knocksThisMonth, 1, 'Apr 30 23:30 MDT is an April door');
  assert.strictEqual(may.knocksThisMonth, 0);
});

test('a door re-knocked in the same month dedups; the same door next month counts again', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-05', to: '2026-06' });
  const may = range.statements.find((s) => s.month === '2026-05').lines.find((l) => l.name === 'Ordinary');
  const jun = range.statements.find((s) => s.month === '2026-06').lines.find((l) => l.name === 'Ordinary');
  assert.strictEqual(may.knocksThisMonth, 1, 'two visits to one door in one month is one door');
  assert.strictEqual(jun.knocksThisMonth, 1, 'the same door in a new month is a new door');
});

// ---- bounds ---------------------------------------------------------------------

test('monthsBetween validates, orders, and caps from the FRONT', { skip }, async () => {
  assert.deepStrictEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.throws(() => monthsBetween('2026-13', '2026-14'), /YYYY-MM/);
  assert.throws(() => monthsBetween('2026-05', '2026-01'), /must not be after/);
  // The cap keeps `to` — the month you actually asked about — and drops the oldest.
  const capped = monthsBetween('2020-01', '2026-12', 24);
  assert.strictEqual(capped.length, 24);
  assert.strictEqual(capped[capped.length - 1], '2026-12');
  assert.strictEqual(capped[0], '2025-01');
});

test('historyRange asks for N months ending with the current one', { skip }, async () => {
  const r = historyRange(3, new Date('2026-09-15T12:00:00Z'));
  assert.deepStrictEqual(r, { from: '2026-07', to: '2026-09' });
  assert.strictEqual(historyRange(999, new Date('2026-09-15T12:00:00Z')).from, '2024-10', 'clamped to the cap');
});

// ---- the customer projection ----------------------------------------------------

test('publicMonthHistory strips EVERY dollar figure, at any depth', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-03', to: '2026-06' });
  const pub = publicMonthHistory(range);

  // The range it was built from definitely HAS money in it — otherwise this proves nothing.
  const rawKeys = [];
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        rawKeys.push(k);
        walk(val);
      }
    }
  })(range);
  assert.ok(rawKeys.some((k) => /Cents$/.test(k)), 'the internal range carries cents fields');

  const leaked = [];
  (function walk(v, path) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/Cents$/.test(k) || k === 'rate' || k === 'amount') leaked.push(`${path}.${k}`);
        walk(val, `${path}.${k}`);
      }
    }
  })(pub, '$');
  assert.deepStrictEqual(leaked, [], 'no dollar figure survives the customer projection');
});

test('publicMonthHistory is newest-first and carries the door numbers a client invoices from', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-03', to: '2026-06' });
  const pub = publicMonthHistory(range);
  assert.deepStrictEqual(pub.months.map((m) => m.month), ['2026-06', '2026-05', '2026-04', '2026-03']);

  const may = pub.months.find((m) => m.month === '2026-05');
  const ordinary = may.campaigns.find((c) => c.name === 'Ordinary');
  assert.strictEqual(ordinary.doors, 1);
  assert.strictEqual(ordinary.knocks, 1);
  assert.strictEqual(may.doors, may.campaigns.reduce((n, c) => n + c.doors, 0), 'the month total is its rows');

  // A campaign that has never been to the field is counted, not listed — the silent rows would
  // otherwise repeat on every month for years.
  assert.ok(!may.campaigns.some((c) => c.name === 'Setup only'), 'setup-only campaigns are not rows');
  assert.ok(may.setupCount >= 1, 'but they are counted');
});

test('a graced month still LISTS the campaign, so the client can see why it was free', { skip }, async () => {
  const range = await monthlyStatementRange(ctx.org._id, { from: '2026-03', to: '2026-03' });
  const march = publicMonthHistory(range).months[0];
  const late = march.campaigns.find((c) => c.name === 'Late start');
  assert.ok(late, 'the start-graced campaign is present');
  assert.strictEqual(late.billable, false);
  assert.strictEqual(late.reason, 'start-grace');
  assert.strictEqual(march.graceCount, 1);
});
