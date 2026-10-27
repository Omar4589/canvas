import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Door flags that depend on WHO LIVES THERE — fullyVoted, fullyDnc, isActive — stay true whenever a door's
// residents change, over the REAL app and import worker on a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/resident_flags_test node --test test/residentFlags.int.test.js
// Locks the 2026-10-27 fixes (docs/EARLY_VOTING.md §F): a person added at a door that dropped while a phone
// still showed it re-opens it; deleting a door's last un-voted resident drops it at once; undoing an import
// finishes again the doors it had re-opened (voted, and the do-not-contact twin, including an inserted door
// kept for its flagged resident); an import that moves people re-checks BOTH doors of every move (voted and
// DNC, into a brand-new door or out of an old one), and a crash-retry recovers the moved doors from the job.
// Plus the phone half: /changes carries every KNOCKABLE_DOOR_FILTER flag, so mobile/lib/deltaFold.js can
// tell a door that came back (pull a fresh bootstrap) from one that is still suppressed (drop it).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-resident-flags';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VotedVoter } = await import('../src/models/VotedVoter.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { recomputeFullyVoted } = await import('../src/services/voted/recomputeFullyVoted.js');
const { recomputeFullyDnc } = await import('../src/services/dnc/recomputeFullyDnc.js');
const { undoFileImport } = await import('../src/services/import/undoImport.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');
const { KNOCKABLE_DOOR_FILTER } = await import('../src/services/canvass/knockableDoorFilter.js');
// The phone's own fold (pure, no relative imports — node loads it as it ships).
const { foldDeltaHouseholds, returningDoorIds } = await import('../../mobile/lib/deltaFold.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || ctx.adminTok}`,
      'X-Org-Id': String(ctx.org._id),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const LOC = { lat: 28.3001, lng: -81.399, accuracy: 8 };
const hexId = () => new mongoose.Types.ObjectId().toHexString();
const door = (id) => Household.findById(id).lean();
const tick = () => new Promise((r) => setTimeout(r, 15));

// Marks people voted the way an early-voting upload leaves them (a VotedVoter row each), then recomputes.
const markVoted = async (voters) => {
  await VotedVoter.insertMany(voters.map((v) => ({
    organizationId: ctx.org._id, campaignId: v.campaignId, voterId: v._id, householdId: v.householdId,
    stateVoterId: v.stateVoterId, uploadId: ctx.uploadId,
  })));
  await recomputeFullyVoted(voters[0].campaignId, voters.map((v) => v.householdId));
};
// Flags people do-not-contact the way the admin route leaves them, then recomputes.
const flagDnc = async (voters) => {
  await Voter.updateMany(
    { _id: { $in: voters.map((v) => v._id) } },
    { $set: { doNotContact: { flagged: true, at: new Date(), source: 'admin' } } }
  );
  await recomputeFullyDnc(voters.map((v) => v.householdId));
};

const bootstrapOf = async (token) => {
  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, { token });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const changesOf = async (token, since) => {
  const r = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(since)}`, { token });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json;
};

// Import rows in the built-in vendor profile's columns, pins inside Nebraska (the import refuses a pin outside
// its row's own state). One address per letter, so each letter is one door.
const HEADER = ['State Voter ID', 'First Name', 'Last Name', 'Address', 'City', 'Registered State', 'Zip Code', 'p_Latitude', 'p_Longitude'];
const ADDR = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 };
const csvOf = (rows) =>
  Buffer.from(
    [HEADER.join(',')].concat(rows.map(([id, first, at]) =>
      [id, first, 'Mover', `${10 + ADDR[at]} ${at} St`, 'Lincoln', 'NE', '68508', (40.8 + ADDR[at] * 0.001).toFixed(6), '-96.700000'].join(',')
    )).join('\n') + '\n'
  );
const runImport = async (rows, jobId = null) => {
  const job = jobId
    ? await ImportJob.findById(jobId)
    : await ImportJob.create({
        organizationId: ctx.org._id, campaignId: ctx.neCamp._id, filename: `move-${Date.now()}.csv`,
        kind: 'apply', status: 'pending', fieldMapping: DEFAULT_PROFILE_MAPPING,
      });
  await saveRawImport(job._id, job.filename, csvOf(rows));
  await processImportJob({ id: `rf-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  const done = await ImportJob.findById(job._id).lean();
  assert.strictEqual(done.status, 'completed', JSON.stringify(done.errors));
  return done;
};
const doorOf = async (svid) => door((await Voter.findOne({ campaignId: ctx.neCamp._id, stateVoterId: svid }).lean()).householdId);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, Effort, Pass, Turf,
    TurfAssignment, Household, Voter, VotedVoter, ImportJob, SurveyTemplate]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Resident Org', slug: 'resident-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'rf-a@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Walker', email: 'rf-c@t.co', passwordHash: 'x', isActive: true });
  const tom = await User.create({ firstName: 'Tom', lastName: 'Teammate', email: 'rf-t@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: cara._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: tom._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Ask', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Resident C', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id,
  });
  const neCamp = await Campaign.create({ organizationId: org._id, name: 'Mover C', type: 'survey', state: 'NE', isActive: true });
  for (const u of [cara, tom]) await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });
  const mk = (n, effortId = effort._id) => ({
    organizationId: org._id, campaignId: camp._id, effortId,
    addressLine1: `${n} Resident Rd`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} RESIDENT RD|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.399, 28.3] }, status: 'unknocked', isActive: true,
  });
  // W1-W3 are in one book Cara and Tom share; E is an Intake door (no walk list) for the undo case.
  const [w1, w2, w3, e] = await Household.insertMany([mk(1), mk(2), mk(3), mk(4, null)]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book R', mode: 'manual',
    status: 'published', householdIds: [w1._id, w2._id, w3._id], doorCount: 3,
  });
  for (const u of [cara, tom]) {
    await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const v = (hh, svid, first, extra = {}) => ({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: svid,
    firstName: first, lastName: 'Resident', fullName: `${first} Resident`, ...extra,
  });
  const [ann, cy, dee, w3v] = await Voter.insertMany([v(w1, 'FL1', 'Ann'), v(w2, 'FL2', 'Cy'), v(e, 'FL4', 'Dee'), v(w3, 'FL3', 'Wes')]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, cara, tom, camp, neCamp, effort, pass, turf, w1, w2, w3, e, ann, cy, dee, w3v,
    uploadId: new mongoose.Types.ObjectId(),
    adminTok: signUserToken(admin), caraTok: signUserToken(cara), tomTok: signUserToken(tom),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('1. a person added at a door that just dropped re-opens it, and a teammate\'s phone gets it back', { skip }, async () => {
  await markVoted([ctx.ann]);
  assert.strictEqual((await door(ctx.w1._id)).fullyVoted, true, 'Ann was its only resident');
  // Tom's phone has already dropped W1; Cara's still shows it (door screen open, or offline).
  const tomPhone = await bootstrapOf(ctx.tomTok);
  assert.ok(!tomPhone.households.some((h) => String(h._id) === String(ctx.w1._id)));
  await tick();

  const r = await call('POST', `/mobile/households/${ctx.w1._id}/voters`, {
    token: ctx.caraTok, body: { voterId: hexId(), firstName: 'Bo', lastName: 'Walkup', location: LOC },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual((await door(ctx.w1._id)).fullyVoted, false, 'Bo has not voted, so W1 is a door to knock again');

  // The next poll on Tom's phone: W1 rides it with EVERY knockable-door flag, and the phone's rule names it as
  // a door that came back (map.jsx then pulls a fresh bootstrap, which holds it).
  const delta = await changesOf(ctx.tomTok, tomPhone.generatedAt);
  const row = delta.households.find((h) => String(h._id) === String(ctx.w1._id));
  assert.ok(row, 'W1 is in the delta');
  for (const flag of Object.keys(KNOCKABLE_DOOR_FILTER)) assert.ok(flag in row, `the delta carries ${flag}`);
  assert.deepStrictEqual(returningDoorIds(tomPhone.households, delta.households), [String(ctx.w1._id)]);
  assert.ok((await bootstrapOf(ctx.tomTok)).households.some((h) => String(h._id) === String(ctx.w1._id)));
});

test('2. deleting the last un-voted person at a door drops it at once', { skip }, async () => {
  const di = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: ctx.w2._id, stateVoterId: `manual:${hexId()}`,
    firstName: 'Di', lastName: 'Walkup', fullName: 'Di Walkup', doorAdded: { byUserId: ctx.cara._id, at: new Date() },
  });
  await markVoted([ctx.cy]);
  assert.strictEqual((await door(ctx.w2._id)).fullyVoted, false, 'Di, added at the door, keeps it open');
  const tomPhone = await bootstrapOf(ctx.tomTok);
  await tick();

  const r = await call('DELETE', `/admin/voters/${di._id}`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await door(ctx.w2._id)).fullyVoted, true, 'everyone left has voted');
  const delta = await changesOf(ctx.tomTok, tomPhone.generatedAt);
  const folded = foldDeltaHouseholds(tomPhone.households, delta.households);
  assert.ok(!folded.some((h) => String(h._id) === String(ctx.w2._id)), 'the open phone drops W2 on its next poll');
});

test('3. a door taken out of books mid-shift leaves an open phone, and never reads as a door coming back', { skip }, async () => {
  const tomPhone = await bootstrapOf(ctx.tomTok);
  assert.ok(tomPhone.households.some((h) => String(h._id) === String(ctx.w3._id)));
  await tick();
  await Household.updateOne({ _id: ctx.w3._id }, { $set: { excludedFromTurf: true } });
  const delta = await changesOf(ctx.tomTok, tomPhone.generatedAt);
  const folded = foldDeltaHouseholds(tomPhone.households, delta.households);
  assert.ok(!folded.some((h) => String(h._id) === String(ctx.w3._id)), 'dropped, like a fresh bootstrap would');
  assert.deepStrictEqual(returningDoorIds(folded, delta.households), [], 'no reload for a door still suppressed');
  await Household.updateOne({ _id: ctx.w3._id }, { $set: { excludedFromTurf: false } });
});

test('4. undoing an import finishes again the doors it had re-opened (voted, and do-not-contact)', { skip }, async () => {
  // E (an existing Intake door): Dee voted; the import added Eli, who hasn't, re-opening it.
  await markVoted([ctx.dee]);
  const eli = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: ctx.e._id, stateVoterId: 'FL5', firstName: 'Eli', lastName: 'New', fullName: 'Eli New',
  });
  await recomputeFullyVoted(ctx.camp._id, [ctx.e._id]);
  assert.strictEqual((await door(ctx.e._id)).fullyVoted, false);
  // F (a door the import inserted): Fay and Gus are new; Fay asked not to be contacted afterwards, so undo keeps
  // her record — and her door, which now holds only her.
  const [f] = await Household.insertMany([{
    organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: null, addressLine1: '9 Undo Ave', city: 'Town', state: 'FL',
    zipCode: '34741', normalizedAddress: '9 UNDO AVE|TOWN|FL|34741', location: { type: 'Point', coordinates: [-81.4, 28.3] },
    status: 'unknocked', isActive: true,
  }]);
  const [fay, gus] = await Voter.insertMany([
    { organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: f._id, stateVoterId: 'FL6', firstName: 'Fay', lastName: 'New', fullName: 'Fay New' },
    { organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: f._id, stateVoterId: 'FL7', firstName: 'Gus', lastName: 'New', fullName: 'Gus New' },
  ]);
  await flagDnc([fay]);
  assert.strictEqual((await door(f._id)).fullyDnc, false, 'Gus can still be contacted');
  const job = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, filename: 'refresh.csv', kind: 'apply', status: 'completed',
    insertedHouseholdIds: [f._id], insertedVoterIds: [eli._id, fay._id, gus._id],
  });

  const r = await undoFileImport(await ImportJob.findById(job._id).lean(), ctx.org._id, ctx.admin._id);
  assert.strictEqual(r.votersDeleted, 2, 'Eli and Gus go; Fay\'s request stays');
  assert.strictEqual((await door(ctx.e._id)).fullyVoted, true, 'E: everyone left has voted');
  const fAfter = await door(f._id);
  assert.ok(fAfter, 'F is kept for Fay');
  assert.strictEqual(fAfter.fullyDnc, true, 'F: everyone left asked not to be contacted');
  assert.strictEqual(fAfter.isActive, true);
});

test('5. an import that moves people re-checks both doors of every move', { skip }, async () => {
  // A: Hal ✓ Ida ·  B: Kim ✓ Liz ·  C: Pat (DNC) Quinn ·  D: Rex (DNC)
  await runImport([['NE1', 'Hal', 'A'], ['NE2', 'Ida', 'A'], ['NE3', 'Kim', 'B'], ['NE4', 'Liz', 'B'], ['NE5', 'Pat', 'C'], ['NE6', 'Quinn', 'C'], ['NE7', 'Rex', 'D']]);
  const ne = async (svid) => Voter.findOne({ campaignId: ctx.neCamp._id, stateVoterId: svid }).lean();
  await markVoted([await ne('NE1'), await ne('NE3')]);
  await flagDnc([await ne('NE5'), await ne('NE7')]);
  ctx.doorA = (await doorOf('NE1'))._id;
  ctx.doorC = (await doorOf('NE5'))._id;
  assert.strictEqual((await door(ctx.doorA)).fullyVoted, false);
  assert.strictEqual((await door(ctx.doorC)).fullyDnc, false);

  // The refreshed file moves Ida, Kim, Quinn and Rex to new addresses.
  const job = await runImport([['NE2', 'Ida', 'E'], ['NE3', 'Kim', 'F'], ['NE6', 'Quinn', 'G'], ['NE7', 'Rex', 'H']]);
  ctx.moveJob = job;
  ctx.doorF = (await doorOf('NE3'))._id;
  ctx.doorH = (await doorOf('NE7'))._id;
  assert.strictEqual(job.movedVoters, 4);
  assert.strictEqual((await door(ctx.doorA)).fullyVoted, true, 'A: Ida left, everyone left (Hal) voted');
  assert.strictEqual((await door(ctx.doorF)).fullyVoted, true, 'F: Kim, who voted, moved into a new door alone');
  assert.strictEqual((await door(ctx.doorC)).fullyDnc, true, 'C: Quinn left, everyone left (Pat) asked not to be contacted');
  assert.strictEqual((await door(ctx.doorH)).fullyDnc, true, 'H: Rex, flagged, moved into a new door alone');
  for (const svid of ['NE2', 'NE4', 'NE6']) {
    const d = await doorOf(svid);
    assert.strictEqual(d.fullyVoted || d.fullyDnc, false, `${svid}'s door is still one to knock`);
  }
  assert.strictEqual((await doorOf('NE7')).isActive, true);
  assert.strictEqual(job.movedHouseholdIds.length, 8, 'A-H: the old and new door of each move, kept on the job');
});

test('6. a crash-retry of that import recovers the moved doors from the job', { skip }, async () => {
  // A crash after the write but before the recomputes leaves the flags stale; the retry re-reads post-move state,
  // where nobody looks moved, so only the job's list can name these doors.
  await Household.updateMany({ _id: { $in: [ctx.doorA, ctx.doorF] } }, { $set: { fullyVoted: false } });
  await Household.updateMany({ _id: { $in: [ctx.doorC, ctx.doorH] } }, { $set: { fullyDnc: false } });
  await runImport([['NE2', 'Ida', 'E'], ['NE3', 'Kim', 'F'], ['NE6', 'Quinn', 'G'], ['NE7', 'Rex', 'H']], ctx.moveJob._id);
  assert.strictEqual((await door(ctx.doorA)).fullyVoted, true);
  assert.strictEqual((await door(ctx.doorF)).fullyVoted, true);
  assert.strictEqual((await door(ctx.doorC)).fullyDnc, true);
  assert.strictEqual((await door(ctx.doorH)).fullyDnc, true);
});
