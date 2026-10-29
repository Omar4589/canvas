import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The Door Outcomes undo guard and archived rounds — docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.7 (F1) —
// over a throwaway mongod, with each round's state driven through the REAL routes:
//   npm run test:int -- test/roundClearedArchived.int.test.js
//
// roundClearedSince (services/canvass/answerEditRuns.js) holds a removal's Undo while a round it
// touched had its knocks cleared AFTER it and that snapshot is unrestored — because a restore after
// the undo would bring the change's own work back out of every tool's reach. It used to skip every
// archived round ("its snapshot can never come back"); archived rounds can come back now, so:
//   • a round that COULD come back holds the Undo: an open one, one archived by hand, one on an
//     archived walk list (Unarchive), one on an archived campaign (Reactivate), and an archived draft;
//   • a round that can't — ended by the next pass going live, or by hand before a later pass went
//     live — lets it through, as before;
//   • the refusal names the way out that never puts a finished round back on phones: delete the
//     snapshot.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-round-cleared-archived';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { roundClearedSince, roundClearedRefusal } = await import('../src/services/canvass/answerEditRuns.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { UnknockRun } = await import('../src/models/UnknockRun.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

let doorSeq = 0;
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
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const show = (r) => JSON.stringify(r.json);
const route = async (method, path, body) => {
  const r = await call(method, path, { ...asAdmin(), body });
  assert.strictEqual(r.status, 200, `${method} ${path}: ${show(r)}`);
};
const activate = (c, p) => route('POST', `/admin/campaigns/${c._id}/passes/${p._id}/activate`);
const archiveByHand = (c, p) => route('POST', `/admin/campaigns/${c._id}/passes/${p._id}/archive`, { confirmArchive: true });
const archiveWalkList = (c, w) => route('POST', `/admin/campaigns/${c._id}/efforts/${w.effort._id}/archive`, { confirmArchive: true });

// A walk list with one door and two draft passes, each with a published book over it.
const seedWalkList = async (campaign, name) => {
  const effort = await Effort.create({ organizationId: campaign.organizationId, campaignId: campaign._id, name, status: 'active' });
  doorSeq += 1;
  const door = await Household.create({
    organizationId: campaign.organizationId, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${doorSeq} Undo Way`, city: 'Austin', state: 'TX', zipCode: '78705', normalizedAddress: `${doorSeq} undo way austin tx 78705`,
    location: { type: 'Point', coordinates: [-97.74, 30.29] }, status: 'unknocked', isActive: true,
  });
  const passes = [];
  for (const n of [1, 2]) {
    const pass = await Pass.create({ organizationId: campaign.organizationId, campaignId: campaign._id, effortId: effort._id, roundNumber: n, name: `Pass ${n}`, status: 'draft' });
    await Turf.create({
      organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, name: `${name} ${n}`, mode: 'manual',
      status: 'published', householdIds: [door._id], doorCount: 1,
    });
    passes.push(pass);
  }
  return { effort, door, passes };
};

// An unknock run that struck a visit on `pass`, made an hour ago; then the round's knocks were cleared
// into a snapshot (now), which is unrestored. The round holds no knocks since.
const unknockThenCleared = async (campaign, w, pass) => {
  const run = await UnknockRun.create({ organizationId: campaign.organizationId, campaignId: campaign._id, byUserId: ctx.admin._id, status: 'completed' });
  await UnknockRunChunk.create({
    runId: run._id, campaignId: campaign._id, organizationId: campaign.organizationId, seq: 0,
    visitKeys: [`${w.door._id}|${pass._id}|${ctx.admin._id}`], frozenAt: new Date(Date.now() - 3600_000),
  });
  await UnknockRun.collection.updateOne({ _id: run._id }, { $set: { createdAt: new Date(Date.now() - 3600_000) } });
  const snap = await TurfSnapshot.create({
    organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, books: [], assignments: [], clearedKnocks: true, restoredAt: null,
  });
  return { run: await UnknockRun.findById(run._id).lean(), snap };
};
const held = (campaign, run) => roundClearedSince(campaign._id, { unknock: run });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignChange, Effort, Pass, Turf, Household, CanvassActivity,
    TurfSnapshot, UnknockRun, UnknockRunChunk, SurveyConversionRun]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Undo Org', slug: 'undo-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'rca-a@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const mk = (name) => Campaign.create({ organizationId: org._id, name, type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true });
  const campaign = await mk('Undo C');
  const archivedCampaign = await mk('Undo Done');

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, campaign, archivedCampaign, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('an open round holds the Undo, as before — and stops holding it once the snapshot is deleted or the round is knocked again', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList(c, 'Open');
  const [p1, p2] = w.passes;
  await activate(c, p1);
  const { run, snap } = await unknockThenCleared(c, w, p1);
  const got = await held(c, run);
  assert.ok(got, 'held');
  assert.strictEqual(String(got.passId), String(p1._id));
  assert.strictEqual(got.round, 'Open · Pass 1');
  assert.strictEqual(got.archived, false);
  assert.strictEqual(got.walkList, null);
  assert.strictEqual(new Date(got.at).getTime(), snap.createdAt.getTime());

  await TurfSnapshot.deleteOne({ _id: snap._id });
  assert.strictEqual(await held(c, run), null, 'deleting the snapshot releases it');

  // A draft round, knocked since: let through (its restore would stack old entries beside new).
  const second = await unknockThenCleared(c, w, p2);
  assert.ok(await held(c, second.run), 'an open draft round holds it too');
  await CanvassActivity.create({
    organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, passId: p2._id, householdId: w.door._id,
    userId: ctx.admin._id, actionType: 'lit_dropped', timestamp: new Date(), location: { lat: 30.29, lng: -97.74 },
  });
  assert.strictEqual(await held(c, second.run), null);
});

test('a round archived by hand that could come back holds the Undo (archived: true)', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList(c, 'By Hand');
  const [p1] = w.passes;
  await activate(c, p1);
  await archiveByHand(c, p1);
  const { run, snap } = await unknockThenCleared(c, w, p1);
  const got = await held(c, run);
  assert.ok(got, 'held: Bring back could restore its snapshot');
  assert.strictEqual(String(got.passId), String(p1._id));
  assert.strictEqual(got.archived, true);
  assert.strictEqual(got.walkList, null);
  await TurfSnapshot.deleteOne({ _id: snap._id });
  assert.strictEqual(await held(c, run), null, 'deleting the snapshot releases it');
});

test('a round of an archived walk list holds the Undo (walkList named) — its ended pass and its frozen draft alike', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList(c, 'Shelved');
  const [p1, p2] = w.passes;
  await activate(c, p1);
  await archiveWalkList(c, w);
  assert.strictEqual((await Pass.findById(p1._id).lean()).archivedVia, 'walk-list');

  const ended = await unknockThenCleared(c, w, p1);
  const got = await held(c, ended.run);
  assert.ok(got, 'held: Unarchive could bring it back');
  assert.strictEqual(got.archived, true);
  assert.strictEqual(got.walkList, 'Shelved');

  const draft = await unknockThenCleared(c, w, p2);
  const got2 = await held(c, draft.run);
  assert.ok(got2, 'the draft holds it too');
  assert.strictEqual(String(got2.passId), String(p2._id));
  assert.strictEqual(got2.archived, false);
  assert.strictEqual(got2.walkList, 'Shelved');
});

test('a round archived on an archived campaign holds the Undo (Reactivate is transient)', { skip }, async () => {
  const c = ctx.archivedCampaign;
  const w = await seedWalkList(c, 'Done');
  const [p1] = w.passes;
  await activate(c, p1);
  await archiveByHand(c, p1);
  const { run } = await unknockThenCleared(c, w, p1);
  await Campaign.updateOne({ _id: c._id }, { $set: { isActive: false } });
  const got = await held(c, run);
  assert.ok(got, 'held');
  assert.strictEqual(got.archived, true);
});

test('a round that can never come back lets the Undo through, as before', { skip }, async () => {
  const c = ctx.campaign;
  // Ended by the next pass going live (the real activation route).
  const a = await seedWalkList(c, 'Next Pass');
  await activate(c, a.passes[0]);
  await activate(c, a.passes[1]);
  assert.strictEqual((await Pass.findById(a.passes[0]._id).lean()).archivedVia, 'next-pass');
  const r1 = await unknockThenCleared(c, a, a.passes[0]);
  assert.strictEqual(await held(c, r1.run), null, 'next-pass: skipped');

  // Archived by hand, then a later pass went live (rule 4b).
  const b = await seedWalkList(c, 'Later Live');
  await activate(c, b.passes[0]);
  await archiveByHand(c, b.passes[0]);
  await activate(c, b.passes[1]);
  const r2 = await unknockThenCleared(c, b, b.passes[0]);
  assert.strictEqual(await held(c, r2.run), null, 'a later pass went live: skipped');

  // From before this change: no archivedVia, but its successor went live at the same instant.
  const d = await seedWalkList(c, 'Old Next');
  const t = new Date(Date.now() - 86400_000);
  await Pass.collection.updateOne({ _id: d.passes[0]._id }, {
    $set: { status: 'archived', activatedAt: new Date(t.getTime() - 86400_000), archivedAt: t },
    $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' },
  });
  await Pass.collection.updateOne({ _id: d.passes[1]._id }, { $set: { status: 'active', activatedAt: t }, $unset: { lastActivatedAt: '' } });
  const r3 = await unknockThenCleared(c, d, d.passes[0]);
  assert.strictEqual(await held(c, r3.run), null, 'pre-change successor: skipped');

  // Its walk list is gone.
  const e = await seedWalkList(c, 'Orphan');
  await activate(c, e.passes[0]);
  await archiveByHand(c, e.passes[0]);
  await Effort.deleteOne({ _id: e.effort._id });
  const r4 = await unknockThenCleared(c, e, e.passes[0]);
  assert.strictEqual(await held(c, r4.run), null, 'no walk list: skipped');
});

test('an archived DRAFT holds the Undo even after a later pass went live (it comes back as a draft)', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList(c, 'Draft Ended');
  const [p1, p2] = w.passes;
  await archiveByHand(c, p1); // never live: archived from draft
  await activate(c, p2);
  const { run } = await unknockThenCleared(c, w, p1);
  const got = await held(c, run);
  assert.ok(got, 'held');
  assert.strictEqual(got.archived, true);
});

test('a conversion run is held the same way by an archived round that could come back', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList(c, 'Converted');
  const [p1] = w.passes;
  await activate(c, p1);
  await archiveByHand(c, p1);
  const conv = await SurveyConversionRun.create({ organizationId: c.organizationId, campaignId: c._id, byUserId: ctx.admin._id, direction: 'to_survey', mode: 'bulk', to: 'survey_submitted', status: 'completed' });
  await SurveyConversionRun.collection.updateOne({ _id: conv._id }, { $set: { createdAt: new Date(Date.now() - 3600_000) } });
  const run = await SurveyConversionRun.findById(conv._id).lean();
  await TurfSnapshot.create({
    organizationId: c.organizationId, campaignId: c._id, passId: p1._id, books: [], assignments: [], clearedKnocks: true, restoredAt: null,
    activities: [{ _id: new mongoose.Types.ObjectId(), passId: p1._id, reclassified: { runId: conv._id, from: 'not_home' } }],
  });
  const got = await roundClearedSince(c._id, { conversion: run });
  assert.ok(got, 'held');
  assert.strictEqual(String(got.passId), String(p1._id));
  assert.strictEqual(got.archived, true);
});

test('the refusal names the way out: delete the snapshot, or bring the round back (unarchiving its walk list first)', { skip }, async () => {
  const c = ctx.campaign;
  const at = new Date('2026-10-20T15:00:00Z');
  const open = roundClearedRefusal({ round: 'North · Pass 3', at, archived: false, walkList: null }, c);
  assert.strictEqual(open.code, 'ROUND_CLEARED_SINCE');
  assert.match(open.error, /^North · Pass 3 had its knocks cleared on Oct 20/);
  assert.match(open.error, /Restore it on Turf Cutting/);

  const byHand = roundClearedRefusal({ round: 'North · Pass 3', at, archived: true, walkList: null }, c);
  assert.strictEqual(byHand.code, 'ROUND_CLEARED_SINCE');
  assert.match(byHand.error, /^North · Pass 3 \(archived\) had its knocks cleared on Oct 20/);
  assert.match(byHand.error, /could still come back/);
  assert.match(byHand.error, /Delete that snapshot on Turf Cutting \(Undo \/ snapshots\)/);
  assert.match(byHand.error, /or bring the round back, then restore it/);
  assert.doesNotMatch(byHand.error, /unarchive/);

  const shelved = roundClearedRefusal({ round: 'North · Pass 3', at, archived: true, walkList: 'North' }, c);
  assert.match(shelved.error, /\(archived\)/);
  assert.match(shelved.error, /Delete that snapshot/);
  assert.match(shelved.error, /or unarchive North and bring the round back, then restore it/);

  const frozenDraft = roundClearedRefusal({ round: 'North · Pass 4', at, archived: false, walkList: 'North' }, c);
  assert.doesNotMatch(frozenDraft.error, /\(archived\)/);
  assert.match(frozenDraft.error, /Delete that snapshot/);
  assert.match(frozenDraft.error, /or unarchive North and restore it/);

  // End to end: what roundClearedSince returns renders the walk-list wording.
  const w = await seedWalkList(c, 'Wording');
  await activate(c, w.passes[0]);
  await archiveWalkList(c, w);
  const { run } = await unknockThenCleared(c, w, w.passes[0]);
  const msg = roundClearedRefusal(await held(c, run), c);
  assert.match(msg.error, /^Wording · Pass 1 \(archived\) had its knocks cleared on /);
  assert.match(msg.error, /Delete that snapshot on Turf Cutting/);
  assert.match(msg.error, /unarchive Wording and bring the round back/);
});
