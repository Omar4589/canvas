import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// "Visited in the last N days" — Turf Cutting's Exclude doors line (docs/PROPOSAL_RECENT_VISITS.md),
// over the real app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/visitedsince node --test test/visitedSince.int.test.js
//
// The contract this file pins: `exclude.visitedSince: 'YYYY-MM-DD'` removes every door with a FIELD
// visit (any status row but a desk mark; never a note) at or after midnight of that day in the
// campaign's zone, from any round or walk list of the campaign; the round stores the date and Add as
// new book re-applies it; the stored conditions follow the books (written after they are saved,
// restored with a snapshot); the routes refuse a bad date, the include side and saved searches; and
// undefined / null / '' are "no line" everywhere.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-visited-since';

const { UnrecoverableError } = await import('bullmq');
const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { resolveWalkList } = await import('../src/services/walklist/resolveWalkList.js');
const { generateTurf, addSupplementalBooks, wipeDraftBooks } = await import('../src/services/turf/generateTurf.js');
const { snapshotPass, restoreSnapshot } = await import('../src/services/turf/snapshot.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const ids = (list) => list.map((h) => String(h._id)).sort();
const sorted = (list) => list.map(String).sort();

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'X-Org-Id': String(ctx.org._id),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const VISIT = (day = '2026-10-25') => ({ exclude: { visitedSince: day } });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Visited Org', slug: 'visited', isActive: true, timeZone: 'America/Los_Angeles' });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Vis', lastName: 'Admin', email: 'vis-admin@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  // Central time: midnight Oct 25 is 05:00Z (CDT); after DST ends on Nov 1, midnight Nov 2 is 06:00Z (CST).
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Visited', type: 'survey', state: 'NE', isActive: true, timeZone: 'America/Chicago',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const effort2 = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'South' });
  const p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'archived',
  });
  const p2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 2, name: 'Pass 2', status: 'active',
  });
  const e2p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort2._id, roundNumber: 1, name: 'South 1', status: 'archived',
  });
  // Another campaign's round: its stored conditions must never show up on this campaign's page.
  const other = await Campaign.create({
    organizationId: org._id, name: 'Other', type: 'survey', state: 'NE', isActive: true, timeZone: 'America/Chicago',
  });
  const otherEffort = await Effort.create({ organizationId: org._id, campaignId: other._id, name: 'Other WL' });
  const otherPass = await Pass.create({
    organizationId: org._id, campaignId: other._id, effortId: otherEffort._id, roundNumber: 1, name: 'Other 1',
    status: 'draft', targetFilter: VISIT(),
  });

  const mk = (n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Visit St`, city: 'Omaha', state: 'NE', zipCode: '68102',
    normalizedAddress: `${n} VISIT ST|OMAHA|NE|68102`,
    location: { type: 'Point', coordinates: [-95.93 + n * 0.0005, 41.25] },
  });
  const doors = await Household.insertMany(Array.from({ length: 13 }, (_, i) => mk(i + 1)));
  const [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13] = doors;

  const row = (home, actionType, at, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: p2._id,
    householdId: home._id, userId: admin._id, actionType,
    location: { lat: 41.25, lng: -95.93 }, timestamp: new Date(at), ...extra,
  });
  //   d1  no rows                                           → in (never visited)
  //   d2  not home 12:05 AM Oct 25 CDT (05:05Z)             → out
  //   d3  not home 11:55 PM Oct 24 CDT (04:55Z)             → in
  //   d4  survey at exactly midnight Oct 25 (05:00Z)        → out ("since" includes the day)
  //   d5  desk mark only, Oct 28                            → in (nobody visited)
  //   d6  note only, Oct 28                                 → in (notes never count)
  //   d7  refused Sep 1 + desk mark Oct 28                  → in (the mark is not a visit)
  //   d8  survey Oct 27, later converted from not home      → out (a correction keeps the knock time)
  //   d9  refused Oct 26 under ANOTHER walk list            → out (any walk list of the campaign)
  //   d10 lit dropped Oct 29                                → out (every result counts)
  //   d11 not home 11:30 PM Nov 1 CST (05:30Z Nov 2)        → for a Nov 2 cutoff: in
  //   d12 not home 12:10 AM Nov 2 CST (06:10Z)              → for a Nov 2 cutoff: out
  //   d13 not home Sep 15                                   → in
  await CanvassActivity.insertMany([
    row(d2, 'not_home', '2026-10-25T05:05:00Z'),
    row(d3, 'not_home', '2026-10-25T04:55:00Z'),
    row(d4, 'survey_submitted', '2026-10-25T05:00:00Z'),
    row(d5, 'restricted', '2026-10-28T15:00:00Z', { via: 'bulk' }),
    row(d6, 'note_added', '2026-10-28T15:00:00Z', { note: 'Dog in the yard' }),
    row(d7, 'refused', '2026-09-01T15:00:00Z'),
    row(d7, 'restricted', '2026-10-28T15:00:00Z', { via: 'bulk' }),
    row(d8, 'survey_submitted', '2026-10-27T15:00:00Z', {
      reclassified: { from: 'not_home', at: new Date('2026-10-30T15:00:00Z'), runId: new mongoose.Types.ObjectId(), kind: 'to_survey' },
    }),
    row(d9, 'refused', '2026-10-26T15:00:00Z', { effortId: effort2._id, passId: e2p1._id }),
    row(d10, 'lit_dropped', '2026-10-29T15:00:00Z'),
    row(d11, 'not_home', '2026-11-02T05:30:00Z'),
    row(d12, 'not_home', '2026-11-02T06:10:00Z'),
    row(d13, 'not_home', '2026-09-15T15:00:00Z'),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, campaign, effort, effort2, p1, p2, other, otherPass,
    doors, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13,
    token: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const resolve = (filter, campaign = ctx.campaign) => resolveWalkList(campaign, filter, { effortId: ctx.effort._id });

test('1. the day boundary and what counts as a visit', { skip }, async () => {
  const { d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13 } = ctx;
  const r = await resolve(VISIT('2026-10-25'));
  assert.deepEqual(sorted(r.householdIds), ids([d1, d3, d5, d6, d7, d13]),
    'never visited, 11:55 PM the night before, desk marks, notes and old knocks stay in');
  assert.deepEqual(sorted(r.excludedVisitedHouseholdIds), ids([d2, d4, d8, d9, d10, d11, d12]),
    '12:05 AM and exactly midnight are out; a converted entry, another walk list and a lit drop count');
  assert.deepEqual(sorted(r.excludedHouseholdIds), sorted(r.excludedVisitedHouseholdIds));
  assert.equal(r.excludeDegenerate, false);
  assert.equal(r.includeUnsupported, false);
});

test('2. daylight saving: midnight Nov 2 CST is 06:00Z, so 11:30 PM Nov 1 stays in', { skip }, async () => {
  const r = await resolve(VISIT('2026-11-02'));
  assert.deepEqual(sorted(r.excludedVisitedHouseholdIds), ids([ctx.d12]));
  assert.ok(sorted(r.householdIds).includes(String(ctx.d11._id)));
});

test('3. a campaign with no stored zone reads its org\'s (the page\'s order)', { skip }, async () => {
  const { d2, d4, d8, d9, d10, d11, d12 } = ctx;
  // A lean read of a campaign saved before the field skips the schema default.
  const lean = { ...(await Campaign.findById(ctx.campaign._id).lean()), timeZone: undefined };
  const r = await resolve(VISIT('2026-10-25'), lean);
  // Los Angeles: midnight Oct 25 is 07:00Z — the 05:00Z and 05:05Z visits fall on Oct 24 there.
  assert.deepEqual(sorted(r.excludedVisitedHouseholdIds), ids([d8, d9, d10, d11, d12]));
  assert.ok(!r.excludedVisitedHouseholdIds.map(String).includes(String(d2._id)));
  assert.ok(!r.excludedVisitedHouseholdIds.map(String).includes(String(d4._id)));
});

test('4. with a target, and beside another Exclude condition', { skip }, async () => {
  const { d1, d3, d5, d6, d7, d13, d2, d4, d8, d9, d10, d11, d12 } = ctx;
  // Target Not home (all-rounds ladder: d2, d3, d11, d12, d13), then leave out the visited ones.
  const t = await resolve({ priorPassStatuses: ['not_home'], combine: 'or', ...VISIT('2026-10-25') });
  assert.deepEqual(sorted(t.householdIds), ids([d3, d13]));

  // Exclude Not home AND the visit line: the line's share is a subset of the removed doors, and a door
  // matching both (d2, d11, d12) is the line's.
  const e = await resolve({ exclude: { priorPassStatuses: ['not_home'], visitedSince: '2026-10-25' } });
  assert.deepEqual(sorted(e.householdIds), ids([d1, d5, d6, d7]));
  assert.deepEqual(sorted(e.excludedHouseholdIds), ids([d2, d3, d4, d8, d9, d10, d11, d12, d13]));
  assert.deepEqual(sorted(e.excludedVisitedHouseholdIds), ids([d2, d4, d8, d9, d10, d11, d12]));
});

test('5. target-preview: disjoint lists, counts that add up, and no change with the line off', { skip }, async () => {
  const { campaign, p2, d3, d13 } = ctx;
  const path = `/admin/campaigns/${campaign._id}/turfs/target-preview`;
  const filter = { exclude: { priorPassStatuses: ['not_home'], visitedSince: '2026-10-25' } };
  const r = await call(path, { method: 'POST', body: { passId: String(p2._id), filter } });
  assert.equal(r.status, 200);
  const { counts } = r.json;
  assert.equal(r.json.doorCount, 4);
  assert.deepEqual(sorted(r.json.excludedHouseholdIds), ids([d3, d13]), 'removed by the status only');
  assert.equal(r.json.visitedHouseholdIds.length, 7, 'removed by the visit line (with or without the status)');
  const overlap = r.json.visitedHouseholdIds.filter((id) => r.json.excludedHouseholdIds.includes(id));
  assert.deepEqual(overlap, [], 'no id ships twice');
  assert.equal(counts.excluded, 9, 'the total stays one Exclude number');
  assert.equal(counts.visited, 7);
  assert.equal(counts.kept + counts.excluded + counts.restricted + counts.noSoliciting + counts.unplaced + counts.other + counts.status,
    counts.drawable, 'the parts still sum to every drawable door');

  const off = await call(path, { method: 'POST', body: { passId: String(p2._id), filter: { exclude: { priorPassStatuses: ['not_home'] } } } });
  assert.equal(off.status, 200);
  assert.deepEqual(off.json.visitedHouseholdIds, []);
  assert.equal(off.json.counts.visited, 0);
  assert.equal(off.json.excludedHouseholdIds.length, off.json.counts.excluded, 'with the line off the old list is whole');
});

test('6. preview equals cut, and the round stores the date', { skip }, async () => {
  const { campaign, p2 } = ctx;
  const filter = { exclude: { priorPassStatuses: ['not_home'], visitedSince: '2026-10-25' } };
  const pv = await call(`/admin/campaigns/${campaign._id}/turfs/target-preview`, { method: 'POST', body: { passId: String(p2._id), filter } });
  await generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65, targetFilter: filter } });
  const books = await Turf.find({ passId: p2._id, status: { $ne: 'archived' } }).lean();
  assert.equal(books.reduce((n, b) => n + b.doorCount, 0), pv.json.doorCount);
  const pass = await Pass.findById(p2._id).lean();
  assert.deepEqual(pass.targetFilter, filter, 'the date string, not a day count');
  await wipeDraftBooks(p2._id);
});

test('7. the stored conditions follow the books: failed cuts, GET /turfs, snapshot restores', { skip }, async () => {
  const { campaign, p1, p2, other, otherPass, admin, d1 } = ctx;
  const F1 = { exclude: { priorPassStatuses: ['not_home'], visitedSince: '2026-10-25' } };
  await generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65, targetFilter: F1 } });
  const draftsBefore = await Turf.countDocuments({ passId: p2._id });

  // A cut that fails before it saves anything leaves the books and the stored conditions alone.
  const far = { type: 'Polygon', coordinates: [[[-80, 30], [-80, 30.01], [-79.99, 30.01], [-79.99, 30], [-80, 30]]] };
  await assert.rejects(
    generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'manual', params: { polygons: [far], targetFilter: VISIT('2026-10-20') } }),
    (err) => err instanceof UnrecoverableError && /No doors inside the drawn area/.test(err.message),
    'refused on the first attempt (G3), not retried'
  );
  assert.deepEqual((await Pass.findById(p2._id).lean()).targetFilter, F1, 'still the conditions of the books on the round');
  assert.equal(await Turf.countDocuments({ passId: p2._id }), draftsBefore);

  // GET /turfs carries them; null for a round never cut with any, and for another campaign's round.
  const g = await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p2._id}&slim=1`);
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.targetFilter, F1);
  assert.equal((await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p1._id}`)).json.targetFilter, null);
  const foreign = await call(`/admin/campaigns/${campaign._id}/turfs?passId=${otherPass._id}`);
  assert.equal(foreign.status, 200);
  assert.equal(foreign.json.targetFilter, null, 'never another campaign\'s conditions');
  assert.ok(other);

  // Snapshots: restoring a cut brings back the conditions that cut used.
  const snapA = await snapshotPass({ campaign, passId: p2._id, reason: 'discard', includeKnocks: false, userId: admin._id });
  await wipeDraftBooks(p2._id);
  await generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65 } });
  assert.equal((await Pass.findById(p2._id).lean()).targetFilter, null, 'an untargeted cut clears them');
  const snapB = await snapshotPass({ campaign, passId: p2._id, reason: 'discard', includeKnocks: false, userId: admin._id });
  await wipeDraftBooks(p2._id);

  await restoreSnapshot({ campaign, snapshot: snapA, userId: admin._id });
  assert.deepEqual((await Pass.findById(p2._id).lean()).targetFilter, F1, 'restoring the targeted cut brings its date back');
  await wipeDraftBooks(p2._id);
  await restoreSnapshot({ campaign, snapshot: await TurfSnapshot.findById(snapB._id), userId: admin._id });
  assert.equal((await Pass.findById(p2._id).lean()).targetFilter, null, 'restoring the untargeted cut clears it');
  await wipeDraftBooks(p2._id);

  // A snapshot holding only books a cut didn't make (a moved-door book: params {}) knows no conditions,
  // so the stored ones stay.
  const F2 = VISIT('2026-10-20');
  await Pass.updateOne({ _id: p2._id }, { $set: { targetFilter: F2 } });
  await Turf.create({
    organizationId: ctx.org._id, campaignId: campaign._id, passId: p2._id, name: 'Moved', mode: 'manual',
    params: {}, householdIds: [d1._id], doorCount: 1, status: 'draft',
  });
  const snapC = await snapshotPass({ campaign, passId: p2._id, reason: 'discard', includeKnocks: false, userId: admin._id });
  await wipeDraftBooks(p2._id);
  await restoreSnapshot({ campaign, snapshot: snapC, userId: admin._id });
  assert.deepEqual((await Pass.findById(p2._id).lean()).targetFilter, F2);
  await wipeDraftBooks(p2._id);
});

test('8. Add as new book and the bookless count re-apply the stored date', { skip }, async () => {
  const { campaign, p2, org, effort, d3, admin } = ctx;
  await generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65, targetFilter: VISIT('2026-10-25') } });
  const booked = await Turf.find({ passId: p2._id }).lean();
  assert.equal(booked.reduce((n, b) => n + b.doorCount, 0), 6);

  // The visited doors are bookless on purpose: nothing to nag about, nothing to add.
  assert.equal((await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p2._id}`)).json.supplementalDoorCount, 0);
  assert.equal((await addSupplementalBooks({ campaignId: campaign._id, passId: p2._id })).added, 0);

  // A brand-new door, never visited, still flows in — alone.
  const fresh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '99 Newcomer Way', city: 'Omaha', state: 'NE', zipCode: '68102',
    normalizedAddress: '99 NEWCOMER WAY|OMAHA|NE|68102', location: { type: 'Point', coordinates: [-95.92, 41.251] },
  });
  assert.equal((await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p2._id}`)).json.supplementalDoorCount, 1);
  const added = await addSupplementalBooks({ campaignId: campaign._id, passId: p2._id });
  assert.equal(added.added, 1);
  const supp = await Turf.findOne({ passId: p2._id, 'params.supplemental': true }).lean();
  assert.deepEqual(supp.householdIds.map(String), [String(fresh._id)]);

  // A door this round knocked after the cut, then taken out of its book, is visited too: not re-added.
  const book = booked.find((b) => b.householdIds.map(String).includes(String(d3._id)));
  await CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: p2._id,
    householdId: d3._id, userId: admin._id, actionType: 'not_home',
    location: { lat: 41.25, lng: -95.93 }, timestamp: new Date('2026-10-31T15:00:00Z'),
  });
  await Turf.updateOne({ _id: book._id }, { $pull: { householdIds: d3._id }, $inc: { doorCount: -1 } });
  await Household.updateOne({ _id: d3._id }, { $set: { turfId: null } });
  assert.equal((await addSupplementalBooks({ campaignId: campaign._id, passId: p2._id })).added, 0);
  await Turf.deleteMany({ passId: p2._id });
  await Household.updateMany({ campaignId: campaign._id }, { $set: { turfId: null, walkOrder: null } });
  await Household.deleteOne({ _id: fresh._id });
  await CanvassActivity.deleteOne({ householdId: d3._id, timestamp: new Date('2026-10-31T15:00:00Z') });
});

test('9. refusals, and undefined / null / \'\' as "no line"', { skip }, async () => {
  const { campaign, p2 } = ctx;
  const tp = `/admin/campaigns/${campaign._id}/turfs/target-preview`;
  const gen = `/admin/campaigns/${campaign._id}/turfs/generate`;
  for (const bad of ['garbage', '2026-02-30', 20261025, {}, true, '2026-10-25T00:00:00Z', ['2026-10-25']]) {
    const filter = { exclude: { visitedSince: bad } };
    const a = await call(tp, { method: 'POST', body: { passId: String(p2._id), filter } });
    assert.equal(a.status, 400, `preview refuses ${JSON.stringify(bad)}`);
    assert.match(a.json.error, /needs a valid date/);
    const b = await call(gen, { method: 'POST', body: { passId: String(p2._id), mode: 'geometric', params: { targetFilter: filter } } });
    assert.equal(b.status, 400, `generate refuses ${JSON.stringify(bad)} before queueing`);
  }
  const inc = await call(tp, { method: 'POST', body: { passId: String(p2._id), filter: { visitedSince: '2026-10-25' } } });
  assert.equal(inc.status, 400);
  assert.match(inc.json.error, /can only exclude/);

  for (const filter of [VISIT(), { visitedSince: '2026-10-25' }]) {
    const pv = await call(`/admin/campaigns/${campaign._id}/walklists/preview`, { method: 'POST', body: { filter } });
    assert.equal(pv.status, 400);
    assert.match(pv.json.error, /Turf Cutting only/);
    const cr = await call(`/admin/campaigns/${campaign._id}/walklists`, { method: 'POST', body: { name: 'x', filter } });
    assert.equal(cr.status, 400);
  }

  // "No line": the page deletes the key, but null and '' must read the same everywhere.
  const plain = await call(tp, { method: 'POST', body: { passId: String(p2._id), filter: { exclude: { priorPassStatuses: ['not_home'] } } } });
  for (const empty of [null, '']) {
    const r = await call(tp, { method: 'POST', body: { passId: String(p2._id), filter: { exclude: { priorPassStatuses: ['not_home'], visitedSince: empty } } } });
    assert.equal(r.status, 200, `exclude-side ${JSON.stringify(empty)} is no line`);
    assert.equal(r.json.doorCount, plain.json.doorCount);
    assert.deepEqual(r.json.excludedHouseholdIds, plain.json.excludedHouseholdIds);
  }
  const incNull = await call(tp, { method: 'POST', body: { passId: String(p2._id), filter: { priorPassStatuses: ['not_home'], visitedSince: null } } });
  assert.equal(incNull.status, 200);
  const saved = await call(`/admin/campaigns/${campaign._id}/walklists/preview`, { method: 'POST', body: { filter: { exclude: { visitedSince: '' } } } });
  assert.equal(saved.status, 200, 'an empty line is not a line, on saved searches too');
});

test('10. resolver defenses refuse instead of cutting a different set', { skip }, async () => {
  const { campaign, p2 } = ctx;
  const inc = await resolve({ visitedSince: '2026-10-25' });
  assert.equal(inc.includeUnsupported, true);
  await assert.rejects(
    generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65, targetFilter: { visitedSince: '2026-10-25' } } }),
    (err) => err instanceof UnrecoverableError && /can only exclude/.test(err.message)
  );
  const bad = await resolve({ exclude: { visitedSince: 'garbage' } });
  assert.equal(bad.excludeDegenerate, true, 'an unusable date alone runs no set');
  assert.equal(bad.householdCount, 13, 'and so excludes nothing');
  await assert.rejects(
    generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65, targetFilter: { exclude: { visitedSince: 'garbage' } } } }),
    (err) => err instanceof UnrecoverableError && /no valid conditions/.test(err.message)
  );
  assert.equal(await Turf.countDocuments({ passId: p2._id }), 0, 'refused cuts write no books');
});

test('11. the house pop-up\'s last visit, opt-in, and the route without the index', { skip }, async () => {
  const { campaign, d5, d6, d7 } = ctx;
  const path = (h, q = '') => `/admin/campaigns/${campaign._id}/turfs/household/${h._id}${q}`;
  const plain = await call(path(d7));
  assert.equal(plain.status, 200);
  assert.ok(!('lastVisitAt' in plain.json.household), 'without withVisit the response is today\'s');
  const r7 = await call(path(d7, '?withVisit=1'));
  assert.equal(r7.json.household.lastVisitAt, '2026-09-01T15:00:00.000Z', 'the refusal, not the later desk mark');
  assert.equal((await call(path(d5, '?withVisit=1'))).json.household.lastVisitAt, null, 'a desk mark is not a visit');
  assert.equal((await call(path(d6, '?withVisit=1'))).json.household.lastVisitAt, null, 'nor is a note');

  // The integration preload builds only indexes hinted WITHOUT a fallback; this one is not among them,
  // and production could lose it. Neither the pop-up nor the visit line may depend on it.
  await CanvassActivity.collection.dropIndex('householdId_1_timestamp_-1').catch(() => {});
  assert.equal((await call(path(d7, '?withVisit=1'))).status, 200);
  const r = await resolve(VISIT('2026-11-02'));
  assert.deepEqual(sorted(r.excludedVisitedHouseholdIds), ids([ctx.d12]), 'the hinted read falls back');
});
