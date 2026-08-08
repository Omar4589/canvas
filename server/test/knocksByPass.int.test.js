import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The per-round billing report ("knocks by pass"), exercised over the REAL Express app +
// a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/knocks_by_pass_test node --test test/knocksByPass.int.test.js
// The point of this file is the ROUND-LEVEL COUNTING CONTRACT: Σ(rounds[].knocks) must
// equal totals.knocks must equal an independent knocksPipeline aggregate run right here
// in the test — a door re-knocked across passes counts once PER pass, a same-pass
// double-knock counts once, legacy passId:null rows collapse into one 'Legacy / no
// pass' bucket that sorts last. coverageGained is FIRST-EVER attribution (a re-knocked
// door never re-gains coverage, and a date window keys off when that first knock
// happened). Also covers ?groupBy=canvasser (raw per-user rounds + the
// crossCanvasserDoors over-claim, bulk rows invisible), both CSV layouts, the lead
// campaignId gate, and parity with GET /admin/campaigns/:id/passes.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-knocks-by-pass';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { knocksPipeline, NOT_BULK, connectionRate, contactRate } = await import(
  '../src/services/reports/aggregations.js'
);
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Campaign days are America/Chicago. R1 + the legacy pair land on DAY1, every R2 knock
// on DAY2 — so a from/to window of DAY2 cleanly isolates round 2 (all timestamps sit
// mid-day in Chicago, nowhere near a boundary).
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-12';

function hh(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Round Rd`,
    city: 'Town',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} ROUND RD|TOWN|TX|75701`,
    location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
    isActive: true,
    status: 'unknocked',
  };
}

function act(hhDoc, userId, actionType, passId, ts, via = null) {
  const [lng, lat] = hhDoc.location.coordinates;
  return {
    organizationId: hhDoc.organizationId,
    campaignId: hhDoc.campaignId,
    householdId: hhDoc._id,
    effortId: hhDoc.effortId,
    userId,
    actionType,
    location: { lat, lng, accuracy: 10 },
    distanceFromHouseMeters: 8,
    timestamp: ts,
    passId,
    via,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Effort, Pass, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Rounds Org', slug: 'rounds-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ra@t.co', passwordHash: 'x', isActive: true });
  const canvA = await User.create({ firstName: 'Al', lastName: 'Alpha', email: 'rca@t.co', passwordHash: 'x', isActive: true });
  const canvB = await User.create({ firstName: 'Bo', lastName: 'Bravo', email: 'rcb@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'rlead@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canvA._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: canvB._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Rounds C', type: 'survey', state: 'TX', isActive: true,
    timeZone: 'America/Chicago',
  });
  await CampaignManager.create({ campaignId: camp._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1',
    status: 'archived', activatedAt: new Date('2026-06-09T12:00:00Z'), archivedAt: new Date('2026-06-11T12:00:00Z'),
  });
  const pass2 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Round 2',
    status: 'active', activatedAt: new Date('2026-06-11T12:00:00Z'),
  });

  const homes = await Household.insertMany([1, 2, 3, 4, 5, 6, 7].map((n) => hh(org._id, camp._id, effort._id, n)));
  const [d1, d2, d3, d4, d5, d6, d7] = homes;

  // The whole counting matrix in one ledger (DAY1 = R1 + legacy, DAY2 = R2):
  //   d1  cross-ROUND re-knock: R1 by A, then R2 by A       → +1 knock in EACH round
  //   d2  R2 surveyed door (A)                              → R2 surveyedKnocks
  //   d3  the ONE cross-canvasser same-round door (A + B)   → round counts 1, canvassers 1 each
  //   d4  legacy passId:null activity PAIR on one household → one 'Legacy / no pass' knock
  //   d5  genuinely-new R2 door (B, surveyed)               → R2 coverage even in the DAY2 window
  //   d6  admin bulk row (via:'bulk') in R2                 → round totals yes, canvasser rows no
  //   d7  same-canvasser same-round double-knock (A twice)  → counts once
  await CanvassActivity.insertMany([
    act(d1, canvA._id, 'not_home', pass1._id, new Date('2026-06-10T15:00:00Z')),
    act(d4, canvA._id, 'not_home', null, new Date('2026-06-10T16:00:00Z')),
    act(d4, canvA._id, 'refused', null, new Date('2026-06-10T16:30:00Z')),
    act(d1, canvA._id, 'not_home', pass2._id, new Date('2026-06-12T15:00:00Z')),
    act(d2, canvA._id, 'survey_submitted', pass2._id, new Date('2026-06-12T15:10:00Z')),
    act(d3, canvA._id, 'not_home', pass2._id, new Date('2026-06-12T15:30:00Z')),
    act(d3, canvB._id, 'refused', pass2._id, new Date('2026-06-12T16:00:00Z')),
    act(d7, canvA._id, 'not_home', pass2._id, new Date('2026-06-12T16:10:00Z')),
    act(d7, canvA._id, 'not_home', pass2._id, new Date('2026-06-12T16:20:00Z')),
    act(d5, canvB._id, 'survey_submitted', pass2._id, new Date('2026-06-12T16:30:00Z')),
    act(d6, admin._id, 'not_home', pass2._id, new Date('2026-06-12T17:00:00Z'), 'bulk'),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass1, pass2, admin, canvA, canvB, lead,
    d1, d2, d3, d4, d5, d6, d7,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// Raw-text variant for the CSV download (json() would mangle it).
async function callCsv(path, { token, orgId } = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
  });
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition'),
    text: await res.text(),
  };
}

function reportBase() {
  return `campaignId=${ctx.camp._id}`;
}

const roundOf = (json, passId) => json.rounds.find((r) => r.passId === (passId ? String(passId) : null));

test('rounds sum exactly to totals AND to an independent knocksPipeline aggregate', { skip }, async () => {
  const { adminTok, org, camp, pass1, pass2 } = ctx;
  const r = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.campaignId, String(camp._id));
  assert.strictEqual(r.json.timeZone, 'America/Chicago');

  // The same shared pipeline, run directly against the ledger from the test — the
  // report's headline must match this independent recompute exactly.
  const [fresh] = await CanvassActivity.aggregate(
    knocksPipeline({ organizationId: org._id, campaignId: camp._id })
  );
  assert.strictEqual(r.json.totals.knocks, 8, 'campaign billable knocks: 7 doors + d1 re-knocked in R2');
  assert.strictEqual(r.json.totals.knocks, fresh.knocks, 'totals == independent aggregate');
  const sum = r.json.rounds.reduce((s, x) => s + x.knocks, 0);
  assert.strictEqual(sum, r.json.totals.knocks, 'Σ(rounds) == totals');

  // Cross-round re-knock (d1) counts +1 per round; same-round double-knocks (d7 by one
  // canvasser, d3 by two) count once each.
  const r1 = roundOf(r.json, pass1._id);
  const r2 = roundOf(r.json, pass2._id);
  assert.strictEqual(r1.knocks, 1, 'R1: d1 only');
  assert.strictEqual(r2.knocks, 6, 'R2: d1(re-knock) d2 d3 d5 d6 d7 — doubles collapsed');
  assert.strictEqual(r1.status, 'archived');
  assert.strictEqual(r2.status, 'active');
  assert.strictEqual(r2.effortName, 'North');
  assert.strictEqual(r2.roundLabel, 'Pass 2 · Round 2');

  // Facet tallies + totals facets.
  assert.deepStrictEqual(
    { sk: r2.surveyedKnocks, lk: r2.litKnocks, rk: r2.refusedKnocks },
    { sk: 2, lk: 0, rk: 1 },
    'R2 facets: d2+d5 surveyed, d3 refused'
  );
  assert.deepStrictEqual(
    { k: r.json.totals.knocks, sk: r.json.totals.surveyedKnocks, lk: r.json.totals.litKnocks, rk: r.json.totals.refusedKnocks },
    { k: 8, sk: 2, lk: 0, rk: 2 }
  );
});

test('legacy passId:null rows collapse to ONE bucket, labelled, sorted last', { skip }, async () => {
  const { adminTok, org } = ctx;
  const r = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.rounds.length, 3, 'R1 + R2 + legacy');
  const legacy = r.json.rounds[r.json.rounds.length - 1];
  assert.strictEqual(legacy.passId, null);
  assert.strictEqual(legacy.roundLabel, 'Legacy / no pass');
  assert.strictEqual(legacy.knocks, 1, 'the d4 activity PAIR is one knock');
  assert.strictEqual(legacy.refusedKnocks, 1);
  // Sorted: effort asc, round asc, legacy last.
  assert.deepStrictEqual(
    r.json.rounds.map((x) => x.roundNumber),
    [1, 2, null]
  );
});

test('per-round connectionRate/contactRate match the shared formulas', { skip }, async () => {
  const { adminTok, org, pass1, pass2 } = ctx;
  const r = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  const r1 = roundOf(r.json, pass1._id);
  const r2 = roundOf(r.json, pass2._id);
  const legacy = roundOf(r.json, null);

  assert.strictEqual(r2.connectionRate, 33, 'R2: 2 completions / 6 knocks');
  assert.strictEqual(r2.connectionRate, connectionRate(r2), 'matches the shared formula');
  assert.strictEqual(r2.contactRate, 50, 'R2: (2 surveys + 1 refusal) / 6');
  assert.strictEqual(r2.contactRate, contactRate(r2));
  assert.deepStrictEqual({ c: r1.connectionRate, t: r1.contactRate }, { c: 0, t: 0 }, 'R1 all not-home');
  // The legacy refusal reached a person but completed nothing.
  assert.deepStrictEqual({ c: legacy.connectionRate, t: legacy.contactRate }, { c: 0, t: 100 });
  assert.deepStrictEqual(
    { c: r.json.totals.connectionRate, t: r.json.totals.contactRate },
    { c: 25, t: 50 },
    'totals: 2/8 and 4/8'
  );
});

test('coverageGained is FIRST-EVER attribution: a re-knocked door never re-gains coverage', { skip }, async () => {
  const { adminTok, org, pass1, pass2 } = ctx;
  const r = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  const r1 = roundOf(r.json, pass1._id);
  const r2 = roundOf(r.json, pass2._id);
  const legacy = roundOf(r.json, null);

  assert.strictEqual(r1.coverageGained, 1, 'd1 first-ever landed in R1');
  assert.strictEqual(r2.coverageGained, 5, 'd2 d3 d5 d6 d7 — NOT the re-knocked d1');
  assert.strictEqual(legacy.coverageGained, 1, 'd4 first-ever is the legacy pair');
  assert.strictEqual(r.json.totals.coverageGained, 7, '= the campaign\'s distinct knocked doors');
  assert.strictEqual(
    r.json.rounds.reduce((s, x) => s + x.coverageGained, 0),
    r.json.totals.coverageGained,
    'Σ(coverage) == total coverage'
  );
});

test('a date window keys coverage off WHEN the first knock happened', { skip }, async () => {
  const { adminTok, org, pass1, pass2 } = ctx;
  const r = await call(
    'GET',
    `/api/admin/reports/knocks-by-pass?${reportBase()}&from=${DAY2}&to=${DAY2}`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.from, DAY2);

  const r1 = roundOf(r.json, pass1._id);
  const r2 = roundOf(r.json, pass2._id);
  // R1's Pass doc still gets a row (zeros are information); the legacy bucket has no Pass
  // doc and no in-window rows, so it drops out entirely.
  assert.strictEqual(r.json.rounds.length, 2, 'R1 (zeros) + R2; no legacy row in the window');
  assert.strictEqual(r1.knocks, 0);
  assert.strictEqual(r2.knocks, 6, 'every R2 pair is in the DAY2 window');

  // d1's knock is IN the window but its first-ever knock (R1, DAY1) is not: it
  // contributes coverage to NEITHER round. The genuinely-new R2 doors all count.
  assert.strictEqual(r1.coverageGained, 0, 're-knocked d1 gains nothing for R1 here');
  assert.strictEqual(r2.coverageGained, 5, 'd2 d3 d5 d6 d7 first-ever in the window');
  assert.strictEqual(r.json.totals.coverageGained, 5);
  assert.strictEqual(r.json.totals.knocks, 6);
});

test('groupBy=canvasser: raw per-user rounds, bulk rows invisible, crossCanvasserDoors == 1', { skip }, async () => {
  const { adminTok, org, camp, pass1, pass2, admin, canvA, canvB } = ctx;
  const r = await call(
    'GET',
    `/api/admin/reports/knocks-by-pass?${reportBase()}&groupBy=canvasser`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(r.status, 200);
  const rows = r.json.byCanvasser;
  assert.strictEqual(rows.length, 4, 'R1×A, R2×A, R2×B, legacy×A');
  assert.ok(!rows.some((x) => x.userId === String(admin._id)), 'the bulk author gets NO canvasser row');

  const row = (passId, userId) =>
    rows.find((x) => x.passId === (passId ? String(passId) : null) && x.userId === String(userId));
  assert.strictEqual(row(pass1._id, canvA._id).knocks, 1);
  const a2 = row(pass2._id, canvA._id);
  assert.deepStrictEqual(
    { k: a2.knocks, sk: a2.surveyedKnocks, rk: a2.refusedKnocks, c: a2.connectionRate, t: a2.contactRate },
    { k: 4, sk: 1, rk: 0, c: 25, t: 25 },
    'A in R2: d1 d2 d3 d7 (double collapsed); the d3 refusal is B\'s, not A\'s'
  );
  const b2 = row(pass2._id, canvB._id);
  assert.deepStrictEqual(
    { k: b2.knocks, sk: b2.surveyedKnocks, rk: b2.refusedKnocks, c: b2.connectionRate, t: b2.contactRate },
    { k: 2, sk: 1, rk: 1, c: 50, t: 100 }
  );
  assert.strictEqual(row(null, canvA._id).knocks, 1, 'legacy pair is one knock for A');
  assert.strictEqual(a2.firstName, 'Al');
  assert.strictEqual(a2.status, 'active');
  assert.strictEqual(rows[rows.length - 1].roundLabel, 'Legacy / no pass', 'legacy rows sort last here too');

  // The over-claim identity: per round, Σ(canvasser knocks) − NON-BULK round knocks —
  // recomputed here from the ledger — must equal crossCanvasserDoors. Exactly one
  // cross-canvasser door (d3) is staged, so the delta is exactly 1; the bulk d6 door
  // (in round totals, in no canvasser row) must not distort it.
  const nonBulk = await CanvassActivity.aggregate(
    knocksPipeline({ organizationId: org._id, campaignId: camp._id, ...NOT_BULK }, { byPass: true })
  );
  const nonBulkByPass = new Map(nonBulk.map((x) => [String(x._id), x.knocks]));
  const sums = new Map();
  for (const x of rows) sums.set(String(x.passId), (sums.get(String(x.passId)) || 0) + x.knocks);
  let over = 0;
  for (const [key, s] of sums) over += Math.max(0, s - (nonBulkByPass.get(key) || 0));
  assert.strictEqual(over, 1, 'ledger recompute of the over-claim');
  assert.strictEqual(r.json.crossCanvasserDoors, 1);
  assert.strictEqual(r.json.crossCanvasserDoors, over, 'report == recompute');

  // Round totals still include the bulk door.
  assert.strictEqual(roundOf(r.json, pass2._id).knocks, 6, 'bulk d6 stays in the round total');
});

test('CSV default view: exact headers, one row per round, TOTAL row, attachment', { skip }, async () => {
  const { adminTok, org } = ctx;
  const csv = await callCsv(`/api/admin/reports/knocks-by-pass.csv?${reportBase()}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(csv.status, 200);
  assert.ok(csv.type.startsWith('text/csv'), `content-type is csv (${csv.type})`);
  assert.match(csv.disposition, /^attachment/, 'served as a download');

  // Seeded cells contain no commas/quotes, so plain splits are safe here.
  const lines = csv.text.split('\n');
  assert.deepStrictEqual(lines[0].split(','), [
    'Walk list', 'Pass', 'Pass name', 'Pass status', 'Activated (ISO)', 'Archived (ISO)',
    'Knocks', 'Survey doors', 'Lit knocks', 'Refused', 'No soliciting',
    'Connection rate %', 'Contact rate %', 'New homes reached',
  ]);
  assert.strictEqual(lines.length, 5, 'header + R1 + R2 + legacy + TOTAL');
  assert.deepStrictEqual(
    lines[1].split(','),
    ['North', '1', 'Round 1', 'archived', '2026-06-09T12:00:00.000Z', '2026-06-11T12:00:00.000Z', '1', '0', '0', '0', '0', '0', '0', '1']
  );
  assert.deepStrictEqual(
    lines[4].split(','),
    ['TOTAL', '', '', '', '', '', '8', '2', '0', '2', '0', '25', '50', '7'],
    'the TOTAL row is the invoice headline'
  );
});

test('CSV groupBy=canvasser: per-user headers, no TOTAL row (no honest per-user coverage)', { skip }, async () => {
  const { adminTok, org } = ctx;
  const csv = await callCsv(
    `/api/admin/reports/knocks-by-pass.csv?${reportBase()}&groupBy=canvasser`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(csv.status, 200);
  const lines = csv.text.split('\n');
  assert.deepStrictEqual(lines[0].split(','), [
    'Walk list', 'Pass', 'Pass name', 'Canvasser first name', 'Canvasser last name',
    'Email', 'Status', 'Knocks', 'Survey doors', 'Lit knocks', 'Refused', 'No soliciting',
    'Connection rate %', 'Contact rate %',
  ]);
  assert.strictEqual(lines.length, 5, 'header + 4 canvasser×round rows, no TOTAL');
  assert.ok(!lines.some((l) => l.startsWith('TOTAL')), 'no TOTAL row in the canvasser view');
  assert.ok(!csv.text.includes('ra@t.co'), 'the bulk-authoring admin appears nowhere');
});

test('lead gating: granted lead + campaignId 200; lead without campaignId 403; admin without campaignId 400', { skip }, async () => {
  const { adminTok, leadTok, org } = ctx;
  const ok = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: leadTok, orgId: org._id });
  assert.strictEqual(ok.status, 200, 'granted lead with campaignId');
  const bare = await call('GET', '/api/admin/reports/knocks-by-pass', { token: leadTok, orgId: org._id });
  assert.strictEqual(bare.status, 403, 'lead without campaignId hits the router gate');
  const adminBare = await call('GET', '/api/admin/reports/knocks-by-pass', { token: adminTok, orgId: org._id });
  assert.strictEqual(adminBare.status, 400, 'admin without campaignId: the report itself requires one');
});

test('GET /admin/campaigns/:id/passes serves the SAME per-round numbers as the report', { skip }, async () => {
  const { adminTok, org, camp, pass1, pass2 } = ctx;
  const report = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  const passes = await call('GET', `/api/admin/campaigns/${camp._id}/passes`, { token: adminTok, orgId: org._id });
  assert.strictEqual(passes.status, 200);

  for (const passId of [pass1._id, pass2._id]) {
    const reportRow = roundOf(report.json, passId);
    const passRow = passes.json.passes.find((p) => String(p._id) === String(passId));
    assert.ok(passRow, 'pass listed');
    assert.strictEqual(passRow.knockCount, reportRow.knocks, `knocks agree for round ${reportRow.roundNumber}`);
    assert.strictEqual(passRow.surveyedKnocks, reportRow.surveyedKnocks);
    assert.strictEqual(passRow.litKnocks, reportRow.litKnocks);
    assert.strictEqual(passRow.refusedKnocks, reportRow.refusedKnocks);
    assert.strictEqual(passRow.connectionRate, reportRow.connectionRate);
    assert.strictEqual(passRow.contactRate, reportRow.contactRate);
  }
});

// ── Regression tests for the adversarial-review findings. These two MUTATE the ledger
// (second org, second effort) so they run LAST — everything above has already asserted
// against the original fixture by the time they execute.

test('a foreign org\'s campaignId leaks NO round/walk-list metadata', { skip }, async () => {
  const { adminTok, org } = ctx;
  const orgB = await Organization.create({ name: 'Other Org', slug: 'other-org', isActive: true });
  const campB = await Campaign.create({
    organizationId: orgB._id, name: 'Their C', type: 'survey', state: 'KY', isActive: true,
    timeZone: 'America/New_York',
  });
  const effortB = await Effort.create({ organizationId: orgB._id, campaignId: campB._id, name: 'Their Secret Turf' });
  await Pass.create({
    organizationId: orgB._id, campaignId: campB._id, effortId: effortB._id, roundNumber: 1,
    name: 'Their Secret Round', status: 'active', activatedAt: new Date('2026-06-01T12:00:00Z'),
  });

  // Org A's admin probing org B's campaignId: the activity aggregates were always
  // org-scoped, but the Pass/Effort metadata joins must be too — no zero-knock rows
  // carrying another tenant's walk-list/round names may come back.
  const r = await call('GET', `/api/admin/reports/knocks-by-pass?campaignId=${campB._id}`, {
    token: adminTok, orgId: org._id,
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.rounds.length, 0, 'no foreign rounds leak');
  assert.strictEqual(r.json.totals.knocks, 0);
  assert.strictEqual(r.json.totals.coverageGained, 0);
  assert.ok(!JSON.stringify(r.json).includes('Their Secret'), 'no foreign names anywhere in the payload');
});

test('?effortId coverage stays FIRST-EVER-IN-CAMPAIGN: a force-claimed door never re-gains coverage in the new effort', { skip }, async () => {
  const { adminTok, org, camp, pass1, d1 } = ctx;
  // Simulate the force-claim flow: d1 (first-ever knock was effort North, R1, DAY1)
  // gets re-housed into effort South and knocked in South's round; d8 is genuinely new.
  const effortS = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  const passS1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effortS._id, roundNumber: 1, name: 'South 1',
    status: 'active', activatedAt: new Date('2026-06-13T12:00:00Z'),
  });
  const [d8] = await Household.insertMany([{ ...hh(org._id, camp._id, effortS._id, 8) }]);
  const southKnock = (hhDoc, ts) => ({
    ...act(hhDoc, ctx.canvA._id, 'not_home', passS1._id, ts),
    effortId: effortS._id, // the activity is stamped with the door's CURRENT owner
  });
  await CanvassActivity.insertMany([
    southKnock(d1, new Date('2026-06-14T15:00:00Z')),
    southKnock(d8, new Date('2026-06-14T15:30:00Z')),
  ]);

  // Campaign-wide: South 1 gained only d8 (d1's first-ever stays with North R1).
  const full = await call('GET', `/api/admin/reports/knocks-by-pass?${reportBase()}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(roundOf(full.json, passS1._id).knocks, 2, 'both South knocks bill');
  assert.strictEqual(roundOf(full.json, passS1._id).coverageGained, 1, 'only d8 is new to the CAMPAIGN');
  assert.strictEqual(roundOf(full.json, pass1._id).coverageGained, 1, 'd1 stays attributed to North R1');

  // Effort-scoped: the first-knock scan must NOT be effort-scoped, or d1 (whose North
  // knocks are invisible under ?effortId=South) would read as "new" here.
  const scoped = await call(
    'GET',
    `/api/admin/reports/knocks-by-pass?${reportBase()}&effortId=${effortS._id}`,
    { token: adminTok, orgId: org._id }
  );
  const southRow = roundOf(scoped.json, passS1._id);
  assert.strictEqual(scoped.json.rounds.length, 1, 'only South rounds displayed');
  assert.strictEqual(southRow.knocks, 2);
  assert.strictEqual(southRow.coverageGained, 1, 'force-claimed d1 does NOT re-gain coverage in the scoped view');
  assert.strictEqual(
    scoped.json.totals.coverageGained,
    1,
    'totals sum the DISPLAYED rows, not every campaign bucket'
  );
});
