import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The contact rate counts each door ONCE (docs/PROPOSAL_NOT_TARGET_OUTCOME.md §E.2), over the REAL
// Express app + throwaway mongod:
//   npm run test:int -- test/contactOnce.int.test.js
//
// The bug this pins: contactRate used to be (surveyedKnocks + refusedKnocks) / knocks, where each
// term is an independent per-door flag. A door where canvasser A surveyed and canvasser B was
// refused in the same round counted twice — the rate read 200% on a one-door campaign. Now every
// surface folds "someone answered" per (door, round) with CONTACT_ACTIONS, so:
//
//   d1: A surveys, B is refused        → one contact
//   d2: D is refused, then C records Not a target voter → one contact
//   d3: A, not home                    → a knock, no contact
//
// knocks 3, contacts 2 → 67% on EVERY campaign-level surface (the old formula read 100%, and with
// not_target summed in too it would read 133%). Per canvasser: A 1 of 2 → 50%; B, C, D 100%.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-contact-once';
const SAVED_RELEASE = process.env.OPT_IN_OUTCOMES;
process.env.OPT_IN_OUTCOMES = 'not_target';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { contactRate } = await import('../src/services/reports/aggregations.js');
const { computeWindowStats } = await import('../src/services/reports/computeReport.js');
const { computeImpact } = await import('../src/services/canvass/reclassifyOutcomes.js');
const { computeUnknockImpact } = await import('../src/services/canvass/unknock.js');
const { computeCampaignStats, recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const hh = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Contact Ct`,
  city: 'Town',
  state: 'FL',
  zipCode: '34741',
  normalizedAddress: `${n} CONTACT CT|TOWN|FL|34741`,
  location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  isActive: true,
  status: 'unknocked',
});

const call = async (method, path, { token, orgId, body } = {}) => {
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
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};

const loc = { lat: 28.3001, lng: -81.399, accuracy: 8 };
let minute = 0;
const nextTs = () => {
  minute += 1;
  return new Date(Date.now() - 3600_000 + minute * 60_000).toISOString();
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription]) {
    await M.deleteMany({});
  }

  // teamAttributionReadyAt: the crew backfill has run, so /team-breakdown reports.
  const org = await Organization.create({ name: 'Contact Org', slug: 'contact-org', isActive: true, teamAttributionReadyAt: new Date() });
  // Not co<letter>@ — those are the canvassers' addresses below (A's would be coa@, the same as this).
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'co-admin@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const people = {};
  for (const key of ['A', 'B', 'C', 'D']) {
    people[key] = await User.create({ firstName: key, lastName: 'Walker', email: `co${key.toLowerCase()}@t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: people[key]._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'C Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Contact C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
    surveyTemplateId: template._id, enabledOutcomes: ['not_target'], everEnabledOutcomes: ['not_target'],
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany([1, 2, 3].map((n) => hh(org._id, camp._id, effort._id, n)));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book C', mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of Object.values(people)) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
    await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[0]._id, stateVoterId: 'FLC1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const tok = Object.fromEntries(Object.entries(people).map(([k, u]) => [k, signUserToken(u)]));
  Object.assign(ctx, { org, camp, pass, people, tok, adminTok: signUserToken(admin), d1: homes[0], d2: homes[1], d3: homes[2] });

  const knock = (who, door, kind) =>
    call('POST', `/mobile/households/${door._id}/${kind}`, { token: tok[who], orgId: org._id, body: { location: loc, timestamp: nextTs() } });
  const writes = [
    () => call('POST', `/mobile/voters/${voter._id}/survey`, {
      token: tok.A, orgId: org._id,
      body: { surveyTemplateId: String(template._id), answers: [], location: loc, timestamp: nextTs() },
    }),
    () => knock('B', homes[0], 'refused'),
    () => knock('D', homes[1], 'refused'),
    () => knock('C', homes[1], 'not-target'),
    () => knock('A', homes[2], 'not-home'),
  ];
  for (const w of writes) {
    const r = await w();
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  }
});

after(async () => {
  if (SAVED_RELEASE === undefined) delete process.env.OPT_IN_OUTCOMES;
  else process.env.OPT_IN_OUTCOMES = SAVED_RELEASE;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const get = async (path) => {
  const r = await call('GET', path, asAdmin());
  assert.strictEqual(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const q = () => `campaignId=${ctx.camp._id}`;
const byName = (rows, key) => rows.find((r) => r.firstName === key);

test('contactRate requires the folded count — a hand-built object without it is a code bug', () => {
  assert.throws(() => contactRate({ knocks: 3, surveyedKnocks: 1, refusedKnocks: 2 }), TypeError);
  assert.strictEqual(contactRate({ knocks: 0 }), 0, 'no knocks reads 0 before any count is needed');
  assert.strictEqual(contactRate({ knocks: 3, contactKnocks: 2 }), 67);
});

test('/overview and /campaign-rollup: one contact per door, live and from Campaign.stats', { skip }, async () => {
  const check = async (label) => {
    const ov = await get(`/admin/reports/overview?${q()}`);
    assert.deepStrictEqual(
      { k: ov.totals.knocks, ck: ov.totals.contactKnocks, nt: ov.totals.notTargetKnocks, rate: ov.totals.contactRate },
      { k: 3, ck: 2, nt: 1, rate: 67 },
      `${label}: overview`
    );
    assert.strictEqual(ov.events.notTarget, 1);
    assert.strictEqual(ov.canvass.not_target, 1, 'd2 resolves to the later entry, Not a target voter');

    const ru = await get(`/admin/reports/campaign-rollup?${q()}`);
    const row = ru.campaigns[0];
    assert.deepStrictEqual({ ck: row.contactKnocks, rate: row.contactRate, nt: row.notTargetKnocks }, { ck: 2, rate: 67, nt: 1 }, `${label}: rollup row`);
    assert.strictEqual(row.coverage.not_target, 1, `${label}: the coverage bar keeps the door`);
    assert.strictEqual(ru.cumulative.contactRate, 67, `${label}: rollup cumulative`);
  };
  await check('live');
  await recomputeCampaignStats(ctx.camp._id);
  const stats = (await Campaign.findById(ctx.camp._id, { stats: 1 }).lean()).stats;
  assert.ok(stats.reconciledAt, 'stats are now trusted, so the next reads take the counter path');
  assert.strictEqual(stats.contactKnockCount, 2);
  assert.strictEqual((await computeCampaignStats(ctx.camp._id)).contactKnockCount, 2, 'the oracle agrees');
  await check('stats');
});

test('round surfaces: the passes list, /knocks-by-pass rounds + totals, and the team breakdown', { skip }, async () => {
  const passes = await get(`/admin/campaigns/${ctx.camp._id}/passes`);
  assert.strictEqual(passes.passes[0].contactRate, 67);
  assert.strictEqual(passes.passes[0].notTargetKnocks, 1);

  const kbp = await get(`/admin/reports/knocks-by-pass?${q()}`);
  const round = kbp.rounds.find((r) => r.passId === String(ctx.pass._id));
  assert.deepStrictEqual({ ck: round.contactKnocks, rate: round.contactRate }, { ck: 2, rate: 67 });
  assert.deepStrictEqual({ ck: kbp.totals.contactKnocks, rate: kbp.totals.contactRate, nt: kbp.totals.notTargetKnocks }, { ck: 2, rate: 67, nt: 1 });
  assert.strictEqual(kbp.notTargetInUse, true);

  const team = await get(`/admin/reports/team-breakdown?${q()}`);
  assert.strictEqual(team.campaign.contactRate, 67);
  assert.strictEqual(team.teams.length, 1, 'everyone is in the No-team bucket');
  assert.strictEqual(team.teams[0].contactRate, 67, 'the per-team fold counts d1 once too');
});

test('per-canvasser surfaces are exact and unchanged by the fold: A 50%, B, C, D 100%', { skip }, async () => {
  const expected = { A: 50, B: 100, C: 100, D: 100 };

  const kbp = await get(`/admin/reports/knocks-by-pass?${q()}&groupBy=canvasser`);
  for (const [who, rate] of Object.entries(expected)) assert.strictEqual(byName(kbp.byCanvasser, who).contactRate, rate, `by-pass ${who}`);
  assert.strictEqual(byName(kbp.byCanvasser, 'C').notTargetKnocks, 1);

  const list = await get(`/admin/reports/canvassers?${q()}`);
  for (const [who, rate] of Object.entries(expected)) assert.strictEqual(byName(list, who).contactRate, rate, `/canvassers ${who}`);
  assert.deepStrictEqual({ nt: byName(list, 'C').notTarget, k: byName(list, 'C').knocks }, { nt: 1, k: 1 });

  const tl = await get(`/admin/reports/canvasser-timeline?${q()}&totals=1`);
  for (const [who, rate] of Object.entries(expected)) assert.strictEqual(byName(tl.canvassers, who).contactRate, rate, `timeline ${who}`);
  assert.strictEqual(byName(tl.canvassers, 'C').dayNotTarget, 1, 'a real number — a missing $sum would serialize null');

  const sumA = await get(`/admin/reports/canvassers/${ctx.people.A._id}/summary?${q()}`);
  assert.strictEqual(sumA.kpi.contactRatePct, 50);
  const sumC = await get(`/admin/reports/canvassers/${ctx.people.C._id}/summary?${q()}`);
  assert.deepStrictEqual({ rate: sumC.kpi.contactRatePct, nt: sumC.kpi.notTarget, k: sumC.kpi.homesKnocked }, { rate: 100, nt: 1, k: 1 });
});

test('the client report: 67%, and the breakdown partitions Doors knocked with its own row', { skip }, async () => {
  const w = await computeWindowStats({ orgId: ctx.org._id, campaignId: ctx.camp._id, range: {}, campaignType: 'survey' });
  assert.strictEqual(w.totals.contactRate, 67);
  assert.strictEqual(w.totals.notTargetKnocks, 1);
  const sum = Object.values(w.contactBreakdown).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, w.totals.doorsKnocked, 'Σ breakdown === Doors knocked');
  assert.deepStrictEqual(
    { s: w.contactBreakdown.surveyed, nt: w.contactBreakdown.not_target, nh: w.contactBreakdown.not_home },
    { s: 1, nt: 1, nh: 1 }
  );
});

test('the Door Outcomes previews price through the same fold', { skip }, async () => {
  const rowsAt = (door) => CanvassActivity.find({ householdId: door._id }).lean();
  const [d1Rows, d2Rows] = [await rowsAt(ctx.d1), await rowsAt(ctx.d2)];
  const campaign = await Campaign.findById(ctx.camp._id).lean();

  // Changing C's entry to Not home leaves d2 a contact through D's refusal: nothing moves.
  const ntRow = d2Rows.find((r) => r.actionType === 'not_target');
  const change = await computeImpact({ campaign, ids: [ntRow._id], to: 'not_home', billRestricted: false });
  assert.deepStrictEqual([change.before.contactRate, change.after.contactRate], [67, 67]);

  // Striking BOTH of d1's entries removes that door: 1 contact of 2 knocks.
  const strike = await computeUnknockImpact({ campaign, ids: d1Rows.map((r) => r._id), billRestricted: false });
  assert.deepStrictEqual([strike.before.contactRate, strike.after.contactRate], [67, 50]);
});
