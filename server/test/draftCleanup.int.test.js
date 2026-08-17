import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// Draft-book cleanup + orphaned-attribution repair, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/draft_cleanup_test node --test test/draftCleanup.int.test.js
//
// The contract pinned here (all 2026-08 incident follow-ups):
//   1. POST /turfs/discard scope:'drafts' wipes ONLY drafts — published books and
//      their mirror survive, no snapshot is written (drafts carry no assignments
//      or history), and clearKnocks with drafts scope is a 400.
//   2. DELETE /turfs/:turfId removes a single DRAFT book (mirror cleared);
//      published books 409, cross-campaign 404, lock-held 409.
//   3. DELETE /efforts/:id refuses while ledger rows (knocks/surveys) reference
//      the effort or its rounds — the guard that would have prevented the
//      "Legacy / no pass" orphans — and still deletes a truly-empty draft list.
//   4. repair:orphan-attribution (run as the REAL child process, the exact ops
//      command) dry-runs without writing, then --apply re-stamps orphans to the
//      door's current list + round and leaves ambiguous rows for manual review.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-draft-cleanup';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const execFileP = promisify(execFile);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;
const ctx = {};

const hh = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Draft Ave`,
  city: 'Naples',
  state: 'FL',
  zipCode: '34103',
  normalizedAddress: `${n} DRAFT AVE|NAPLES|FL|34103`,
  location: { type: 'Point', coordinates: [-81.8 + n * 0.001, 26.2] },
  isActive: true,
  status: 'unknocked',
});

const knock = (hhDoc, userId, { effortId, passId, actionType = 'not_home' }) => {
  const [lng, lat] = hhDoc.location.coordinates;
  return {
    organizationId: hhDoc.organizationId,
    campaignId: hhDoc.campaignId,
    householdId: hhDoc._id,
    effortId,
    passId,
    userId,
    actionType,
    location: { lat, lng, accuracy: 10 },
    distanceFromHouseMeters: 5,
    timestamp: new Date('2026-08-10T15:00:00Z'),
  };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Pass, Turf, TurfAssignment, TurfSnapshot, Household, CanvassActivity, SurveyResponse, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Draft Org', slug: 'draft-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'dca@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'dcc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Draft C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });
  // A second campaign for the cross-campaign 404.
  const campOther = await Campaign.create({
    organizationId: org._id, name: 'Other C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Collier' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active',
  });

  const doors = await Household.insertMany([1, 2, 3, 4, 5, 6, 7, 8].map((n) => hh(org._id, camp._id, effort._id, n)));
  const mkBook = async (name, status, ds) => {
    const t = await Turf.create({
      organizationId: org._id, campaignId: camp._id, passId: pass._id, name, mode: 'geometric',
      householdIds: ds.map((d) => d._id), doorCount: ds.length, status,
    });
    await Household.updateMany({ _id: { $in: ds.map((d) => d._id) } }, { $set: { turfId: t._id } });
    return t;
  };
  // 2 published (accepted) + 2 draft books — the stuck-supplemental shape.
  const pub1 = await mkBook('Accepted 1', 'published', doors.slice(0, 2));
  const pub2 = await mkBook('Accepted 2', 'published', doors.slice(2, 4));
  const draft1 = await mkBook('Draft 1', 'draft', doors.slice(4, 6));
  const draft2 = await mkBook('Draft 2', 'draft', doors.slice(6, 8));

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, campOther, admin, canv, effort, pass, doors, pub1, pub2, draft1, draft2,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path_, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path_}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const turfsBase = () => `/api/admin/campaigns/${ctx.camp._id}/turfs`;
const effortsBase = () => `/api/admin/campaigns/${ctx.camp._id}/efforts`;
const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

test('discard scope drafts + clearKnocks is a 400 — knock history belongs to the pass', { skip }, async () => {
  const r = await call('POST', `${turfsBase()}/discard`, { ...auth(), body: { passId: String(ctx.pass._id), scope: 'drafts', clearKnocks: true } });
  assert.strictEqual(r.status, 400);
});

test('DELETE a single draft book: gone, mirror cleared; published 409; cross-campaign 404; locked 409', { skip }, async () => {
  // published → 409, still there
  const pub = await call('DELETE', `${turfsBase()}/${ctx.pub1._id}`, auth());
  assert.strictEqual(pub.status, 409);
  assert.strictEqual(pub.json.code, 'not-draft');
  assert.ok(await Turf.exists({ _id: ctx.pub1._id }));

  // cross-campaign → 404 (campaign-scoped load)
  const foreign = await call('DELETE', `/api/admin/campaigns/${ctx.campOther._id}/turfs/${ctx.draft1._id}`, auth());
  assert.strictEqual(foreign.status, 404);

  // lock held → 409
  assert.ok(await acquireRecutLock(ctx.pass._id, ctx.admin._id));
  const locked = await call('DELETE', `${turfsBase()}/${ctx.draft1._id}`, auth());
  assert.strictEqual(locked.status, 409);
  await releaseRecutLock(ctx.pass._id);

  // draft → deleted, doors' mirror nulled
  const ok = await call('DELETE', `${turfsBase()}/${ctx.draft1._id}`, auth());
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.deleted, 1);
  assert.strictEqual(await Turf.countDocuments({ _id: ctx.draft1._id }), 0);
  const freed = await Household.find({ _id: { $in: ctx.draft1.householdIds } }, { turfId: 1, walkOrder: 1 }).lean();
  assert.ok(freed.every((d) => d.turfId === null && d.walkOrder === null), 'mirror cleared for the deleted book');
});

test('discard scope drafts wipes ONLY drafts — published books + mirror intact, no snapshot written', { skip }, async () => {
  const snapsBefore = await TurfSnapshot.countDocuments({});
  const r = await call('POST', `${turfsBase()}/discard`, { ...auth(), body: { passId: String(ctx.pass._id), scope: 'drafts' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.scope, 'drafts');
  assert.strictEqual(r.json.discarded, 1); // draft2 (draft1 was deleted above)

  assert.strictEqual(await Turf.countDocuments({ passId: ctx.pass._id, status: 'draft' }), 0);
  assert.strictEqual(await Turf.countDocuments({ passId: ctx.pass._id, status: 'published' }), 2, 'accepted books untouched');
  // Published mirror intact, draft mirror cleared.
  const pubDoors = await Household.find({ _id: { $in: [...ctx.pub1.householdIds, ...ctx.pub2.householdIds] } }, { turfId: 1 }).lean();
  assert.ok(pubDoors.every((d) => d.turfId), 'published books keep their mirror');
  const draftDoors = await Household.find({ _id: { $in: ctx.draft2.householdIds } }, { turfId: 1 }).lean();
  assert.ok(draftDoors.every((d) => d.turfId === null));
  assert.strictEqual(await TurfSnapshot.countDocuments({}), snapsBefore, 'drafts-only discard writes no snapshot');
  // The pass stayed ACTIVE — drafts scope never reverts a live round.
  const p = await Pass.findById(ctx.pass._id, { status: 1 }).lean();
  assert.strictEqual(p.status, 'active');
});

test('DELETE /efforts/:id refuses when ledger rows reference the list; deletes a truly-empty one', { skip }, async () => {
  const { org, camp, admin, canv } = ctx;
  // A draft-rounds-only list that nevertheless HAS history — the incident shape.
  const ghost = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Ghost List' });
  const ghostPass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: ghost._id, roundNumber: 1, name: 'Round 1', status: 'draft',
  });
  const [door] = await Household.insertMany([hh(org._id, camp._id, ghost._id, 100)]);
  await CanvassActivity.create(knock(door, canv._id, { effortId: ghost._id, passId: null }));

  const refused = await call('DELETE', `${effortsBase()}/${ghost._id}`, auth());
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.json.code, 'has-history');
  assert.ok(await Effort.exists({ _id: ghost._id }), 'list survives');

  // Rows referencing only the round (not the effort) refuse too.
  await CanvassActivity.deleteMany({ effortId: ghost._id });
  await CanvassActivity.create(knock(door, canv._id, { effortId: null, passId: ghostPass._id }));
  const refused2 = await call('DELETE', `${effortsBase()}/${ghost._id}`, auth());
  assert.strictEqual(refused2.status, 400);

  // History gone → the delete goes through.
  await CanvassActivity.deleteMany({ passId: ghostPass._id });
  const ok = await call('DELETE', `${effortsBase()}/${ghost._id}`, auth());
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await Effort.countDocuments({ _id: ghost._id }), 0);
  await Household.deleteMany({ _id: door._id }); // keep later fixtures clean
});

test('repair:orphan-attribution (real child process): dry-run reports, --apply re-stamps, ambiguous stays manual', { skip }, async () => {
  const { org, camp, admin, canv, effort, pass } = ctx;
  // Orphans — rows stamped with a walk list / round that no longer exists (the
  // "Legacy / no pass" bucket): 2 knocks + 1 survey on doors NOW owned by `effort`
  // (single-round list → unambiguous re-stamp), plus 1 knock on an Intake door
  // (no current list → must stay manual).
  const deadEffort = new mongoose.Types.ObjectId();
  const deadPass = new mongoose.Types.ObjectId();
  const [dA, dB, dIntake] = await Household.insertMany([
    hh(org._id, camp._id, effort._id, 201), hh(org._id, camp._id, effort._id, 202), hh(org._id, camp._id, null, 203),
  ]);
  const orphans = await CanvassActivity.insertMany([
    knock(dA, canv._id, { effortId: deadEffort, passId: null }),
    knock(dB, canv._id, { effortId: deadEffort, passId: deadPass }),
    knock(dIntake, canv._id, { effortId: deadEffort, passId: null }),
  ]);
  const [lng, lat] = dA.location.coordinates;
  const orphanSurvey = await SurveyResponse.create({
    organizationId: org._id, campaignId: camp._id, effortId: deadEffort, passId: null,
    voterId: new mongoose.Types.ObjectId(), householdId: dA._id, userId: canv._id,
    surveyTemplateId: new mongoose.Types.ObjectId(), surveyTemplateVersion: 1,
    answers: [], location: { lat, lng, accuracy: 8 }, submittedAt: new Date('2026-08-10T15:05:00Z'),
  });
  // A healthy row that must never be touched.
  const healthy = await CanvassActivity.create(knock(dA, canv._id, { effortId: effort._id, passId: pass._id, actionType: 'refused' }));

  const script = path.join(serverRoot, 'src/migrations/repairOrphanAttribution.js');
  const env = { ...process.env, MONGODB_URI: URI };
  const run = (args) => execFileP('node', [script, '--campaign', String(camp._id), ...args], { cwd: serverRoot, env });

  // Dry run: reports, writes nothing.
  const dry = await run([]);
  assert.match(dry.stdout, /3 row\(s\) would be re-stamped/);
  assert.match(dry.stdout, /1 need manual review/);
  assert.match(dry.stdout, /Dry run/);
  const untouched = await CanvassActivity.findById(orphans[0]._id).lean();
  assert.strictEqual(String(untouched.effortId), String(deadEffort), 'dry run wrote nothing');

  // Apply: the three unambiguous rows land on the door's current list + its only round.
  const applied = await run(['--apply']);
  assert.match(applied.stdout, /APPLIED — 3 row\(s\) re-stamped/);
  for (const id of [orphans[0]._id, orphans[1]._id]) {
    const row = await CanvassActivity.findById(id).lean();
    assert.strictEqual(String(row.effortId), String(effort._id));
    assert.strictEqual(String(row.passId), String(pass._id));
  }
  const survey = await SurveyResponse.findById(orphanSurvey._id).lean();
  assert.strictEqual(String(survey.effortId), String(effort._id));
  assert.strictEqual(String(survey.passId), String(pass._id));
  // The Intake-door orphan stays for manual review; the healthy row is untouched.
  const manual = await CanvassActivity.findById(orphans[2]._id).lean();
  assert.strictEqual(String(manual.effortId), String(deadEffort));
  const stillHealthy = await CanvassActivity.findById(healthy._id).lean();
  assert.strictEqual(String(stillHealthy.passId), String(pass._id));
});
