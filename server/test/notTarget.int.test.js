import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The "Not a target voter" door disposition (docs/PROPOSAL_NOT_TARGET_OUTCOME.md) — someone answered
// who is not on the list for the address and would not give a name.
//
//   npm run test:int -- test/notTarget.int.test.js
//
// What makes it different from its neighbours, pinned in both directions against a fixture whose
// right answers are known by hand:
//
//   IS a knock         — like every disposition at a reached door: knocks, billable doors,
//                        doors/hour, "homes knocked". (restricted is not.)
//   IS a contact       — someone answered, so it enters the contact rate. (no_soliciting is not.)
//   is NOT a connection — never a survey, so the connection (survey) rate ignores it, exactly as
//                        if the door had been not-home. (survey_submitted is.)
//
// The opt-in setting itself (who can turn it on, the release gate, the replay rule, the phone
// wires) lives in optInOutcomes.int.test.js; the once-per-door contact fold in contactOnce.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-target';
const SAVED_RELEASE = process.env.OPT_IN_OUTCOMES;
process.env.OPT_IN_OUTCOMES = 'not_target';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Voter } = await import('../src/models/Voter.js');
const { KNOCK_ACTIONS, CONTACT_ACTIONS } = await import('../src/services/reports/aggregations.js');
const { resolveStatus, ACTION_TO_STATUS, DOOR_STATUS_LABELS } = await import('../src/utils/statusPrecedence.js');
const { computeWindowStats } = await import('../src/services/reports/computeReport.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const DAY = '2026-04-14';
const KNOCK_AT = new Date('2026-04-14T15:00:00Z');
// Door 7's second visit. Distinct on purpose: resolveStatus is last-write-wins, and two rows
// sharing a timestamp would resolve on aggregation order.
const LATER = new Date('2026-04-14T16:30:00Z');

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Subscription, Household, CanvassActivity, Effort, Pass, CampaignAssignment]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Target Org', slug: 'target-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'nta@t.co', passwordHash: 'x', isActive: true });
  const c1 = await User.create({ firstName: 'Cara', lastName: 'One', email: 'nt1@t.co', passwordHash: 'x', isActive: true });
  const c2 = await User.create({ firstName: 'Cal', lastName: 'Two', email: 'nt2@t.co', passwordHash: 'x', isActive: true });
  // Doorline staff, for the Control Room. Support level is enough to read it; no membership.
  const staff = await User.create({
    firstName: 'Sam', lastName: 'Staff', email: 'nts@t.co', passwordHash: 'x', isActive: true,
    isSuperAdmin: true, platformRole: 'support',
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: c1._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: c2._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Ward 12', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
    enabledOutcomes: ['not_target'], everEnabledOutcomes: ['not_target'],
  });
  // Never turned it on: its files must keep their shape.
  const plain = await Campaign.create({
    organizationId: org._id, name: 'Ward 13', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  const litCampaign = await Campaign.create({
    organizationId: org._id, name: 'Lit Run', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago',
  });
  for (const c of [campaign, plain, litCampaign]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: c._id, userId: c1._id });
  }
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: KNOCK_AT,
  });

  // Fixture, one round, 8 doors:
  //   1 surveyed · 2 refused · 3 not_home · 4,5 not_target · 6 restricted (never a knock)
  //   7 not_target by c1, then not_home by c2 an hour later (ONE door, resolving to not_home —
  //     but someone DID answer there, so it is still a contact)
  //   8 wrong_address
  // ⇒ knocks = 7 doors (1,2,3,4,5,7,8); restrictedDoors = 1 (door 6)
  //   contacts = doors where anyone answered = 1,2,4,5,7 = 5 ⇒ contactRate = round(5/7*100) = 71
  //   connection numerator = surveyed(1) ⇒ connectionRate = round(1/7*100) = 14, unchanged from
  //   the same fixture with every not_target read as not_home
  const doors = [];
  for (let i = 1; i <= 8; i++) {
    doors.push(await Household.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${i} Target St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${i} target st austin tx 78701`,
      location: { type: 'Point', coordinates: [-97.74, 30.26] },
      status: 'unknocked', isActive: true,
    }));
  }

  const act = (household, userId, actionType, extra = {}) =>
    CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: household._id, effortId: effort._id,
      userId, actionType, passId: pass._id, timestamp: KNOCK_AT,
      location: { lat: 30.26, lng: -97.74 }, ...extra,
    });

  await act(doors[0], c1._id, 'survey_submitted');
  await act(doors[1], c1._id, 'refused', { note: 'Declined politely.' });
  await act(doors[2], c1._id, 'not_home');
  await act(doors[3], c1._id, 'not_target', { note: 'Tenant answered; the listed voter moved out.' });
  await act(doors[4], c1._id, 'not_target');
  await act(doors[5], c1._id, 'restricted');
  await act(doors[6], c1._id, 'not_target');
  await act(doors[6], c2._id, 'not_home', { timestamp: LATER });
  await act(doors[7], c1._id, 'wrong_address');

  const statuses = ['surveyed', 'refused', 'not_home', 'not_target', 'not_target', 'restricted', 'not_home', 'wrong_address'];
  for (let i = 0; i < statuses.length; i++) {
    await Household.updateOne({ _id: doors[i]._id }, { status: statuses[i] });
  }

  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, c1, c2, campaign, plain, litCampaign, effort, pass, doors, act,
    adminTok: signUserToken(admin), c1Tok: signUserToken(c1), staffTok: signUserToken(staff),
  });
});

after(async () => {
  if (SAVED_RELEASE === undefined) delete process.env.OPT_IN_OUTCOMES;
  else process.env.OPT_IN_OUTCOMES = SAVED_RELEASE;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, { token, orgId, body, raw } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const get = async (path) => {
  const r = await call('GET', path, auth());
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const csv = async (path) => {
  const r = await call('GET', path, { ...auth(), raw: true });
  assert.equal(r.status, 200, r.text);
  return r.text.replace(/^﻿/, '').trim().split('\n');
};
const cid = () => `campaignId=${ctx.campaign._id}`;
// A door outside the hand-counted fixture, for a test that adds rows and takes them back out
// (in a finally) so every total above keeps its value.
const tempDoor = (n, status) =>
  Household.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id,
    addressLine1: `${n} Temp Way`, city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: `${n} temp way austin tx 78701`,
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status, isActive: true,
  });
const dropTemp = async (doors) => {
  const ids = doors.map((d) => d._id);
  await CanvassActivity.deleteMany({ householdId: { $in: ids } });
  await Household.deleteMany({ _id: { $in: ids } });
};

const EXPECTED_KNOCKS = 7;
// Two units, as for refused — door 7 was marked not_target by one canvasser and not_home by
// another: BY_STATUS speaks the door's resolved status (coverage, the client breakdown, the map);
// KNOCKS speaks "any canvasser recorded it" (the per-outcome report buckets).
const EXPECTED_NOT_TARGET_BY_STATUS = 2; // doors 4, 5
const EXPECTED_NOT_TARGET_KNOCKS = 3; // doors 4, 5, 7
const EXPECTED_CONTACTS = 5; // doors 1, 2, 4, 5, 7
const EXPECTED_CONTACT_RATE = 71; // 5 / 7
const EXPECTED_CONNECTION_RATE = 14; // 1 surveyed / 7

test('the vocabulary: a knock, a contact, a non-completion status with its label', { skip }, () => {
  assert.ok(KNOCK_ACTIONS.includes('not_target'));
  assert.ok(CONTACT_ACTIONS.includes('not_target'));
  assert.equal(ACTION_TO_STATUS.not_target, 'not_target');
  assert.equal(DOOR_STATUS_LABELS.not_target, 'Not a target voter');

  const t0 = new Date('2026-04-14T15:00:00Z');
  const t1 = new Date('2026-04-14T15:05:00Z');
  const at = (actionType, timestamp) => ({ actionType, timestamp });
  // Latest wins in both directions against the other non-completions...
  for (const other of ['refused', 'restricted', 'not_home']) {
    assert.equal(resolveStatus('survey', [at(other, t0), at('not_target', t1)]), 'not_target', `after ${other}`);
    assert.equal(resolveStatus('survey', [at('not_target', t0), at(other, t1)]), ACTION_TO_STATUS[other], `before ${other}`);
  }
  // ...and a survey by anyone makes the round Surveyed, whichever came first.
  assert.equal(resolveStatus('survey', [at('survey_submitted', t0), at('not_target', t1)]), 'surveyed');
  assert.equal(resolveStatus('survey', [at('not_target', t0), at('survey_submitted', t1)]), 'surveyed');
});

test('IS a knock: knocks and billable doors, never a restricted door', { skip }, async () => {
  const kbp = await get(`/admin/reports/knocks-by-pass?${cid()}`);
  assert.equal(kbp.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(kbp.totals.notTargetKnocks, EXPECTED_NOT_TARGET_KNOCKS);
  assert.equal(kbp.totals.restrictedDoors, 1);
  assert.equal(kbp.totals.billableDoors, EXPECTED_KNOCKS);
});

test('IS a contact, NOT a connection: 71% contact, and the survey rate is what not-home would give', { skip }, async () => {
  const ov = await get(`/admin/reports/overview?${cid()}`);
  assert.equal(ov.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(ov.totals.contactKnocks, EXPECTED_CONTACTS);
  assert.equal(ov.totals.contactRate, EXPECTED_CONTACT_RATE);
  assert.equal(ov.totals.connectionRate, EXPECTED_CONNECTION_RATE, 'never a survey');
  // The two wrong answers this pins: dropped from the contacts it would read 29% (2/7); summed
  // per outcome on top of refused it would read 86% (6/7, door 7 counted twice).
  assert.notEqual(ov.totals.contactRate, 29);
  assert.notEqual(ov.totals.contactRate, 86);
});

test('coverage: its own segment, and IS "homes knocked"', { skip }, async () => {
  const ov = await get(`/admin/reports/overview?${cid()}`);
  assert.equal(ov.canvass.not_target, EXPECTED_NOT_TARGET_BY_STATUS);
  assert.equal(ov.totals.homesKnocked, EXPECTED_KNOCKS, 'only the restricted door is held out');
  assert.equal(ov.events.notTarget, EXPECTED_NOT_TARGET_KNOCKS, 'the raw event tally counts door 7 too');

  const ru = await get(`/admin/reports/campaign-rollup?${cid()}`);
  assert.equal(ru.campaigns[0].coverage.not_target, EXPECTED_NOT_TARGET_BY_STATUS, 'the rollup seeds the segment');
  assert.equal(ru.campaigns[0].homesKnocked, EXPECTED_KNOCKS);
});

test('the client report: its own breakdown row, and the breakdown still sums to doors knocked', { skip }, async () => {
  const stats = await computeWindowStats({
    orgId: ctx.org._id,
    campaignId: ctx.campaign._id,
    range: { from: new Date('2026-04-01T00:00:00Z'), to: new Date('2026-04-30T23:59:59Z') },
    campaignType: 'survey',
  });
  assert.equal(stats.totals.doorsKnocked, EXPECTED_KNOCKS);
  assert.equal(stats.contactBreakdown.not_target, EXPECTED_NOT_TARGET_BY_STATUS);
  const sum = Object.values(stats.contactBreakdown).reduce((s, n) => s + n, 0);
  assert.equal(sum, stats.totals.doorsKnocked, 'Σ(contact breakdown) must equal doorsKnocked');
  assert.equal(stats.totals.contactRate, EXPECTED_CONTACT_RATE, 'and the report agrees with the dashboard');
});

test('per-round rows reconcile with the totals they break down', { skip }, async () => {
  const kbp = await get(`/admin/reports/knocks-by-pass?${cid()}`);
  const sum = (k) => kbp.rounds.reduce((s, r) => s + r[k], 0);
  for (const k of ['knocks', 'notTargetKnocks', 'contactKnocks']) assert.equal(sum(k), kbp.totals[k], k);
});

test('the write route: 201 on a survey campaign, refused on lit-drop, replaceable', { skip }, async () => {
  const fresh = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id,
    addressLine1: '42 Fresh Way', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '42 fresh way austin tx 78701',
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status: 'unknocked', isActive: true,
  });
  const litDoor = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.litCampaign._id,
    addressLine1: '7 Lit Ln', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '7 lit ln austin tx 78701',
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status: 'unknocked', isActive: true,
  });
  const post = (id) =>
    call('POST', `/mobile/households/${id}/not-target`, {
      token: ctx.c1Tok, orgId: ctx.org._id,
      body: { location: { lat: 30.26, lng: -97.74, accuracy: 5 } },
    });
  try {
    const r1 = await post(fresh._id);
    assert.equal(r1.status, 201, JSON.stringify(r1.json));
    assert.equal((await Household.findById(fresh._id).lean()).status, 'not_target');
    const r2 = await post(fresh._id);
    assert.ok(r2.status === 200 || r2.status === 201, `expected 2xx, got ${r2.status}`);
    assert.equal(await CanvassActivity.countDocuments({ householdId: fresh._id, userId: ctx.c1._id }), 1, 'replaces, never stacks');

    const lit = await post(litDoor._id);
    assert.equal(lit.status, 400, 'survey campaigns only');
    assert.equal(await CanvassActivity.countDocuments({ householdId: litDoor._id }), 0);
  } finally {
    await CanvassActivity.deleteMany({ householdId: { $in: [fresh._id, litDoor._id] } });
    await Household.deleteMany({ _id: { $in: [fresh._id, litDoor._id] } });
    await recomputeCampaignStats(ctx.campaign._id);
  }
});

test('per-canvasser numbers are exact: in knocks AND in the contact rate', { skip }, async () => {
  const list = await get(`/admin/reports/canvassers?${cid()}`);
  const cara = list.find((c) => String(c.userId) === String(ctx.c1._id));
  const cal = list.find((c) => String(c.userId) === String(ctx.c2._id));
  // Cara: survey, refused, not_home, 3 not_target, wrong_address = 7 knocks (restricted is out);
  // contacts survey + refused + 3 not_target = 5.
  assert.deepEqual(
    { nt: cara.notTarget, k: cara.knocks, r: cara.restricted, rate: cara.contactRate, conn: cara.connectionRate },
    { nt: 3, k: 7, r: 1, rate: 71, conn: 14 }
  );
  assert.deepEqual({ k: cal.knocks, rate: cal.contactRate }, { k: 1, rate: 0 });

  const summary = await get(`/admin/reports/canvassers/${ctx.c1._id}/summary?${cid()}`);
  assert.deepEqual(
    { nt: summary.kpi.notTarget, k: summary.kpi.homesKnocked, rate: summary.kpi.contactRatePct },
    { nt: 3, k: 7, rate: 71 }
  );

  const daily = await get(`/admin/reports/canvassers/${ctx.c1._id}/daily?${cid()}&from=${DAY}&to=${DAY}`);
  assert.equal(daily.days[0].notTarget, 3);
  assert.equal(daily.days[0].homesKnocked, 7);
});

test('the Timeline, in range and totals modes: a real dayNotTarget and a finite contact rate', { skip }, async () => {
  // dayNoSoliciting was summed but never sent, so the column read 0 forever, and this fixture has
  // no no_soliciting row to show it. Cal gets two for this test only: a knock each, never a contact.
  const extra = [await tempDoor(1, 'no_soliciting'), await tempDoor(2, 'no_soliciting')];
  for (const d of extra) await ctx.act(d, ctx.c2._id, 'no_soliciting');
  try {
    for (const mode of [`from=2026-04-13&to=2026-04-15`, 'totals=1']) {
      const tl = await get(`/admin/reports/canvasser-timeline?${cid()}&${mode}`);
      const cara = tl.canvassers.find((c) => c.userId === String(ctx.c1._id));
      assert.deepEqual(
        { nt: cara.dayNotTarget, ns: cara.dayNoSoliciting, k: cara.dayKnocks, rate: cara.contactRate },
        { nt: 3, ns: 0, k: 7, rate: 71 },
        mode
      );
      // Cal: door 7's not_home plus the two no_soliciting doors.
      const cal = tl.canvassers.find((c) => c.userId === String(ctx.c2._id));
      assert.deepEqual(
        { nt: cal.dayNotTarget, ns: cal.dayNoSoliciting, k: cal.dayKnocks, rate: cal.contactRate },
        { nt: 0, ns: 2, k: 3, rate: 0 },
        mode
      );
    }
  } finally {
    await dropTemp(extra);
  }
});

test('canvassers.csv: the Not a target column is present for every org, after Hours source', { skip }, async () => {
  const lines = await csv(`/admin/reports/canvassers.csv?${cid()}`);
  const header = lines.find((l) => l.startsWith('Rank,'));
  assert.ok(header.endsWith('Hours source,Not a target'), header);
  // Cells read BY NAME. Knocks is set membership (KNOCK_ACTIONS); the old hand sum of the named
  // outcome columns had no not_target term and would read 4 knocks at 25% for Cara.
  const cols = header.split(',');
  const row = (firstName) => {
    const cells = lines.find((l) => l.split(',')[cols.indexOf('First name')] === firstName).split(',');
    assert.equal(cells.length, cols.length, `${firstName}'s row is as wide as the header`);
    const cell = (name) => Number(cells[cols.indexOf(name)]);
    return { k: cell('Knocks'), conn: cell('Connection rate %'), nt: cell('Not a target') };
  };
  assert.deepEqual(row('Cara'), { k: 7, conn: 14, nt: 3 });
  assert.deepEqual(row('Cal'), { k: 1, conn: 0, nt: 0 });
});

// Three routes keep a HAND COPY of KNOCK_ACTIONS: routes/mobile/me.js, routes/admin/memberships.js
// and routes/superAdmin/platform.js. A copy missing an outcome silently stops counting that door on
// its screen and nothing else fails, so each copy is pinned against the fixture.
test("the phone's own day (/mobile/me) counts it: knocked, not-a-target and reached homes", { skip }, async () => {
  const r = await call('GET', `/mobile/me/day?${cid()}&since=2026-04-14T00:00:00Z&until=2026-04-15T00:00:00Z`, {
    token: ctx.c1Tok, orgId: ctx.org._id,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // Cara's day: 7 doors and the restricted mark; reached = surveyed ∪ refused ∪ not-target = 1 + 1 + 3.
  assert.deepEqual(
    { d: r.json.doorsKnocked, k: r.json.knockedHomes, nt: r.json.notTargetHomes, reached: r.json.reachedHomes, r: r.json.restricted },
    { d: 7, k: 7, nt: 3, reached: 5, r: 1 }
  );
});

test("the Users-hub member stats count it in the member's doors knocked", { skip }, async () => {
  const s = await get(`/admin/memberships/${ctx.c1._id}/stats`);
  assert.deepEqual({ d: s.doorsKnocked, r: s.restricted }, { d: 7, r: 1 });
});

// Two more copies outside routes/: the phone's history keeps its own per-day sets (me.js /history),
// and the voter profile filters its door-activity list by its own KNOCK_ACTIONS (voterProfile.js).
test("the phone's history (/mobile/me/history) counts it too — its own per-day copy", { skip }, async () => {
  const r = await call('GET', `/mobile/me/history?${cid()}&tz=America%2FChicago`, { token: ctx.c1Tok, orgId: ctx.org._id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const day = r.json.days.find((d) => d.date === DAY);
  assert.ok(day, JSON.stringify(r.json.days));
  // The same day as /mobile/me/day reads it: reached = surveyed ∪ refused ∪ not-target = 1 + 1 + 3.
  assert.deepEqual(
    { d: day.doorsKnocked, k: day.knockedHomes, nt: day.notTargetHomes, reached: day.reachedHomes },
    { d: 7, k: 7, nt: 3, reached: 5 }
  );
});

test('the voter profile lists a Not a target voter knock at their door, with its note', { skip }, async () => {
  // A listed voter at door 4, where someone else answered. Taken back out in the finally.
  const voter = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[3]._id,
    stateVoterId: 'NT-PROFILE-1', firstName: 'Lena', lastName: 'Listed', fullName: 'Lena Listed',
  });
  try {
    const r = await call('GET', `/admin/voters/${voter._id}`, auth());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const knocks = r.json.activity.map((a) => ({ actionType: a.actionType, note: a.note }));
    assert.deepEqual(knocks, [{ actionType: 'not_target', note: 'Tenant answered; the listed voter moved out.' }]);
  } finally {
    await Voter.deleteOne({ _id: voter._id });
  }
});

test("the Control Room counts it in today's doors knocked", { skip }, async () => {
  // "Today" only, and every fixture knock is in April: one not-a-target door knocked now, for this
  // test only.
  const door = await tempDoor(3, 'not_target');
  await ctx.act(door, ctx.c1._id, 'not_target', { timestamp: new Date() });
  try {
    const r = await call('GET', '/super-admin/platform-overview', { token: ctx.staffTok });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.totals.today.doorsKnocked, 1);
  } finally {
    await dropTemp([door]);
  }
});

test('the per-round CSV carries the column only for a campaign that has used the outcome', { skip }, async () => {
  const used = await csv(`/admin/reports/knocks-by-pass.csv?${cid()}`);
  const cols = used[0].split(',');
  assert.equal(cols[cols.indexOf('No soliciting') + 1], 'Not a target', 'right after No soliciting');
  const total = used.find((l) => l.startsWith('TOTAL')).split(',');
  assert.equal(Number(total[cols.indexOf('Not a target')]), EXPECTED_NOT_TARGET_KNOCKS);

  const never = await csv(`/admin/reports/knocks-by-pass.csv?campaignId=${ctx.plain._id}`);
  assert.ok(!never[0].includes('Not a target'), `a campaign that never used it keeps its file shape: ${never[0]}`);
  const json = await get(`/admin/reports/knocks-by-pass?campaignId=${ctx.plain._id}`);
  assert.equal(json.notTargetInUse, false);
});

test('the map: counts the status, and filters by it', { skip }, async () => {
  const counts = await get(`/admin/households/map/counts?${cid()}`);
  assert.equal(counts.byStatus.not_target, EXPECTED_NOT_TARGET_BY_STATUS, 'seeded, so the whitelist keeps it');
  const only = await get(`/admin/households/map/counts?${cid()}&status=not_target`);
  assert.equal(only.matching.total, EXPECTED_NOT_TARGET_BY_STATUS, 'the status filter selects exactly those doors');
});

test('the Notes hub filter selects only its notes — never every note', { skip }, async () => {
  const r = await get(`/admin/reports/notes?${cid()}&actionType=not_target`);
  assert.deepEqual(r.notes.map((n) => n.note), ['Tenant answered; the listed voter moved out.']);
  assert.equal(r.notes[0].actionType, 'not_target');
});

test('exports: doors-by-round accepts the status as a round-status filter', { skip }, async () => {
  const params = await EXPORT_TYPES['doors-by-round'].validateParams(
    { roundStatuses: ['not_target'] },
    { campaignId: ctx.campaign._id, organizationId: ctx.org._id }
  );
  assert.deepEqual(params.roundStatuses, ['not_target']);
});

test('Campaign.stats counters agree with the live pipeline', { skip }, async () => {
  await recomputeCampaignStats(ctx.campaign._id);
  const doc = await Campaign.findById(ctx.campaign._id, { stats: 1 }).lean();
  assert.deepEqual(
    { k: doc.stats.knockCount, nt: doc.stats.notTargetKnockCount, ck: doc.stats.contactKnockCount, rd: doc.stats.restrictedDoorCount },
    { k: EXPECTED_KNOCKS, nt: EXPECTED_NOT_TARGET_KNOCKS, ck: EXPECTED_CONTACTS, rd: 1 }
  );
});
