import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Crew changes as one job kept on the roster row (docs/PROPOSAL_PEOPLE_PAGES.md §B.3-§B.7, §L):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crewjob node --import ./scripts/testIndexPreload.mjs --test test/crewJob.int.test.js
//
// Every test builds its own people, so none depends on another's state. A cut-off change is built
// directly as the state a crash leaves (a job on the row, the ledger part-moved, a record or not), and
// then driven through the real routes — the review prototype killed real processes at each point; these
// pin what happens after.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-crew-job';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { releaseAssignedWork } = await import('../src/services/users/deleteAccount.js');
const { CREW_JOB } = await import('../src/services/memberships/setCoordinator.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
let seq = 0;
const timings = { ...CREW_JOB };

const mkPerson = async (first, role = 'canvasser', { orgId = ctx.org._id, isActive = true } = {}) => {
  const u = await User.create({
    firstName: first, lastName: `T${++seq}`, email: `${first.toLowerCase()}${seq}@crewjob.t.co`,
    passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: u._id, organizationId: orgId, role, isActive, billingAccess: role === 'admin' });
  return u;
};
const tokenOf = (u) => signUserToken(u);
const onRoster = (u, coordinatorId = null, campaign = ctx.camp) =>
  CampaignAssignment.create({ campaignId: campaign._id, userId: u._id, organizationId: ctx.org._id, coordinatorId });

// Ledger rows for one person, stamped with a team, inserted raw (fast, as the write path leaves them).
const rows = async (u, coord, { knocks = 0, notes = 0, restricted = 0, surveys = 0, house = null, campaign = ctx.camp } = {}) => {
  const at = new Date('2026-10-01T15:00:00Z');
  const base = (h) => ({
    organizationId: ctx.org._id, campaignId: campaign._id, effortId: ctx.effort._id, passId: ctx.pass._id,
    householdId: h || new ObjectId(), userId: u._id, coordinatorId: coord ? coord._id || coord : null,
    location: { lat: 28.3, lng: -81.4 }, timestamp: at, createdAt: at, updatedAt: at,
  });
  const acts = [
    ...Array.from({ length: knocks }, () => ({ ...base(house), _id: new ObjectId(), actionType: 'not_home' })),
    ...Array.from({ length: notes }, () => ({ ...base(), _id: new ObjectId(), actionType: 'note_added' })),
    ...Array.from({ length: restricted }, () => ({ ...base(), _id: new ObjectId(), actionType: 'restricted' })),
  ];
  if (acts.length) await CanvassActivity.collection.insertMany(acts);
  if (surveys) {
    await SurveyResponse.collection.insertMany(
      Array.from({ length: surveys }, () => ({
        _id: new ObjectId(), organizationId: ctx.org._id, campaignId: campaign._id, passId: new ObjectId(), voterId: new ObjectId(),
        householdId: new ObjectId(), userId: u._id, coordinatorId: coord ? coord._id || coord : null,
        surveyTemplateId: new ObjectId(), surveyTemplateVersion: 1, answers: [], location: { lat: 28.3, lng: -81.4 },
        submittedAt: at, createdAt: at, updatedAt: at,
      }))
    );
  }
};

// How many of a person's rows on a campaign count for each team, both ledgers together.
const stamps = async (u, campaign = ctx.camp) => {
  const out = {};
  for (const M of [CanvassActivity, SurveyResponse]) {
    for (const r of await M.collection.aggregate([{ $match: { campaignId: campaign._id, userId: u._id } }, { $group: { _id: '$coordinatorId', n: { $sum: 1 } } }]).toArray()) {
      const k = r._id ? String(r._id) : 'none';
      out[k] = (out[k] || 0) + r.n;
    }
  }
  return out;
};
const rosterRow = (u, campaign = ctx.camp) => CampaignAssignment.findOne({ campaignId: campaign._id, userId: u._id }).lean();
const records = (u, campaign = ctx.camp) => CoordinatorChange.find({ campaignId: campaign._id, userId: u._id }).sort({ createdAt: 1 }).lean();

const api = async (method, path, token, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const crewPath = (u, campaign = ctx.camp) => `/admin/campaigns/${campaign._id}/crew/${u._id}`;
const setCrew = (u, coordinatorId, extra = {}, token = ctx.adaToken) =>
  api('PATCH', `${crewPath(u)}/coordinator`, token, { coordinatorId: coordinatorId ? String(coordinatorId) : null, ...extra });
const preview = (u, coordinatorId, token = ctx.adaToken) =>
  api('GET', `${crewPath(u)}/coordinator-preview?coordinatorId=${coordinatorId ? String(coordinatorId) : 'none'}`, token);

// The state a change cut off at the ledger leaves: crew already `to`, the job still on the row with its
// hold passed, some rows moved and some not.
const tornJob = async (u, { from, to, planned }) => {
  const token = new ObjectId();
  await CampaignAssignment.updateOne(
    { campaignId: ctx.camp._id, userId: u._id },
    {
      $set: {
        coordinatorId: to ? to._id : null,
        crewJob: {
          token, run: 'run-1', until: new Date(Date.now() - 1000), from: from ? from._id : null, to: to ? to._id : null,
          sources: [{ coordinatorId: from ? from._id : null, activities: planned, surveys: 0, doors: planned, latest: new Date() }],
          activities: planned, surveys: 0, doors: planned, byUserId: ctx.ada._id, source: 'lead_crew',
        },
      },
    }
  );
  return token;
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb: an undeclared filter key is stripped
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([CampaignAssignment.init(), CoordinatorChange.init(), CanvassActivity.init(), SurveyResponse.init()]);
  Object.assign(CREW_JOB, { secondPassMs: 20 });

  ctx.org = await Organization.create({ name: 'Crew Job Org', slug: 'crew-job-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  ctx.ada = await mkPerson('Ada', 'admin');
  ctx.adaToken = tokenOf(ctx.ada);
  ctx.dana = await mkPerson('Dana', 'lead');
  ctx.yan = await mkPerson('Yan', 'lead');
  ctx.zoe = await mkPerson('Zoe', 'lead');
  ctx.lee = await mkPerson('Lee', 'lead');
  ctx.leeToken = tokenOf(ctx.lee);
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Fall Canvass', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  ctx.effort = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Main' });
  ctx.pass = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.effort._id, roundNumber: 1, name: 'Round 1' });
  await CampaignManager.create({ campaignId: ctx.camp._id, userId: ctx.lee._id, organizationId: ctx.org._id, grantedBy: ctx.ada._id });

  server = (await import('node:http')).createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(CREW_JOB, timings);
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── One person ────────────────────────────────────────────────────────────────────────────────────

test('a crew change moves every row on both ledgers and writes one record with the planned counts', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 25, notes: 3, restricted: 2, surveys: 5 });

  const r = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.restamp.error, null);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 35 });
  const row = await rosterRow(pat);
  assert.strictEqual(String(row.coordinatorId), String(ctx.yan._id));
  assert.strictEqual(row.crewJob, undefined, 'the job is released');
  const recs = await records(pat);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(String(recs[0].fromCoordinatorId), String(ctx.dana._id));
  assert.strictEqual(String(recs[0].toCoordinatorId), String(ctx.yan._id));
  assert.deepStrictEqual([recs[0].activitiesMoved, recs[0].surveysMoved, recs[0].doorsMoved], [30, 5, 25]);
  assert.strictEqual(recs[0].restampError, null);
});

test('the preview equals the write: doors, rows and the source teams', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 6, surveys: 2 });
  await rows(pat, null, { knocks: 4 });
  const p = await preview(pat, ctx.yan._id);
  assert.strictEqual(p.status, 200, JSON.stringify(p.json));
  assert.deepStrictEqual([p.json.doors, p.json.activities, p.json.surveys], [10, 10, 2]);
  assert.deepStrictEqual(p.json.sources.map((s) => [s.coordinatorId ? 'dana' : 'none', s.doors]).sort(), [['dana', 6], ['none', 4]]);
  const r = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.json.restamp.doors, r.json.restamp.activities, r.json.restamp.surveys], [10, 10, 2]);
  const [rec] = await records(pat);
  assert.strictEqual(rec.sources.length, 2, 'doors from two teams');
});

test('a stale `from` answers changed-meanwhile and moves nothing', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.yan._id);
  await rows(pat, ctx.yan, { knocks: 5 });
  const r = await setCrew(pat, ctx.zoe._id, { fromCoordinatorId: String(ctx.dana._id) });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'changed-meanwhile');
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 5 });
  assert.strictEqual((await records(pat)).length, 0);
});

test('a change still running answers busy with how long to wait, and the preview says so', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await CampaignAssignment.updateOne(
    { campaignId: ctx.camp._id, userId: pat._id },
    { $set: { crewJob: { token: new ObjectId(), run: 'r', until: new Date(Date.now() + 60_000), from: ctx.dana._id, to: ctx.dana._id, activities: 0, surveys: 0, doors: 0, source: 'lead_crew' } } }
  );
  const r = await setCrew(pat, ctx.yan._id);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'busy');
  assert.ok(r.json.retryAfterSeconds > 50 && r.json.retryAfterSeconds <= 60, String(r.json.retryAfterSeconds));
  const p = await preview(pat, ctx.dana._id);
  assert.strictEqual(p.json.busy, true);
  assert.strictEqual(p.json.finishIt, false);
});

test('Finish it completes a change cut off at the ledger, and clears its error record', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.yan._id);
  await rows(pat, ctx.zoe, { knocks: 8 });
  await rows(pat, ctx.yan, { knocks: 12, surveys: 3 });
  const token = await tornJob(pat, { from: ctx.yan, to: ctx.zoe, planned: 20 });
  await CoordinatorChange.create({
    _id: token, organizationId: ctx.org._id, campaignId: ctx.camp._id, userId: pat._id, fromCoordinatorId: ctx.yan._id,
    toCoordinatorId: ctx.zoe._id, source: 'lead_crew', restampError: 'operation exceeded time limit', activitiesMoved: 20,
  });

  const p = await preview(pat, ctx.zoe._id);
  assert.strictEqual(p.json.unfinished, true);
  assert.strictEqual(p.json.finishIt, true);
  const r = await setCrew(pat, ctx.zoe._id);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.finished, true);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.zoe._id)]: 23 });
  assert.strictEqual((await rosterRow(pat)).crewJob, undefined);
  const recs = await records(pat);
  assert.strictEqual(recs.length, 1, 'the same record, not a second one');
  assert.strictEqual(String(recs[0]._id), String(token));
  assert.strictEqual(recs[0].restampError, null);
  assert.strictEqual(recs[0].activitiesMoved, 20, 'the planned count');
});

test('Finish it after a crash that left no record writes exactly one', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.yan._id);
  await rows(pat, ctx.yan, { knocks: 5 });
  const token = await tornJob(pat, { from: ctx.yan, to: ctx.zoe, planned: 5 });
  const r = await setCrew(pat, ctx.zoe._id);
  assert.strictEqual(r.status, 200);
  const recs = await records(pat);
  assert.deepStrictEqual(recs.map((x) => String(x._id)), [String(token)]);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.zoe._id)]: 5 });
});

test('a different pick after a crash records the old job as interrupted, finishes its work and closes it', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.yan._id);
  await rows(pat, ctx.yan, { knocks: 4 });
  await rows(pat, ctx.zoe, { knocks: 6 });
  const token = await tornJob(pat, { from: ctx.yan, to: ctx.zoe, planned: 10 });
  const r = await setCrew(pat, ctx.dana._id, { fromCoordinatorId: String(ctx.zoe._id) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 10 });
  const recs = await records(pat);
  assert.strictEqual(recs.length, 2);
  const old = recs.find((x) => String(x._id) === String(token));
  const fresh = recs.find((x) => String(x._id) !== String(token));
  assert.strictEqual(old.restampError, 'interrupted');
  assert.ok(old.createdAt && old.updatedAt, 'an insert-only record still carries its times');
  assert.strictEqual(String(old.finishedBy), String(fresh._id), 'closed by the change that finished its work');
  assert.strictEqual(fresh.sources.length, 2, 'the new change took doors from two teams');
});

test('a lost hold stops the run, leaves the job for Finish it, and never overwrites a record', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 7 });
  CREW_JOB.holdMs = -1000; // the claim's hold has already passed when the first renewal runs
  let r;
  try {
    r = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
  } finally {
    CREW_JOB.holdMs = timings.holdMs;
  }
  assert.strictEqual(r.status, 409);
  const row = await rosterRow(pat);
  assert.strictEqual(String(row.coordinatorId), String(ctx.yan._id), 'the claim landed');
  assert.ok(row.crewJob?.token, 'the job stays on the row');
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 7 }, 'no row moved after the hold was lost');
  const [rec] = await records(pat);
  assert.strictEqual(rec.restampError, 'lost-hold');
  assert.ok(rec.createdAt, 'insert-only, with its times');

  const fin = await setCrew(pat, ctx.yan._id);
  assert.strictEqual(fin.status, 200, JSON.stringify(fin.json));
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 7 });
  const recs = await records(pat);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].restampError, null);
});

test('a bare No-crew repeat never moves doors: it is what every departure leaves', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, null);
  await rows(pat, ctx.dana, { knocks: 9 });
  const p = await preview(pat, null);
  assert.strictEqual(p.json.finishIt, false);
  const r = await setCrew(pat, null);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 9 });
  assert.strictEqual((await records(pat)).length, 0);
});

test('rows off a real crew are offered Finish it, and the fix records the team they came from', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 5 });
  await rows(pat, ctx.yan, { surveys: 1 });
  const p = await preview(pat, ctx.dana._id);
  assert.strictEqual(p.json.finishIt, true);
  const r = await setCrew(pat, ctx.dana._id, { fromCoordinatorId: String(ctx.dana._id) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 6 });
  const [rec] = await records(pat);
  assert.strictEqual(String(rec.fromCoordinatorId), String(ctx.yan._id), 'not "Dana → Dana"');
});

test('a departure clears the job with the crew, and nothing is offered afterwards', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const coord = await mkPerson('Cora', 'lead');
  await onRoster(pat, coord._id);
  await rows(pat, coord, { knocks: 3 });
  await CampaignAssignment.updateOne(
    { campaignId: ctx.camp._id, userId: pat._id },
    { $set: { crewJob: { token: new ObjectId(), run: 'r', until: new Date(Date.now() - 1000), from: null, to: coord._id, activities: 3, surveys: 0, doors: 3, source: 'lead_crew' } } }
  );
  await releaseAssignedWork(coord._id, { organizationId: ctx.org._id, campaignId: ctx.camp._id });
  const row = await rosterRow(pat);
  assert.strictEqual(row.coordinatorId, null);
  assert.strictEqual(row.crewJob, undefined);
  const p = await preview(pat, null);
  assert.strictEqual(p.json.finishIt, false);
  assert.deepStrictEqual(await stamps(pat), { [String(coord._id)]: 3 }, 'departure never re-stamps');
});

test('a switched-off coordinator: their crew still opens and finishes, but they can no longer be picked', { skip }, async () => {
  const coord = await mkPerson('Cy', 'lead');
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  await onRoster(pat, coord._id);
  await onRoster(sam, null);
  await rows(pat, ctx.dana, { knocks: 2 });
  await Membership.updateOne({ userId: coord._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const p = await preview(pat, coord._id);
  assert.strictEqual(p.status, 200, 'the open-time preview of the current crew is not validated');
  assert.strictEqual(p.json.finishIt, true);
  const fin = await setCrew(pat, coord._id);
  assert.strictEqual(fin.status, 200);
  assert.deepStrictEqual(await stamps(pat), { [String(coord._id)]: 2 });
  const fresh = await setCrew(sam, coord._id);
  assert.strictEqual(fresh.status, 400, 'a NEW pick is still validated');
});

test('two moves a few milliseconds apart: one wins, the other is told, and the ledger agrees with the roster', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 5000 });
  const [a, b] = await Promise.all([
    setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) }),
    new Promise((r) => setTimeout(r, 5)).then(() => setCrew(pat, ctx.zoe._id, { fromCoordinatorId: String(ctx.dana._id) })),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [200, 409], JSON.stringify([a.json, b.json]));
  const winner = a.status === 200 ? ctx.yan : ctx.zoe;
  assert.strictEqual(String((await rosterRow(pat)).coordinatorId), String(winner._id));
  assert.deepStrictEqual(await stamps(pat), { [String(winner._id)]: 5000 });
  assert.strictEqual((await records(pat)).length, 1);
});

// ── Coming back to a campaign ────────────────────────────────────────────────────────────────────

test('by email: a returning colleague joins with the crew picked, or No team, and the answer names where doors came from', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await rows(pat, ctx.dana, { knocks: 4 });
  const add = (email, coordinatorId) => api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email, ...(coordinatorId !== undefined ? { coordinatorId } : {}) });
  const r = await add(pat.email, String(ctx.yan._id));
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.outcome, 'in-org');
  assert.deepStrictEqual(r.json.restamp.sources.map((s) => [s.name.startsWith('Dana'), s.doors]), [[true, 4]]);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 4 });

  const sam = await mkPerson('Sam');
  await rows(sam, ctx.dana, { knocks: 2 });
  const s = await add(sam.email);
  assert.strictEqual(s.status, 201);
  assert.deepStrictEqual(await stamps(sam), { none: 2 }, 'no crew picked: their earlier doors go to No team');
});

test('by email: someone already on the campaign changes nothing — crew included — and the answer is today\'s on-campaign', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 3 });
  const r = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: pat.email });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.outcome, 'on-campaign');
  assert.strictEqual(String((await rosterRow(pat)).coordinatorId), String(ctx.dana._id), 'crew not cleared');
  assert.strictEqual((await records(pat)).length, 0);
});

test('by email: a switched-off person already on the campaign is switched back on, crew untouched; a lead is told to ask', { skip }, async () => {
  const pat = await mkPerson('Pat', 'canvasser', { isActive: false });
  await onRoster(pat, ctx.dana._id);
  const asLead = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.leeToken, { email: pat.email });
  assert.strictEqual(asLead.status, 409);
  assert.strictEqual(asLead.json.code, 'MEMBER_DEACTIVATED');
  const look = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/resolve`, ctx.adaToken, { email: pat.email });
  assert.strictEqual(look.json.outcome, 'in-org-inactive');
  assert.strictEqual(look.json.onCampaign, true);
  const r = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: pat.email });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await Membership.findOne({ userId: pat._id, organizationId: ctx.org._id })).isActive, true);
  assert.strictEqual(String((await rosterRow(pat)).coordinatorId), String(ctx.dana._id));
});

test('the self-coordinator check runs for named answers only: an outside address gets the same 400 whatever id is sent', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const self = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: pat.email, coordinatorId: String(pat._id) });
  assert.strictEqual(self.status, 400);
  assert.match(self.json.error, /own coordinator/);
  const otherOrg = await Organization.create({ name: 'Elsewhere', slug: `elsewhere-${seq}`, isActive: true });
  const stranger = await mkPerson('Stranger', 'canvasser', { orgId: otherOrg._id });
  const own = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: stranger.email, coordinatorId: String(stranger._id) });
  const random = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: stranger.email, coordinatorId: String(new ObjectId()) });
  assert.strictEqual(own.status, 400);
  assert.deepStrictEqual(own.json, random.json, 'no wording that says whose account the address is');
});

test('two admins adding the same person at once: one adds them, the other moves nothing', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await rows(pat, ctx.dana, { knocks: 6 });
  const bo = await mkPerson('Bo', 'admin');
  const [a, b] = await Promise.all([
    api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: pat.email, coordinatorId: String(ctx.yan._id) }),
    api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, tokenOf(bo), { email: pat.email, coordinatorId: String(ctx.zoe._id) }),
  ]);
  assert.deepStrictEqual([a.status, b.status], [201, 201]);
  assert.deepStrictEqual([a.json.outcome, b.json.outcome].sort(), ['in-org', 'on-campaign']);
  const crew = String((await rosterRow(pat)).coordinatorId);
  assert.deepStrictEqual(await stamps(pat), { [crew]: 6 });
  assert.strictEqual((await records(pat)).length, 1);
});

test('from the organization: the crew sent, null or no key; someone already here is skipped; a hire with no history writes no record', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  const ann = await mkPerson('Ann');
  const newbie = await mkPerson('Newbie');
  const here = await mkPerson('Here');
  await rows(pat, ctx.dana, { knocks: 3 });
  await rows(sam, ctx.dana, { knocks: 2 });
  await rows(ann, ctx.dana, { knocks: 1 });
  await onRoster(here, ctx.dana._id);
  const add = (body) => api('POST', `/admin/campaigns/${ctx.camp._id}/assignments`, ctx.adaToken, body);

  const r1 = await add({ userIds: [String(pat._id), String(here._id), String(newbie._id)], coordinatorId: String(ctx.yan._id) });
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.json));
  assert.strictEqual(r1.json.created, 2);
  assert.deepStrictEqual(r1.json.crew.skipped.map((x) => [String(x.userId), x.reason]), [[String(here._id), 'already-on-campaign']]);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 3 });
  assert.strictEqual(String((await rosterRow(here)).coordinatorId), String(ctx.dana._id), 'an add never re-crews');
  assert.strictEqual((await records(newbie)).length, 0, 'a hire with no history writes nothing to History');

  await add({ userIds: [String(sam._id)], coordinatorId: null });
  assert.deepStrictEqual(await stamps(sam), { none: 2 });
  await add({ userIds: [String(ann._id)] }); // a released phone's Assign all shown: no crew key
  assert.deepStrictEqual(await stamps(ann), { none: 1 });
});

test('a book that puts an admin back on the team moves their earlier doors to No team; a book for someone already here moves nothing', { skip }, async () => {
  const bo = await mkPerson('Bo', 'admin');
  const pat = await mkPerson('Pat');
  await rows(bo, ctx.dana, { knocks: 5 });
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.yan, { knocks: 2 });
  const turf = await Turf.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.pass._id, name: 'Book 1', mode: 'manual', status: 'published' });
  const r = await api('POST', `/admin/campaigns/${ctx.camp._id}/turfs/${turf._id}/assignments`, ctx.adaToken, { userIds: [String(bo._id), String(pat._id)] });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.ok(await rosterRow(bo), 'on the roster');
  assert.deepStrictEqual(await stamps(bo), { none: 5 });
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 2 }, 'already on the roster: untouched');
});

// ── Several people ──────────────────────────────────────────────────────────────────────────────

test('bulk preview: an exact deduplicated door total, and skips in the order a lead sees them', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  const offTeam = await mkPerson('Off');
  const outsider = new ObjectId();
  await onRoster(pat, ctx.dana._id);
  await onRoster(sam, ctx.dana._id);
  const shared = new ObjectId();
  await rows(pat, ctx.dana, { knocks: 1, house: shared });
  await rows(sam, ctx.dana, { knocks: 1, house: shared });
  await rows(pat, ctx.dana, { knocks: 3 });
  const ids = [pat, sam, offTeam].map((u) => String(u._id)).concat(String(outsider));

  const asAdmin = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk/preview`, ctx.adaToken, { userIds: ids, coordinatorId: String(ctx.yan._id) });
  assert.strictEqual(asAdmin.status, 200, JSON.stringify(asAdmin.json));
  assert.strictEqual(asAdmin.json.totals.doors, 4, 'the shared house counts once');
  const byId = new Map(asAdmin.json.people.map((p) => [p.userId, p]));
  assert.strictEqual(byId.get(String(offTeam._id)).onCampaign, false, 'an admin previews joining');
  assert.deepStrictEqual(byId.get(String(outsider)), { userId: String(outsider), skip: 'not-in-org' }, 'no name, no counts');

  const asLead = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk/preview`, ctx.leeToken, { userIds: ids, coordinatorId: String(ctx.yan._id) });
  const leadById = new Map(asLead.json.people.map((p) => [p.userId, p]));
  assert.deepStrictEqual(leadById.get(String(offTeam._id)), { userId: String(offTeam._id), skip: 'not-on-campaign' });
  assert.deepStrictEqual(leadById.get(String(outsider)), { userId: String(outsider), skip: 'not-on-campaign' }, 'a lead can\'t tell a member from a made-up id');

  const tooMany = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk/preview`, ctx.adaToken, { userIds: Array.from({ length: 501 }, () => String(new ObjectId())), coordinatorId: null });
  assert.strictEqual(tooMany.status, 400);
});

test('bulk write: each person through the job with their previewed `from`; a stale one is told', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  await onRoster(pat, ctx.dana._id);
  await onRoster(sam, ctx.zoe._id);
  await rows(pat, ctx.dana, { knocks: 4 });
  await rows(sam, ctx.zoe, { knocks: 2 });
  const r = await api('PATCH', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk`, ctx.adaToken, {
    people: [{ userId: String(pat._id), from: String(ctx.dana._id) }, { userId: String(sam._id), from: String(ctx.dana._id) }],
    coordinatorId: String(ctx.yan._id),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const byId = new Map(r.json.results.map((x) => [x.userId, x]));
  assert.strictEqual(byId.get(String(pat._id)).finished, true);
  assert.strictEqual(byId.get(String(sam._id)).skip, 'changed-meanwhile');
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 4 });
  assert.deepStrictEqual(await stamps(sam), { [String(ctx.zoe._id)]: 2 });

  const eleven = await api('PATCH', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk`, ctx.adaToken, {
    people: Array.from({ length: 11 }, () => ({ userId: String(new ObjectId()) })),
    coordinatorId: null,
  });
  assert.strictEqual(eleven.status, 400);
});

// ── History ─────────────────────────────────────────────────────────────────────────────────────

test('History: several teams, doors not rows, an error a later change finished stops reading as incomplete', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 2, notes: 3 });
  await rows(pat, ctx.yan, { knocks: 1 });
  const errId = new ObjectId();
  const earlier = new Date(Date.now() - 60_000);
  await CoordinatorChange.collection.insertOne({ _id: errId, organizationId: ctx.org._id, campaignId: ctx.camp._id, userId: pat._id, fromCoordinatorId: ctx.yan._id, toCoordinatorId: ctx.dana._id, source: 'lead_crew', restampError: 'boom', activitiesMoved: 0, surveysMoved: 0, finishedBy: null, createdAt: earlier, updatedAt: earlier });
  const r = await setCrew(pat, ctx.zoe._id, { fromCoordinatorId: String(ctx.dana._id) });
  assert.strictEqual(r.status, 200);
  const h = await api('GET', `/admin/campaigns/${ctx.camp._id}/history`, ctx.adaToken);
  assert.strictEqual(h.status, 200);
  const team = h.json.items.filter((i) => i.kind === 'team' && i.user?.id === String(pat._id));
  const move = team.find((i) => i.id !== String(errId));
  assert.strictEqual(move.fromCoordinator.name, 'Several teams');
  assert.strictEqual(move.activitiesMoved, 3, 'doors (knocks), not the 6 rows');
  assert.strictEqual(move.rowsMoved, 6);
  const closed = team.find((i) => i.id === String(errId));
  assert.strictEqual(closed.restampError, null, 'finished by the later change');
  assert.ok(closed.finishedBy);
});
