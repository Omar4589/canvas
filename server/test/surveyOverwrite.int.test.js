import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The cross-canvasser survey overwrite fix, over the REAL app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/survey_overwrite_test node --test test/surveyOverwrite.int.test.js
//
// The bug this pins shut: the survey submit upserts on (voterId, passId), so canvasser B's
// submit for a voter canvasser A already surveyed in the SAME round used to $set away A's
// answers, note, authorship, GPS and any admin edit — silently. Now:
//   1. A cross-canvasser replacement ALWAYS leaves a SurveyResponseArchive row (every
//      interleaving, including the E11000 insert race) holding the full replaced doc.
//   2. A same-canvasser re-submit is the designed self-heal and archives NOTHING.
//   3. Admin restore is a lossless SWAP (the displaced current response is archived
//      via:'restore'), so flipping back and forth loses nothing, ever.
//   4. Stats never move for an overwrite or a swap — one current row per (voter, pass)
//      throughout, and the parity oracle never reads the archive.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-survey-overwrite';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { computeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
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
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf,
    TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive,
    SurveyTemplate, Subscription,
  ]) {
    await M.deleteMany({});
  }
  // The unique {voterId, passId} index and the archive's indexes must exist before the race
  // tests lean on them.
  await SurveyResponse.init();
  await SurveyResponseArchive.init();

  const org = await Organization.create({ name: 'Ow Org', slug: 'ow-org', isActive: true });
  const org2 = await Organization.create({ name: 'Other Org', slug: 'ow-other', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'owa@t.co', passwordHash: 'x', isActive: true });
  const admin2 = await User.create({ firstName: 'Eve', lastName: 'Elsewhere', email: 'owe@t.co', passwordHash: 'x', isActive: true });
  const alice = await User.create({ firstName: 'Alice', lastName: 'First', email: 'owf@t.co', passwordHash: 'x', isActive: true });
  const bob = await User.create({ firstName: 'Bob', lastName: 'Second', email: 'ows@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: admin2._id, organizationId: org2._id, role: 'admin', isActive: true });
  await Membership.create({ userId: alice._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: bob._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  await Subscription.create({ organizationId: org2._id, status: 'internal' });

  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Ow Survey', isActive: true,
    questions: [{ key: 'q1', label: 'Support?', type: 'single_choice', options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }] }],
  });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Ow C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  for (const u of [alice, bob]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
  }

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1,
    name: 'Round 1', status: 'active',
  });
  const homes = await Household.insertMany(
    [1, 2, 3].map((n) => ({
      organizationId: org._id, campaignId: camp._id, effortId: effort._id,
      addressLine1: `${n} Ow St`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `OW${n}`, location: { type: 'Point', coordinates: [-82.1 + n * 0.001, 28.2] },
      isActive: true, status: 'unknocked',
    }))
  );
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book Ow',
    mode: 'manual', status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of [alice, bob]) {
    await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const voters = await Voter.insertMany(
    [1, 2, 3].map((n) => ({
      organizationId: org._id, campaignId: camp._id, householdId: homes[n - 1]._id,
      stateVoterId: `OW-${n}`, firstName: 'V', lastName: `${n}`, fullName: `Voter ${n}`,
    }))
  );

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, org2, camp, template, pass, admin, admin2, alice, bob,
    v1: voters[0], v2: voters[1], v3: voters[2],
    adminTok: signUserToken(admin), admin2Tok: signUserToken(admin2),
    aliceTok: signUserToken(alice), bobTok: signUserToken(bob),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
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
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const loc = { lat: 28.2001, lng: -82.099, accuracy: 8 };
let minute = 0;
const nextTs = () => {
  minute += 1;
  return new Date(Date.now() - 3600_000 + minute * 60_000).toISOString();
};

const submit = (token, voterId, answerId, note) =>
  call('POST', `/mobile/voters/${voterId}/survey`, {
    token,
    orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'q1', questionLabel: 'Support?', optionIds: [answerId], answer: answerId === 'o1' ? 'Yes' : 'No' }],
      note: note ?? null,
      location: loc,
      timestamp: nextTs(),
    },
  });

async function assertParity(label) {
  const c = await Campaign.findById(ctx.camp._id, { stats: 1 }).lean();
  const fresh = await computeCampaignStats(ctx.camp._id);
  assert.strictEqual(c.stats.surveyCount || 0, fresh.surveyCount || 0, `${label}: surveyCount parity`);
  return c.stats;
}

test('1. cross-canvasser overwrite preserves the full replaced response', { skip }, async () => {
  const { v1, alice, bob } = ctx;
  assert.strictEqual((await submit(ctx.aliceTok, v1._id, 'o1', 'front porch chat')).status, 201);
  const before = await assertParity('after Alice');
  assert.strictEqual(before.surveyCount, 1);
  const aliceRow = await SurveyResponse.findOne({ voterId: v1._id }).lean();

  assert.strictEqual((await submit(ctx.bobTok, v1._id, 'o2')).status, 201);

  const current = await SurveyResponse.findOne({ voterId: v1._id }).lean();
  assert.strictEqual(String(current.userId), String(bob._id), 'current is Bob');
  assert.strictEqual(current.answers[0].optionIds[0], 'o2');

  const archives = await SurveyResponseArchive.find({ voterId: v1._id }).lean();
  assert.strictEqual(archives.length, 1, 'exactly one archive row');
  const a = archives[0];
  assert.strictEqual(String(a.userId), String(alice._id), 'archived author is Alice');
  assert.strictEqual(a.answers[0].optionIds[0], 'o1', 'her answer survived');
  assert.strictEqual(a.note, 'front porch chat', 'her note survived');
  assert.strictEqual(String(a.overwrittenBy), String(bob._id));
  assert.strictEqual(a.overwrittenVia, 'submit');
  assert.strictEqual(new Date(a.submittedAt).getTime(), new Date(aliceRow.submittedAt).getTime());
  assert.deepStrictEqual(
    { lat: a.location.lat, lng: a.location.lng, accuracy: a.location.accuracy },
    { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy },
    'her GPS survived'
  );
  assert.strictEqual(String(a.passId), String(aliceRow.passId));

  const after = await assertParity('after Bob overwrote');
  assert.strictEqual(after.surveyCount, 1, 'overwrite moves no counters');
});

test('2. same-canvasser re-submit is the self-heal — archives nothing', { skip }, async () => {
  const { v1 } = ctx;
  const beforeCount = await SurveyResponseArchive.countDocuments({ voterId: v1._id });
  assert.strictEqual((await submit(ctx.bobTok, v1._id, 'o1')).status, 201);
  assert.strictEqual(
    await SurveyResponseArchive.countDocuments({ voterId: v1._id }),
    beforeCount,
    'no new archive row'
  );
  const current = await SurveyResponse.findOne({ voterId: v1._id }).lean();
  assert.strictEqual(current.answers[0].optionIds[0], 'o1', 'his re-submit replaced his own');
  await assertParity('after self-heal');
});

test('3. an admin-edited response, later overwritten, is archived WITH its edit audit', { skip }, async () => {
  const { v2, admin, alice } = ctx;
  assert.strictEqual((await submit(ctx.aliceTok, v2._id, 'o1')).status, 201);
  const row = await SurveyResponse.findOne({ voterId: v2._id }).lean();
  const patch = await call('PATCH', `/admin/voters/${v2._id}/surveys/${row._id}`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { answers: [{ questionKey: 'q1', questionLabel: 'Support?', optionIds: ['o2'], answer: 'No' }] },
  });
  assert.strictEqual(patch.status, 200);

  assert.strictEqual((await submit(ctx.bobTok, v2._id, 'o1')).status, 201);
  const a = await SurveyResponseArchive.findOne({ voterId: v2._id }).lean();
  assert.ok(a, 'archived');
  assert.strictEqual(String(a.editedBy), String(admin._id), 'the admin edit audit rode into the archive');
  assert.ok(a.editedAt, 'editedAt too');
  assert.strictEqual(a.answers[0].optionIds[0], 'o2', 'the EDITED answers were preserved');
  assert.strictEqual(String(a.userId), String(alice._id));

  const current = await SurveyResponse.findOne({ voterId: v2._id }).lean();
  assert.strictEqual(current.editedBy, null, 'fresh submission cleared the live edit audit (unchanged behavior)');
});

test('4. restore is a lossless swap — twice over returns the exact prior state', { skip }, async () => {
  const { v1, alice, bob, admin } = ctx;
  // State from tests 1-2: current = Bob (o1 after self-heal), archive = Alice (o1, note).
  const archive = await SurveyResponseArchive.findOne({ voterId: v1._id }).lean();
  const currentBefore = await SurveyResponse.findOne({ voterId: v1._id }).lean();

  const r = await call('POST', `/admin/voters/${v1._id}/surveys/${archive._id}/restore`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.surveys, 'returns the rebuilt profile');

  const current = await SurveyResponse.findOne({ voterId: v1._id }).lean();
  assert.strictEqual(String(current._id), String(currentBefore._id), 'same row, swapped in place');
  assert.strictEqual(String(current.userId), String(alice._id), 'Alice is current again');
  assert.strictEqual(current.note, 'front porch chat', 'her note came back');
  assert.strictEqual(current.answers[0].optionIds[0], 'o1');

  const newArchives = await SurveyResponseArchive.find({ voterId: v1._id }).lean();
  assert.strictEqual(newArchives.length, 1, 'the promoted row was consumed; the displaced one preserved');
  assert.strictEqual(String(newArchives[0].userId), String(bob._id), "Bob's displaced response is archived");
  assert.strictEqual(newArchives[0].overwrittenVia, 'restore');
  assert.strictEqual(String(newArchives[0].overwrittenBy), String(admin._id), 'the admin who swapped');

  await assertParity('after restore');

  // Swap back — the state must return field-for-field.
  const r2 = await call('POST', `/admin/voters/${v1._id}/surveys/${newArchives[0]._id}/restore`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r2.status, 200);
  const current2 = await SurveyResponse.findOne({ voterId: v1._id }).lean();
  assert.strictEqual(String(current2.userId), String(bob._id));
  assert.strictEqual(current2.answers[0].optionIds[0], currentBefore.answers[0].optionIds[0]);
  assert.strictEqual(
    new Date(current2.submittedAt).getTime(),
    new Date(currentBefore.submittedAt).getTime(),
    'byte-equivalent restore of the restore'
  );
  await assertParity('after re-restore');
});

test('5. restore 404 matrix', { skip }, async () => {
  const { v1 } = ctx;
  const bogus = new mongoose.Types.ObjectId();
  assert.strictEqual(
    (await call('POST', `/admin/voters/${v1._id}/surveys/${bogus}/restore`, { token: ctx.adminTok, orgId: ctx.org._id })).status,
    404, 'unknown archiveId'
  );
  const archive = await SurveyResponseArchive.findOne({ voterId: v1._id }).lean();
  assert.strictEqual(
    (await call('POST', `/admin/voters/${ctx.v2._id}/surveys/${archive._id}/restore`, { token: ctx.adminTok, orgId: ctx.org._id })).status,
    404, 'mismatched voterId'
  );
  assert.strictEqual(
    (await call('POST', `/admin/voters/${v1._id}/surveys/${archive._id}/restore`, { token: ctx.admin2Tok, orgId: ctx.org2._id })).status,
    404, "another org's admin cannot see it"
  );
  assert.strictEqual(
    (await call('POST', `/admin/voters/${v1._id}/surveys/not-an-id/restore`, { token: ctx.adminTok, orgId: ctx.org._id })).status,
    400, 'malformed archiveId'
  );
});

test('6. DELETE current keeps archived siblings; restore resurrects; archive DELETE erases', { skip }, async () => {
  const { v1 } = ctx;
  const current = await SurveyResponse.findOne({ voterId: v1._id }).lean();
  const del = await call('DELETE', `/admin/voters/${v1._id}/surveys/${current._id}`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ voterId: v1._id }), 1, 'sibling survives the delete');
  let stats = await assertParity('after delete');
  assert.strictEqual(stats.surveyCount, 1, 'v1 deleted → only v2 counts (v3 has none yet)');
  let voter = await Voter.findById(v1._id).lean();
  assert.strictEqual(voter.surveyStatus, 'not_surveyed', 'status recomputed after delete');

  // Restore into the void: the preserved response becomes current again.
  const archive = await SurveyResponseArchive.findOne({ voterId: v1._id }).lean();
  const r = await call('POST', `/admin/voters/${v1._id}/surveys/${archive._id}/restore`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await SurveyResponse.countDocuments({ voterId: v1._id }), 1, 'resurrected');
  stats = await assertParity('after resurrect');
  voter = await Voter.findById(v1._id).lean();
  assert.strictEqual(voter.surveyStatus, 'surveyed', 'status recomputed after resurrect');
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ voterId: v1._id }), 0, 'archive consumed');

  // Manufacture one archive row and erase it outright. The resurrect just made ALICE current
  // again, so the cross-user overwrite has to come from Bob.
  assert.strictEqual((await submit(ctx.bobTok, v1._id, 'o2')).status, 201);
  const toErase = await SurveyResponseArchive.findOne({ voterId: v1._id }).lean();
  assert.ok(toErase);
  const erase = await call('DELETE', `/admin/voters/${v1._id}/surveys/archive/${toErase._id}`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(erase.status, 200);
  assert.strictEqual(
    (await call('DELETE', `/admin/voters/${v1._id}/surveys/archive/${toErase._id}`, { token: ctx.adminTok, orgId: ctx.org._id })).status,
    404, 'second erase is a 404'
  );
  await assertParity('after erase');
});

test('7. profile wire: replacedEarlier + overwrittenSurveys', { skip }, async () => {
  const { v2, alice, bob } = ctx;
  // From test 3: current = Bob, archive = Alice (edited).
  const prof = await call('GET', `/admin/voters/${v2._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(prof.status, 200);
  const s = prof.json.surveys[0];
  assert.ok(s.replacedEarlier, 'winner carries the pointer');
  assert.strictEqual(s.replacedEarlier.by.name, 'Alice First');
  const ow = prof.json.overwrittenSurveys;
  assert.strictEqual(ow.length, 1);
  assert.strictEqual(ow[0].by.name, 'Alice First');
  assert.strictEqual(ow[0].overwrittenBy.name, 'Bob Second');
  assert.strictEqual(ow[0].answers[0].answer, 'No', 'the preserved (edited) answers ship');
  assert.strictEqual(ow[0].overwrittenVia, 'submit');
});

test('8. races: same-user double-tap never archives; cross-user race archives exactly once', { skip }, async () => {
  const { v3, alice, bob } = ctx;
  // Same-user double-tap on a fresh voter.
  const [x, y] = await Promise.all([submit(ctx.aliceTok, v3._id, 'o1'), submit(ctx.aliceTok, v3._id, 'o1')]);
  assert.ok([x.status, y.status].every((s) => s === 201));
  assert.strictEqual(await SurveyResponse.countDocuments({ voterId: v3._id }), 1, 'one current row');
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ voterId: v3._id }), 0, 'no archive from a self-race');
  await assertParity('after same-user race');

  // Cross-user near-simultaneous: whichever interleaving ran, exactly one archive row exists
  // and its author is not the final winner.
  await SurveyResponse.deleteMany({ voterId: v3._id });
  await ctx.camp.constructor.updateOne({ _id: ctx.camp._id }, { $inc: { 'stats.surveyCount': -1 } });
  const [p, q] = await Promise.all([submit(ctx.aliceTok, v3._id, 'o1'), submit(ctx.bobTok, v3._id, 'o2')]);
  assert.ok([p.status, q.status].every((s) => s === 201));
  assert.strictEqual(await SurveyResponse.countDocuments({ voterId: v3._id }), 1, 'one current row');
  const current = await SurveyResponse.findOne({ voterId: v3._id }).lean();
  const archives = await SurveyResponseArchive.find({ voterId: v3._id }).lean();
  assert.strictEqual(archives.length, 1, 'exactly one archive row in either interleaving');
  assert.notStrictEqual(String(archives[0].userId), String(current.userId), 'the archived author is the non-final submitter');
  assert.ok(
    [String(alice._id), String(bob._id)].includes(String(archives[0].userId)),
    'and is one of the two racers'
  );
  await assertParity('after cross-user race');
});
