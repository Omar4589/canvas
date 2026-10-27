import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// A crew change cut off by a real crash (docs/PROPOSAL_PEOPLE_PAGES.md §L, "crash tests"):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crewcrash node --import ./scripts/testIndexPreload.mjs --test test/crewJobCrash.int.test.js
//
// Each test runs one change in a child process (test/support/crewJobCrashChild.js) that SIGKILLs
// itself at one step — before the claim, at either ledger, before the record, before the release —
// then checks what the crash left and drives Finish it through the real routes, the way the person's
// panel does. A hold can't be waited out in a test, so it is aged directly once the child is dead,
// which is all that 150 seconds of waiting would do.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-crew-crash';

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
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CREW_JOB } = await import('../src/services/memberships/setCoordinator.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'crewJobCrashChild.js');

let server;
let base;
const ctx = {};
let seq = 0;
const timings = { ...CREW_JOB };

const mkPerson = async (first, role = 'canvasser') => {
  const u = await User.create({
    firstName: first, lastName: `C${++seq}`, email: `${first.toLowerCase()}${seq}@crewcrash.t.co`,
    passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: u._id, organizationId: ctx.org._id, role, isActive: true, billingAccess: role === 'admin' });
  return u;
};
const onRoster = (u, coordinatorId) =>
  CampaignAssignment.create({ campaignId: ctx.camp._id, userId: u._id, organizationId: ctx.org._id, coordinatorId });

// Knocks and surveys for one person, stamped with a team, inserted raw.
const rows = async (u, coord, { knocks = 0, surveys = 0 } = {}) => {
  const at = new Date('2026-10-01T15:00:00Z');
  const common = { organizationId: ctx.org._id, campaignId: ctx.camp._id, userId: u._id, coordinatorId: coord._id, location: { lat: 28.3, lng: -81.4 }, createdAt: at, updatedAt: at };
  if (knocks) {
    await CanvassActivity.collection.insertMany(
      Array.from({ length: knocks }, () => ({ ...common, _id: new ObjectId(), effortId: ctx.effort._id, passId: ctx.pass._id, householdId: new ObjectId(), actionType: 'not_home', timestamp: at }))
    );
  }
  if (surveys) {
    await SurveyResponse.collection.insertMany(
      Array.from({ length: surveys }, () => ({ ...common, _id: new ObjectId(), passId: ctx.pass._id, voterId: new ObjectId(), householdId: new ObjectId(), surveyTemplateId: new ObjectId(), surveyTemplateVersion: 1, answers: [], submittedAt: at }))
    );
  }
};

// How many of a person's rows count for each team: { activities: {team: n}, surveys: {team: n} }.
const stamps = async (u) => {
  const out = {};
  for (const [key, M] of [['activities', CanvassActivity], ['surveys', SurveyResponse]]) {
    out[key] = {};
    for (const r of await M.collection.aggregate([{ $match: { campaignId: ctx.camp._id, userId: u._id } }, { $group: { _id: '$coordinatorId', n: { $sum: 1 } } }]).toArray()) {
      out[key][r._id ? String(r._id) : 'none'] = r.n;
    }
  }
  return out;
};
const rosterRow = (u) => CampaignAssignment.findOne({ campaignId: ctx.camp._id, userId: u._id }).lean();
const records = (u) => CoordinatorChange.find({ campaignId: ctx.camp._id, userId: u._id }).lean();
const ageHold = (u) => CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: u._id }, { $set: { 'crewJob.until': new Date(Date.now() - 1000) } });

const api = async (method, p, body) => {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.adaToken}`, 'X-Org-Id': String(ctx.org._id), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const crewPath = (u) => `/admin/campaigns/${ctx.camp._id}/crew/${u._id}`;
const preview = (u, coordinatorId) => api('GET', `${crewPath(u)}/coordinator-preview?coordinatorId=${coordinatorId ? String(coordinatorId) : 'none'}`);
// What the panel's Finish it sends: the current crew, as both the pick and the crew it previewed.
const finishIt = (u, crewId) => api('PATCH', `${crewPath(u)}/coordinator`, { coordinatorId: String(crewId), fromCoordinatorId: String(crewId) });
const teamHistory = async (u) => {
  const h = await api('GET', `/admin/campaigns/${ctx.camp._id}/history`);
  assert.strictEqual(h.status, 200);
  return h.json.items.filter((i) => i.kind === 'team' && i.user?.id === String(u._id));
};

// Run one change in a child and require that it died at `step`.
const crashAt = (step, { u, from, to, mode = 'change' }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD], {
      env: {
        ...process.env,
        CRASH_URI: URI, CRASH_ORG: String(ctx.org._id), CRASH_CAMPAIGN: String(ctx.camp._id), CRASH_USER: String(u._id),
        CRASH_TO: to ? String(to._id) : '', CRASH_FROM: from ? String(from._id) : '', CRASH_ACTOR: String(ctx.ada._id),
        CRASH_MODE: mode, CRASH_STEP: step,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal === 'SIGKILL') resolve();
      else reject(new Error(`the child was meant to die at ${step} but exited ${code}: ${stderr}`));
    });
  });

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([CampaignAssignment.init(), CoordinatorChange.init(), CanvassActivity.init(), SurveyResponse.init()]);
  Object.assign(CREW_JOB, { secondPassMs: 20 });

  ctx.org = await Organization.create({ name: 'Crew Crash Org', slug: 'crew-crash-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  ctx.ada = await mkPerson('Ada', 'admin');
  ctx.adaToken = signUserToken(ctx.ada);
  ctx.dana = await mkPerson('Dana', 'lead');
  ctx.yan = await mkPerson('Yan', 'lead');
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Crash Canvass', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  ctx.effort = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Main' });
  ctx.pass = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.effort._id, roundNumber: 1, name: 'Round 1' });

  server = (await import('node:http')).createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(CREW_JOB, timings);
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// A person on Dana's crew with 4 knocks and 2 surveys on Dana's team, moving to Yan.
const onDana = async (name) => {
  const u = await mkPerson(name);
  await onRoster(u, ctx.dana._id);
  await rows(u, ctx.dana, { knocks: 4, surveys: 2 });
  return u;
};
const allOn = (coord) => ({ activities: { [String(coord._id)]: 4 }, surveys: { [String(coord._id)]: 2 } });

// After Finish it: every row on Yan's team, the job gone, exactly one record (the job's own) with the
// counts the check showed and no error, and one History row that doesn't read as unfinished.
const assertFinished = async (u, token) => {
  assert.deepStrictEqual(await stamps(u), allOn(ctx.yan));
  const row = await rosterRow(u);
  assert.strictEqual(String(row.coordinatorId), String(ctx.yan._id));
  assert.strictEqual(row.crewJob, undefined, 'the job is released');
  const recs = await records(u);
  assert.strictEqual(recs.length, 1, 'one record for one change');
  assert.strictEqual(String(recs[0]._id), String(token), 'the record is the job: its _id is the token');
  assert.strictEqual(recs[0].restampError ?? null, null);
  assert.strictEqual(recs[0].doorsMoved, 4);
  assert.strictEqual(recs[0].activitiesMoved, 4);
  assert.strictEqual(recs[0].surveysMoved, 2);
  const team = await teamHistory(u);
  assert.strictEqual(team.length, 1);
  assert.strictEqual(team[0].restampError, null);
  const after = await preview(u, ctx.yan._id);
  assert.strictEqual(after.json.finishIt, false, 'nothing left to finish');
};

test('a crash before the claim changes nothing and records nothing', { skip }, async () => {
  const u = await onDana('Abe');
  await crashAt('claim', { u, from: ctx.dana, to: ctx.yan });
  const row = await rosterRow(u);
  assert.strictEqual(String(row.coordinatorId), String(ctx.dana._id), 'still on Dana\'s crew');
  assert.strictEqual(row.crewJob, undefined);
  assert.deepStrictEqual(await stamps(u), allOn(ctx.dana));
  assert.strictEqual((await records(u)).length, 0);
  const p = await preview(u, ctx.dana._id);
  assert.strictEqual(p.json.finishIt, false, 'nothing to finish: the change never started');
});

test('a crash after the claim: busy while the hold lasts, then Finish it moves everything with one record', { skip }, async () => {
  const u = await onDana('Bea');
  await crashAt('first-ledger', { u, from: ctx.dana, to: ctx.yan });
  const row = await rosterRow(u);
  assert.strictEqual(String(row.coordinatorId), String(ctx.yan._id), 'the claim set the crew first');
  assert.ok(row.crewJob?.token, 'the job is still on the row');
  assert.deepStrictEqual(await stamps(u), allOn(ctx.dana), 'no row moved yet');
  assert.strictEqual((await records(u)).length, 0);

  const busy = await finishIt(u, ctx.yan._id);
  assert.strictEqual(busy.status, 409);
  assert.strictEqual(busy.json.code, 'busy');
  assert.ok(busy.json.retryAfterSeconds > 0);
  const other = await api('PATCH', `${crewPath(u)}/coordinator`, { coordinatorId: String(ctx.dana._id), fromCoordinatorId: String(ctx.yan._id) });
  assert.strictEqual(other.status, 409, 'no other change while the hold lasts');
  assert.strictEqual(other.json.code, 'busy');

  await ageHold(u);
  const p = await preview(u, ctx.yan._id);
  assert.strictEqual(p.json.unfinished, true);
  assert.strictEqual(p.json.finishIt, true);
  assert.strictEqual(p.json.doors, 4, 'the check shows what Finish it will move');
  const done = await finishIt(u, ctx.yan._id);
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  await assertFinished(u, row.crewJob.token);
});

test('a crash between the two ledgers: Finish it moves the surveys that were left, one record', { skip }, async () => {
  const u = await onDana('Cal');
  await crashAt('second-ledger', { u, from: ctx.dana, to: ctx.yan });
  const torn = await stamps(u);
  assert.deepStrictEqual(torn.activities, { [String(ctx.yan._id)]: 4 }, 'the knocks moved');
  assert.deepStrictEqual(torn.surveys, { [String(ctx.dana._id)]: 2 }, 'the surveys did not');
  const { crewJob } = await rosterRow(u);
  await ageHold(u);
  assert.strictEqual((await preview(u, ctx.yan._id)).json.finishIt, true);
  assert.strictEqual((await finishIt(u, ctx.yan._id)).status, 200);
  await assertFinished(u, crewJob.token);
});

test('a crash after both ledgers, before the record: Finish it moves nothing and writes the one record', { skip }, async () => {
  const u = await onDana('Dot');
  await crashAt('record', { u, from: ctx.dana, to: ctx.yan });
  assert.deepStrictEqual(await stamps(u), allOn(ctx.yan), 'every row had moved');
  assert.strictEqual((await records(u)).length, 0, 'but nothing was recorded');
  const { crewJob } = await rosterRow(u);
  await ageHold(u);
  assert.strictEqual((await preview(u, ctx.yan._id)).json.finishIt, true, 'the unfinished job is offered');
  assert.strictEqual((await finishIt(u, ctx.yan._id)).status, 200);
  await assertFinished(u, crewJob.token);
});

test('a crash after the record, before the release: Finish it writes no second record and clears the job', { skip }, async () => {
  const u = await onDana('Eve');
  await crashAt('release', { u, from: ctx.dana, to: ctx.yan });
  const recs = await records(u);
  assert.strictEqual(recs.length, 1, 'the record landed');
  const { crewJob } = await rosterRow(u);
  assert.ok(crewJob, 'the job was never released');
  await ageHold(u);
  assert.strictEqual((await finishIt(u, ctx.yan._id)).status, 200);
  await assertFinished(u, crewJob.token);
});

test('a join cut off at its first ledger write leaves the person on the roster, and Finish it moves their doors', { skip }, async () => {
  const u = await mkPerson('Flo');
  await rows(u, ctx.dana, { knocks: 4, surveys: 2 }); // worked here on Dana's team, then left
  await crashAt('first-ledger', { u, to: ctx.yan, mode: 'join' });
  const row = await rosterRow(u);
  assert.ok(row, 'the insert was the claim: they are on the roster');
  assert.strictEqual(String(row.coordinatorId), String(ctx.yan._id));
  assert.strictEqual(row.crewJob.source, 'campaign_join');
  assert.deepStrictEqual(await stamps(u), allOn(ctx.dana));
  await ageHold(u);
  assert.strictEqual((await finishIt(u, ctx.yan._id)).status, 200);
  await assertFinished(u, row.crewJob.token);
  assert.strictEqual((await records(u))[0].source, 'campaign_join');
});
