import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Campaign-to-date mode on /admin/reports/canvasser-timeline, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/tltot node --test test/timelineTotals.int.test.js
//
// The Timeline defaults to TODAY and is capped at 62 days, because a range renders one grid
// column per day. That makes it impossible to see a whole campaign — so a canvasser who worked
// it and then left is invisible, even though their knocks are in every total and on the invoice.
// `?totals=1` lifts the cap by shipping no grid.
//
// The assertions that matter are the COUNTING ones:
//   · totals mode == the sum of range mode's buckets, per canvasser, field by field;
//   · billableKnocks is IDENTICAL in both modes;
//   · a door two canvassers both worked bills ONCE but shows on BOTH their rows — proving we
//     did not route per-canvasser counts through knocksPipeline (which collapses across users);
//   · hoursOnDoors stays the sum of per-DAY spans and does not become "first knock ever to last".
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-timeline-totals';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
const TZ = 'America/New_York';
let server;
let base;
const ctx = {};

async function call(path, token, orgId) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
  });
  return { status: res.status, json: await res.json() };
}

// A knock at 10:00 ET on the given civil day.
function at(ymd, hour = 10) {
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00-05:00`);
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CanvassActivity,
    Household, Effort, Pass,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const boss = await User.create({
    firstName: 'Boss', lastName: 'X', email: 'boss@t.co',
    passwordHash: await User.hashPassword(PW), isActive: true,
  });
  // Ann is still on the team. Bob quit: deactivated AND removed from the campaign. His knocks
  // must still be here — that is the entire point.
  const ann = await User.create({
    firstName: 'Ann', lastName: 'A', email: 'ann@t.co',
    passwordHash: await User.hashPassword(PW), isActive: true,
  });
  const bob = await User.create({
    firstName: 'Bob', lastName: 'B', email: 'bob@t.co',
    passwordHash: await User.hashPassword(PW), isActive: true,
  });
  await Membership.create({ userId: boss._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: ann._id, organizationId: org._id, role: 'canvasser', isActive: true });
  // Bob: deactivated. He was never given a CampaignAssignment back, i.e. removed from the campaign.
  await Membership.create({ userId: bob._id, organizationId: org._id, role: 'canvasser', isActive: false });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'GOTV', type: 'survey', state: 'FL',
    isActive: true, timeZone: TZ,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });

  const homes = await Household.insertMany([1, 2, 3, 4].map((n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Elm St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} ELM ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  })));

  const knock = (user, home, ymd, hour, actionType) => CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, userId: user._id, actionType, timestamp: at(ymd, hour),
    location: { lat: 28.3, lng: -81.4 },
  });

  // Two days, ~10 weeks apart — deliberately WIDER than the 62-day cap, so range mode cannot
  // even be asked for the pair. Only totals mode can see both.
  const D1 = '2026-01-05';
  const D2 = '2026-03-20';

  // Ann: two doors on D1 (9:00 and 12:00 → a 3h span), one on D2.
  await knock(ann, homes[0], D1, 9, 'not_home');
  await knock(ann, homes[1], D1, 12, 'survey_submitted');
  await knock(ann, homes[2], D2, 10, 'not_home');

  // Bob (the departed one): one door on D1...
  await knock(bob, homes[3], D1, 11, 'not_home');
  // ...and the SAME door Ann already worked in the SAME pass. This is an overlap: it bills ONCE
  // campaign-wide, but must appear on BOTH canvassers' rows.
  await knock(bob, homes[0], D1, 15, 'not_home');

  Object.assign(ctx, { org, boss, ann, bob, campaign, D1, D2 });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.token = signUserToken(boss);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a >62-day range is still rejected — the grid cannot render it', { skip }, async () => {
  const { campaign, token, org, D1, D2 } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=${D1}&to=${D2}`, token, org._id
  );
  assert.equal(res.status, 400, 'the cap still guards the bucketed grid');
});

test('totals mode lifts the cap and shows the WHOLE campaign', { skip }, async () => {
  const { campaign, token, org, ann, bob } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1`, token, org._id
  );
  assert.equal(res.status, 200);
  assert.equal(res.json.mode, 'totals');
  assert.deepEqual(res.json.range, { from: null, to: null }, 'unbounded = campaign-to-date');

  const byId = new Map(res.json.canvassers.map((c) => [String(c.userId), c]));
  assert.equal(byId.size, 2, 'BOTH canvassers appear — including the one who quit');

  const a = byId.get(String(ann._id));
  const b = byId.get(String(bob._id));
  assert.ok(b, 'Bob is deactivated AND off the campaign roster, and is still on the report');
  assert.equal(b.firstName, 'Bob', 'with his name, not a blank');
  assert.equal(b.status, 'deactivated', 'his standing is reported honestly...');
  assert.equal(b.dayKnocks, 2, '...and every door he knocked still counts');
  assert.equal(a.dayKnocks, 3);

  // No grid payload — that is what lets the cap go.
  assert.equal(res.json.canvassers[0].knocksByDay, undefined);
  assert.equal(res.json.canvassers[0].knocksByHour, undefined);
  assert.equal(res.json.days, undefined);
});

test('a door two canvassers worked bills ONCE but counts on BOTH rows', { skip }, async () => {
  const { campaign, token, org } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1`, token, org._id
  );
  // 5 raw knock rows across 4 distinct (household, pass) pairs — homes[0] was worked twice.
  assert.equal(res.json.grandKnocks, 5, 'per-canvasser knocks sum to the raw count');
  assert.equal(res.json.billableKnocks, 4, 'but the invoice counts that door once');
  assert.equal(res.json.overlapDoors, 1);
  // THE guard: if anyone ever routes per-canvasser counts through knocksPipeline (which dedupes
  // by household×pass and collapses ACROSS users), grandKnocks would collapse to 4 and every
  // canvasser's number would quietly change. It must not.
  assert.ok(
    res.json.grandKnocks > res.json.billableKnocks,
    'per-canvasser totals are RAW counts, never the deduped billable pipeline'
  );
  assert.equal(res.json.overlapsOmitted, true, 'the expensive per-door cards are skipped...');
  assert.equal(res.json.overlapCount, 0, '...but the door COUNT above is still honest');
});

test('totals == the sum of range-mode buckets, field by field', { skip }, async () => {
  const { campaign, token, org, D1 } = ctx;
  // A window that FITS the cap, so both modes can answer it. They must agree exactly.
  const q = `campaignId=${campaign._id}&from=${D1}&to=${D1}`;
  const [range, totals] = await Promise.all([
    call(`/admin/reports/canvasser-timeline?${q}`, token, org._id),
    call(`/admin/reports/canvasser-timeline?${q}&totals=1`, token, org._id),
  ]);
  assert.equal(range.status, 200);
  assert.equal(totals.status, 200);

  const rById = new Map(range.json.canvassers.map((c) => [String(c.userId), c]));
  const tById = new Map(totals.json.canvassers.map((c) => [String(c.userId), c]));
  assert.equal(rById.size, tById.size);

  const FIELDS = [
    'dayKnocks', 'daySurveys', 'dayLit', 'refused', 'notHome', 'wrongAddress',
    'dayRestricted', 'hoursOnDoors', 'doorsPerHour', 'connectionRate',
  ];
  for (const [uid, r] of rById) {
    const t = tById.get(uid);
    assert.ok(t, `${uid} is in both modes`);
    for (const f of FIELDS) {
      assert.equal(t[f], r[f], `${f} matches for ${r.firstName} (${uid})`);
    }
  }
  assert.equal(totals.json.billableKnocks, range.json.billableKnocks, 'the invoice number is mode-independent');
  assert.equal(totals.json.grandKnocks, range.json.grandKnocks);
});

test('hoursOnDoors stays a sum of per-DAY spans, not first-ever to last-ever', { skip }, async () => {
  const { campaign, token, org, ann } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1`, token, org._id
  );
  const a = res.json.canvassers.find((c) => String(c.userId) === String(ann._id));
  // Ann worked 9:00–12:00 on D1 (3h) and a single knock on D2 (0h), ~10 weeks apart. If totals
  // mode had grouped on userId alone, this would read ~1,800 hours instead of 3 — and doors/hour
  // would collapse to ~0. That is exactly the trap the day-bucket preserves us from.
  assert.equal(a.hoursOnDoors, 3, 'three hours, not ten weeks');
  assert.ok(a.doorsPerHour > 0 && a.doorsPerHour <= 3, `doors/hour stays sane (${a.doorsPerHour})`);
});

test('survey DOORS are deduped server-side; the raw per-canvasser sum is not the door count', { skip }, async () => {
  // The production bug this pins: the Timeline KPI card summed the per-canvasser "Survey doors"
  // column in the browser and labelled the result "Doors with a survey". On a real campaign that
  // read 990 where the campaign total was 986 — four doors that two canvassers had each surveyed,
  // counted twice. Doors were already deduped server-side for exactly this reason; surveys were
  // not, so the connection rate also divided a RAW numerator by a DEDUPED denominator.
  //
  // Its own campaign, so the calibrated fixture above keeps its absolute numbers.
  const { org, boss, ann, bob, token } = ctx;
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Sign Push', type: 'survey', state: 'FL', isActive: true, timeZone: TZ,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'South' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });
  const homes = await Household.insertMany([1, 2].map((n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Sign Way`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} SIGN WAY|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.5 + n * 0.001, 28.4] },
  })));
  const knock = (user, home, hour, actionType) => CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, userId: user._id, actionType, timestamp: at('2026-02-10', hour),
    location: { lat: 28.4, lng: -81.5 },
  });

  // BOTH canvassers survey door 1 (the overlap); only Ann surveys door 2.
  await knock(ann, homes[0], 9, 'survey_submitted');
  await knock(bob, homes[0], 14, 'survey_submitted');
  await knock(ann, homes[1], 10, 'survey_submitted');

  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&totals=1`, token, org._id
  );
  assert.equal(res.status, 200);

  // The raw sum — what the card used to show. Still reported, still correct as an EVENT count.
  assert.equal(res.json.grandSurveys, 3, 'three survey events across the two canvassers');
  const rowSum = res.json.canvassers.reduce((n, c) => n + (c.daySurveys || 0), 0);
  assert.equal(rowSum, 3, 'and it is exactly what summing the per-canvasser column gives');

  // The number to put in front of a client: two distinct doors.
  assert.equal(res.json.billableSurveyDoors, 2, 'survey DOORS dedupe the shared door');
  assert.ok(
    res.json.billableSurveyDoors < rowSum,
    'the deduped door count is strictly below the raw sum whenever canvassers overlap — ' +
    'which is precisely why the card cannot compute it client-side'
  );

  // The survey-side twin of billableKnocks: same dedup, same (household, pass) key, so the
  // connection rate is now a deduped numerator over a deduped denominator.
  assert.equal(res.json.billableKnocks, 2, 'two distinct doors knocked');
  assert.ok(
    res.json.billableSurveyDoors <= res.json.billableKnocks,
    'survey doors are a SUBSET of knocked doors, so the rate can never exceed 100%'
  );
});
