import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The per-canvasser far KPI, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/farkpi node --test test/farKpi.int.test.js
//
// "Far" used to mean three different things: the audit detector's effective-distance rule,
// /summary's raw >75, and /quality's raw >50 (which contradicted its own >75 flagged list).
// Both KPI endpoints now share the detector's farAssessment via services/audit/farKpi.js:
// far = med/high effective distance; honest replaced-chain corrections and post-knock pin
// corrections are forgiven (with farForgivenByPinCount making the forgiveness visible);
// self-moves still count. Lists are ANNOTATED (pinForgiven), never post-filtered, so
// /activities pagination math stays exact.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-far-kpi';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const PIN = { lng: -84.5, lat: 38.0 }; // KY
const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600e3);

function hh(orgId, campaignId, effortId, n, extra = {}) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Kpi Ct`,
    city: 'Town',
    state: 'KY',
    zipCode: '40202',
    normalizedAddress: `${n} KPI CT|TOWN|KY|40202`,
    location: { type: 'Point', coordinates: [PIN.lng, PIN.lat] },
    isActive: true,
    status: 'unknocked',
    ...extra,
  };
}

function act(orgId, campaignId, home, userId, { d, accuracy = 5, atHours = 2, loc, ...extra } = {}) {
  return {
    organizationId: orgId,
    campaignId,
    householdId: home._id,
    userId,
    actionType: 'not_home',
    timestamp: hoursAgo(atHours),
    location: loc || { lat: PIN.lat, lng: PIN.lng, accuracy },
    distanceFromHouseMeters: d,
    ...extra,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Kpi Org', slug: 'kpi-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ka@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'kc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Kpi C', type: 'survey', state: 'KY', isActive: true });
  const eff = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'E' });

  // One household per case. The two pin-corrected ones get corrected AFTER the knocks (1h ago
  // vs knocks at 2h ago); their knock GPS sits ON the (corrected) pin coordinate.
  const homes = await Household.insertMany([
    hh(org._id, camp._id, eff._id, 1), // NEAR
    hh(org._id, camp._id, eff._id, 2), // FAR MED
    hh(org._id, camp._id, eff._id, 3), // FAR HIGH
    hh(org._id, camp._id, eff._id, 4), // ACCURACY-WEAK
    hh(org._id, camp._id, eff._id, 5), // 50/75 WITNESS
    hh(org._id, camp._id, eff._id, 6, { coordSource: 'corrected', correctedAt: hoursAgo(1), correctedBy: admin._id }), // FORGIVEN
    hh(org._id, camp._id, eff._id, 7, { coordSource: 'corrected', correctedAt: hoursAgo(1), correctedBy: canv._id }), // SELF-MOVE
    hh(org._id, camp._id, eff._id, 8), // REPLACED-CHAIN LOW
    hh(org._id, camp._id, eff._id, 9), // BULK
    hh(org._id, camp._id, eff._id, 10), // OLD FAR (date-window case)
  ]);
  const [hNear, hMed, hHigh, hWeak, hWitness, hForgiven, hSelf, hReplaced, hBulk, hOld] = homes;

  // Distinct timestamps per row: /activities sorts on timestamp, and Mongo's skip/limit is
  // unstable across tied sort keys — identical stamps made the pagination test flaky.
  await CanvassActivity.insertMany([
    act(org._id, camp._id, hNear, canv._id, { d: 10, atHours: 2.0 }),
    act(org._id, camp._id, hMed, canv._id, { d: 100, atHours: 2.1 }), // effective 95 → med → COUNTS
    act(org._id, camp._id, hHigh, canv._id, { d: 300, atHours: 2.2, accuracy: null, loc: { lat: PIN.lat, lng: PIN.lng, accuracy: null } }), // high → COUNTS
    act(org._id, camp._id, hWeak, canv._id, { d: 100, atHours: 2.3, accuracy: 60, loc: { lat: PIN.lat, lng: PIN.lng, accuracy: 60 } }), // effective 40 → NOT far
    act(org._id, camp._id, hWitness, canv._id, { d: 60, atHours: 2.4 }), // raw 60 ≤ 75 → in NEITHER count NOR list (old /quality's >50 would have counted it)
    act(org._id, camp._id, hForgiven, canv._id, { d: 200, atHours: 2.5 }), // pin corrected after, GPS on pin → FORGIVEN
    act(org._id, camp._id, hSelf, canv._id, { d: 200, atHours: 2.6 }), // self-move → still COUNTS (med)
    act(org._id, camp._id, hReplaced, canv._id, {
      d: 150,
      atHours: 2.7,
      replaced: {
        actionType: 'restricted',
        timestamp: hoursAgo(2.9),
        location: { lat: PIN.lat, lng: PIN.lng, accuracy: 5 },
        distanceFromHouseMeters: 5,
        nearest: { distanceFromHouseMeters: 5, accuracy: 5, timestamp: hoursAgo(2.9) },
      },
    }), // honest correction → low → excluded, NOT pin-forgiven
    act(org._id, camp._id, hBulk, canv._id, { d: 500, atHours: 2.8, via: 'bulk' }), // excluded from EVERYTHING
    act(org._id, camp._id, hOld, canv._id, { d: 400, atHours: 240 }), // 10 days ago → date-window case
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, canv, admin, adminTok: signUserToken(admin), hForgiven, hWitness });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(path) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// All-time expectations: 9 non-bulk rows total (bulk excluded); far = MED + HIGH + SELF + OLD = 4;
// forgiven = 1 (the pin-corrected-by-admin knock).

test('/summary: detector-rule far count, forgiven surfaced, denominator unchanged', { skip }, async () => {
  const res = await call(`/admin/reports/canvassers/${ctx.canv._id}/summary?campaignId=${ctx.camp._id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const q = res.json.quality;
  assert.strictEqual(q.totalActivities, 9, 'bulk excluded; everything else in the denominator');
  assert.strictEqual(q.farFromHouseCount, 4, 'med + high + self-move + old far');
  assert.strictEqual(q.farForgivenByPinCount, 1, 'the pin-forgiven knock is visible, not silent');
  assert.strictEqual(q.farFromHousePercent, Math.round((4 / 9) * 1000) / 10, 'percent = far / ALL non-bulk rows');
  assert.ok(q.distanceHistogram, 'raw histogram untouched');
  assert.ok(q.avgDistanceFromHouseMeters != null, 'avg untouched');
});

test('/quality: same helper, same numbers — the hardcoded-50 split is dead', { skip }, async () => {
  const res = await call(`/admin/reports/canvassers/${ctx.canv._id}/quality?campaignId=${ctx.camp._id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.farFromHouseCount, 4, 'identical to /summary — one rule, one helper');
  assert.strictEqual(res.json.farForgivenByPinCount, 1);
  // The 50/75 witness (d=60): the OLD count (>50) would have included it; the list (>75) never did.
  const listIds = res.json.flaggedActivities.map((a) => a.id);
  const witnessRow = await CanvassActivity.findOne({ householdId: ctx.hWitness._id }).lean();
  assert.ok(!listIds.includes(String(witnessRow._id)), 'a 60 m knock is in NEITHER the count NOR the list');
});

test('/quality: the flagged list is an annotated superset — forgiven rows stay, marked', { skip }, async () => {
  const res = await call(`/admin/reports/canvassers/${ctx.canv._id}/quality?campaignId=${ctx.camp._id}`);
  const list = res.json.flaggedActivities;
  // Raw >75-or-offline superset: med, high, weak(raw 100), forgiven, self, replaced, old = 7 rows.
  assert.strictEqual(list.length, 7, 'annotate-not-filter: nothing dropped from the list');
  const forgivenRow = await CanvassActivity.findOne({ householdId: ctx.hForgiven._id }).lean();
  const forgiven = list.find((a) => a.id === String(forgivenRow._id));
  assert.ok(forgiven, 'the forgiven row still APPEARS');
  assert.strictEqual(forgiven.pinForgiven, true, '…visibly marked');
  assert.strictEqual(list.filter((a) => a.pinForgiven).length, 1, 'and only that one');
});

test('/activities?flaggedOnly: pagination stays exact; rows are annotated', { skip }, async () => {
  const first = await call(
    `/admin/reports/canvassers/${ctx.canv._id}/activities?campaignId=${ctx.camp._id}&flaggedOnly=true&limit=2&skip=0`
  );
  assert.strictEqual(first.json.total, 7, 'total = the raw DB filter, untouched by forgiveness');

  // Walk every page at limit=2: ids must be disjoint and complete — the annotate-not-filter
  // guarantee. A post-filter would make pages come up short and total lie.
  const seen = new Set();
  let forgivenSeen = 0;
  for (let skipN = 0; skipN < first.json.total; skipN += 2) {
    const page = await call(
      `/admin/reports/canvassers/${ctx.canv._id}/activities?campaignId=${ctx.camp._id}&flaggedOnly=true&limit=2&skip=${skipN}`
    );
    for (const a of page.json.activities) {
      assert.ok(!seen.has(a.id), 'pages never overlap');
      seen.add(a.id);
      if (a.pinForgiven) forgivenSeen += 1;
    }
  }
  assert.strictEqual(seen.size, 7, 'pages cover exactly total rows');
  assert.strictEqual(forgivenSeen, 1, 'the forgiven row rides the feed, annotated');
});

test('date window: helper and aggregations move together (same activityMatch)', { skip }, async () => {
  // A window covering only the recent rows excludes the 10-day-old far knock from BOTH the
  // denominator and the far count — parity is structural (same match object), this proves it.
  const day = (msAgo) => new Date(NOW - msAgo).toISOString().slice(0, 10);
  const from = day(5 * 86400e3);
  const to = day(-86400e3); // tomorrow, so "today" is fully inside the window in any tz
  const res = await call(
    `/admin/reports/canvassers/${ctx.canv._id}/summary?campaignId=${ctx.camp._id}&from=${from}&to=${to}`
  );
  const q = res.json.quality;
  assert.strictEqual(q.totalActivities, 8, 'old row out of the denominator');
  assert.strictEqual(q.farFromHouseCount, 3, 'and out of the far count — no drift between the two');
});

// MUST RUN LAST — it mutates a pin, which changes the all-time numbers the tests above assert.
test('the LIVING NUMBER, end to end: correcting a pin through the real endpoint drops the KPI', { skip }, async () => {
  // A fresh far knock: the pin is ~300 m north of where the canvasser actually stood.
  const wrongPin = { lng: PIN.lng, lat: PIN.lat + 0.0027 };
  const home = await Household.create(
    hh(ctx.org._id, ctx.camp._id, (await Effort.findOne({ campaignId: ctx.camp._id }))._id, 99, {
      location: { type: 'Point', coordinates: [wrongPin.lng, wrongPin.lat] },
    })
  );
  await CanvassActivity.create(
    act(ctx.org._id, ctx.camp._id, home, ctx.canv._id, { d: 300, atHours: 0.5 })
  );

  const before = await call(`/admin/reports/canvassers/${ctx.canv._id}/summary?campaignId=${ctx.camp._id}`);
  assert.strictEqual(before.json.quality.farFromHouseCount, 5, 'the new knock is flagged far');

  // An admin drags the pin onto the real house — the REAL pin-correction endpoint.
  const mv = await fetch(
    `${base}/api/admin/campaigns/${ctx.camp._id}/households/${home._id}/location`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.adminTok}`,
        'X-Org-Id': String(ctx.org._id),
      },
      body: JSON.stringify({ lat: PIN.lat, lng: PIN.lng }),
    }
  );
  assert.strictEqual(mv.status, 200, 'pin moved');

  const after = await call(`/admin/reports/canvassers/${ctx.canv._id}/summary?campaignId=${ctx.camp._id}`);
  assert.strictEqual(after.json.quality.farFromHouseCount, 4, 'the KPI recalculated — living number');
  assert.strictEqual(after.json.quality.farForgivenByPinCount, 2, 'and says why it moved');
});
