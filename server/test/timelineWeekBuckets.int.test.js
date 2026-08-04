import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Week-bucket mode on /admin/reports/canvasser-timeline, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/tlweek node --test test/timelineWeekBuckets.int.test.js
//
// Ranges past TIMELINE_DAY_BUCKET_MAX_DAYS (62) answer with WEEK columns instead of a 400:
// mode stays 'range', `bucket:'week'`, days[] carries Monday week-starts, and the per-canvasser
// maps are keyed by them. The Mongo aggregation still buckets BY DAY — only the Node assembly
// folds day keys to Mondays — which is what keeps hoursOnDoors a sum of per-DAY spans.
//
// The assertions that matter:
//   · week-mode maps == the fold-by-Monday of day-mode requests covering the same window;
//   · hoursOnDoors stays the per-DAY-span sum (4h here), never the week span (~82h) — THE
//     regression this file exists to prevent;
//   · overlaps: cards skipped (overlapsOmitted), but overlapDoors arithmetic stays honest;
//   · the 62-day boundary is exact (62 → day buckets, 63 → week buckets);
//   · past TIMELINE_RANGE_MAX_DAYS (183) the wall still stands.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-timeline-weeks';

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

// A knock at the given hour ET on the given civil day.
function at(ymd, hour = 10) {
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00-05:00`);
}

// Monday of the week containing `ymd` — the test's OWN fold, independent of the server's.
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const t = new Date(Date.UTC(y, m - 1, d - ((dow + 6) % 7)));
  return t.toISOString().slice(0, 10);
}

// Fold a day-keyed count map into a Monday-keyed one, accumulating into `into`.
function foldByMonday(dayMap, into = {}) {
  for (const [day, n] of Object.entries(dayMap || {})) {
    const wk = mondayOf(day);
    into[wk] = (into[wk] || 0) + n;
  }
  return into;
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
  await Membership.create({ userId: bob._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'GOTV', type: 'survey', state: 'FL',
    isActive: true, timeZone: TZ,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });

  const homes = await Household.insertMany([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
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

  // The window under test: 2026-01-05 (a Monday) → 2026-03-20, a 75-day span — past the
  // day-bucket bound, inside the range cap.
  //
  // Ann, all in ONE calendar week (Mon Jan 5 .. Sun Jan 11) plus a knock ten weeks later:
  //   Jan 5 (Mon)  9:00 + 12:00 — two doors, a 3h day span
  //   Jan 8 (Thu) 18:00 + 19:00 — two doors, a 1h day span
  //   Jan 11 (Sun) one knock — 0h, and the SAME week key as Jan 5 (Monday-start weeks)
  //   Mar 20 (Fri) one knock — 0h
  // Day-span sum = 4h. The week span (Mon 9:00 → Sun) would be ~82h — the regression bait.
  await knock(ann, homes[0], '2026-01-05', 9, 'not_home');
  await knock(ann, homes[1], '2026-01-05', 12, 'survey_submitted');
  await knock(ann, homes[2], '2026-01-08', 18, 'not_home');
  await knock(ann, homes[3], '2026-01-08', 19, 'not_home');
  await knock(ann, homes[4], '2026-01-11', 10, 'not_home');
  await knock(ann, homes[5], '2026-03-20', 10, 'not_home');

  // Bob: Ann's first door in the SAME pass (the overlap — bills once, shows on both rows),
  // one of his own, and a Monday-Jan-12 knock that must land in the NEXT week's column.
  await knock(bob, homes[0], '2026-01-05', 15, 'not_home');
  await knock(bob, homes[6], '2026-01-05', 11, 'not_home');
  await knock(bob, homes[7], '2026-01-12', 10, 'not_home');

  Object.assign(ctx, { org, boss, ann, bob, campaign });

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

test('a 63..183-day range answers with Monday week columns, not a 400', { skip }, async () => {
  const { campaign, token, org, ann, bob } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2026-01-05&to=2026-03-20`,
    token, org._id
  );
  assert.equal(res.status, 200, 'the old 62-day wall is gone for this tier');
  assert.equal(res.json.mode, 'range', 'mode stays range — the grids key off it strictly');
  assert.equal(res.json.bucket, 'week');

  const days = res.json.days;
  assert.equal(days[0], '2026-01-05', 'first column is the Monday of the range start');
  assert.equal(days[days.length - 1], '2026-03-16', 'last column is the Monday of the range end');
  for (let i = 0; i < days.length; i++) {
    const [y, m, d] = days[i].split('-').map(Number);
    assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 1, `${days[i]} is a Monday`);
    if (i > 0) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`);
      const cur = new Date(`${days[i]}T00:00:00Z`);
      assert.equal((cur - prev) / 86400000, 7, 'columns step by exactly one week');
    }
  }

  const byId = new Map(res.json.canvassers.map((c) => [String(c.userId), c]));
  const a = byId.get(String(ann._id));
  const b = byId.get(String(bob._id));
  // Sunday Jan 11 folds into the Jan 5 week (Monday-start); Monday Jan 12 starts the next one.
  assert.equal(a.knocksByDay['2026-01-05'], 5, "Ann's Mon+Thu+Sun knocks share one week key");
  assert.equal(a.knocksByDay['2026-03-16'], 1);
  assert.equal(b.knocksByDay['2026-01-05'], 2);
  assert.equal(b.knocksByDay['2026-01-12'], 1, "Bob's Monday knock lands in the NEXT week");
});

test('week maps == the fold-by-Monday of day-mode requests over the same window', { skip }, async () => {
  const { campaign, token, org } = ctx;
  const q = (from, to) =>
    call(`/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=${from}&to=${to}`, token, org._id);
  // The same 75 days as two day-bucket requests that each fit the 62-day bound.
  const [week, day1, day2] = await Promise.all([
    q('2026-01-05', '2026-03-20'),
    q('2026-01-05', '2026-02-28'),
    q('2026-03-01', '2026-03-20'),
  ]);
  assert.equal(day1.json.bucket, 'day');
  assert.equal(day2.json.bucket, 'day');

  const wById = new Map(week.json.canvassers.map((c) => [String(c.userId), c]));
  for (const dayRes of [day1, day2]) {
    assert.equal(dayRes.status, 200);
  }
  // Fold each canvasser's two day-mode maps into Monday keys and compare — knocks and surveys.
  const folded = new Map(); // uid -> { knocks: {}, surveys: {} }
  for (const dayRes of [day1, day2]) {
    for (const c of dayRes.json.canvassers) {
      const uid = String(c.userId);
      if (!folded.has(uid)) folded.set(uid, { knocks: {}, surveys: {} });
      foldByMonday(c.knocksByDay, folded.get(uid).knocks);
      foldByMonday(c.surveysByDay, folded.get(uid).surveys);
    }
  }
  assert.equal(wById.size, folded.size, 'same canvassers either way');
  for (const [uid, f] of folded) {
    const w = wById.get(uid);
    assert.ok(w, `${uid} present in week mode`);
    assert.deepEqual(w.knocksByDay, f.knocks, `knock map matches for ${w.firstName}`);
    assert.deepEqual(w.surveysByDay, f.surveys, `survey map matches for ${w.firstName}`);
  }
  // And the shipped totals row agrees with the same fold.
  assert.deepEqual(
    week.json.dayTotals.knocks,
    foldByMonday(day2.json.dayTotals.knocks, foldByMonday(day1.json.dayTotals.knocks)),
    'dayTotals fold to the same Monday keys'
  );
});

test('hoursOnDoors stays a sum of per-DAY spans — never the week span', { skip }, async () => {
  const { campaign, token, org, ann } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2026-01-05&to=2026-03-20`,
    token, org._id
  );
  const a = res.json.canvassers.find((c) => String(c.userId) === String(ann._id));
  // 3h (Jan 5) + 1h (Jan 8) + 0h (Jan 11) + 0h (Mar 20). If the AGGREGATION ever bucketed by
  // week instead of folding day buckets in Node, the Jan 5 9:00 → Jan 11 10:00 span (~145h)
  // would land here instead — THE regression this design exists to prevent.
  assert.equal(a.hoursOnDoors, 4, 'four hours on doors, not a week of wall-clock');
  assert.equal(a.doorsPerHour, 1.5, '6 knocks / 4h');
});

test('week mode skips the per-door overlap cards but keeps the arithmetic honest', { skip }, async () => {
  const { campaign, token, org } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2026-01-05&to=2026-03-20`,
    token, org._id
  );
  assert.equal(res.json.overlapsOmitted, true, 'cards are skipped — same reason as totals mode');
  assert.deepEqual(res.json.overlaps, []);
  assert.equal(res.json.overlapCount, 0);
  // 9 raw knocks across 8 distinct (household, pass) pairs — the shared door bills once.
  assert.equal(res.json.grandKnocks, 9);
  assert.equal(res.json.billableKnocks, 8);
  assert.equal(res.json.overlapDoors, res.json.grandKnocks - res.json.billableKnocks);
  // computeOverlaps was skipped, so the per-row flag is dark by design (documented; the
  // clients say the cards need a shorter range rather than implying zero overlaps).
  for (const c of res.json.canvassers) assert.equal(c.inOverlap, false);
});

test('the 62-day boundary is exact: 62 days → day buckets, 63 → week buckets', { skip }, async () => {
  const { campaign, token, org } = ctx;
  const q = (to) =>
    call(`/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2026-01-05&to=${to}`, token, org._id);
  const [at62, at63] = await Promise.all([q('2026-03-07'), q('2026-03-08')]);
  assert.equal(at62.json.bucket, 'day', 'a 62-day span keeps daily columns');
  assert.equal(at62.json.days.length, 62);
  assert.equal(at63.json.bucket, 'week', 'one more day tips it to week columns');
});

test('past TIMELINE_RANGE_MAX_DAYS the wall still stands', { skip }, async () => {
  const { campaign, token, org } = ctx;
  // 2025-09-21 → 2026-03-22 is 183 days (the cap, inclusive); one more day is refused.
  const [atCap, overCap] = await Promise.all([
    call(`/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2025-09-21&to=2026-03-22`, token, org._id),
    call(`/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2025-09-20&to=2026-03-22`, token, org._id),
  ]);
  assert.equal(atCap.status, 200, '183 days is allowed (week buckets)');
  assert.equal(atCap.json.bucket, 'week');
  assert.equal(overCap.status, 400, '184 days is not');
});

test('no regression: a short range keeps day buckets and LIVE overlap review', { skip }, async () => {
  const { campaign, token, org, ann, bob } = ctx;
  const res = await call(
    `/admin/reports/canvasser-timeline?campaignId=${campaign._id}&from=2026-01-05&to=2026-01-12`,
    token, org._id
  );
  assert.equal(res.status, 200);
  assert.equal(res.json.mode, 'range');
  assert.equal(res.json.bucket, 'day');
  assert.equal(res.json.days.length, 8, 'one column per day, as always');
  assert.equal(res.json.days[1], '2026-01-06', 'daily steps, not weekly');
  assert.equal(res.json.overlapsOmitted, false);
  assert.ok(res.json.overlaps.length > 0, 'the per-door cards are live');
  const byId = new Map(res.json.canvassers.map((c) => [String(c.userId), c]));
  assert.equal(byId.get(String(ann._id)).inOverlap, true, 'both parties to the shared door are flagged');
  assert.equal(byId.get(String(bob._id)).inOverlap, true);
});
