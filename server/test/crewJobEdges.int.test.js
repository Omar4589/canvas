import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Crew jobs at their edges (docs/PROPOSAL_PEOPLE_PAGES.md §B.3-§B.7, §L) — what the build's code review
// found, and the cases §L lists that crewJob.int.test.js doesn't reach:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crewedges node --import ./scripts/testIndexPreload.mjs --test test/crewJobEdges.int.test.js
//
// Several tests wrap a model's own static method for one call (a stall, a failure, another admin's
// write landing in between) and always put it back. Every test builds its own people.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-crew-edges';

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
const { CREW_JOB, setMemberCoordinator } = await import('../src/services/memberships/setCoordinator.js');
const { LATE_WRITE_MODELS } = await import('../src/services/platform/lateWriteSweep.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
let seq = 0;
const timings = { ...CREW_JOB };

const mkPerson = async (first, role = 'canvasser', { orgId = ctx.org._id, isActive = true, isSuperAdmin = false } = {}) => {
  const u = await User.create({
    firstName: first, lastName: `E${++seq}`, email: `${first.toLowerCase()}${seq}@crewedges.t.co`,
    passwordHash: 'x', isActive: true, isSuperAdmin,
  });
  await Membership.create({ userId: u._id, organizationId: orgId, role, isActive, billingAccess: role === 'admin' });
  return u;
};
const onRoster = (u, coordinatorId = null, campaign = ctx.camp, orgId = ctx.org._id) =>
  CampaignAssignment.create({ campaignId: campaign._id, userId: u._id, organizationId: orgId, coordinatorId });

// Ledger rows for one person, stamped with a team, inserted raw.
const rows = async (u, coord, { knocks = 0, surveys = 0, house = null, campaign = ctx.camp, orgId = ctx.org._id } = {}) => {
  const at = new Date('2026-10-01T15:00:00Z');
  const common = { organizationId: orgId, campaignId: campaign._id, userId: u._id, coordinatorId: coord ? coord._id || coord : null, location: { lat: 28.3, lng: -81.4 }, createdAt: at, updatedAt: at };
  if (knocks) {
    await CanvassActivity.collection.insertMany(
      Array.from({ length: knocks }, () => ({ ...common, _id: new ObjectId(), effortId: ctx.effort._id, passId: ctx.pass._id, householdId: house || new ObjectId(), actionType: 'not_home', timestamp: at }))
    );
  }
  if (surveys) {
    await SurveyResponse.collection.insertMany(
      Array.from({ length: surveys }, () => ({ ...common, _id: new ObjectId(), passId: ctx.pass._id, voterId: new ObjectId(), householdId: new ObjectId(), surveyTemplateId: new ObjectId(), surveyTemplateVersion: 1, answers: [], submittedAt: at }))
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
const ageHold = (u) => CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: u._id }, { $set: { 'crewJob.until': new Date(Date.now() - 1000) } });

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
const bulkPreview = (ids, coordinatorId, token = ctx.adaToken, campaign = ctx.camp) =>
  api('POST', `/admin/campaigns/${campaign._id}/crew/coordinator-bulk/preview`, token, { userIds: ids.map(String), coordinatorId: coordinatorId ? String(coordinatorId) : null });
const bulkWrite = (people, coordinatorId, token = ctx.adaToken, campaign = ctx.camp) =>
  api('PATCH', `/admin/campaigns/${campaign._id}/crew/coordinator-bulk`, token, { people, coordinatorId: coordinatorId ? String(coordinatorId) : null });

// Wrap a model's static method for the length of `fn`, then put it back.
const wrapped = async (Model, method, wrap, fn) => {
  const original = Model[method];
  Model[method] = wrap(original.bind(Model));
  try {
    return await fn();
  } finally {
    Model[method] = original;
  }
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([CampaignAssignment.init(), CoordinatorChange.init(), CanvassActivity.init(), SurveyResponse.init()]);
  // init() is memoized: when the model's background build finished before the drop above, it resolves at
  // once and nothing rebuilds what the drop took, so the roster test below planned with no index at all
  // (COLLSCAN, 0 keys) — a flake whose odds moved with the preload's timing (scripts/testIndexPreload.mjs).
  // createIndexes() always builds them.
  await CampaignAssignment.createIndexes();
  Object.assign(CREW_JOB, { secondPassMs: 20 });

  ctx.org = await Organization.create({ name: 'Crew Edges Org', slug: 'crew-edges-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  ctx.ada = await mkPerson('Ada', 'admin');
  ctx.adaToken = signUserToken(ctx.ada);
  ctx.dana = await mkPerson('Dana', 'lead');
  ctx.yan = await mkPerson('Yan', 'lead');
  ctx.zoe = await mkPerson('Zoe', 'lead');
  ctx.lee = await mkPerson('Lee', 'lead');
  ctx.leeToken = signUserToken(ctx.lee);
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Edge Canvass', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
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

// ── Several people: Move to crew… ──────────────────────────────────────────────────────────────────

test('the bulk write never puts anyone on the campaign: someone removed since the preview is skipped, not re-added', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const never = await mkPerson('Nev'); // in the organization, never on this campaign
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 3 });
  await rows(never, ctx.dana, { knocks: 2 });
  const p = await bulkPreview([pat._id], ctx.yan._id);
  const [row] = p.json.people;
  assert.strictEqual(row.onCampaign, true);

  // Another admin takes Pat off the campaign while the move is on screen.
  const off = await api('DELETE', `/admin/campaigns/${ctx.camp._id}/assignments/${pat._id}`, ctx.adaToken);
  assert.ok(off.status < 300, JSON.stringify(off.json));
  const w = await bulkWrite([{ userId: String(pat._id), from: row.from }, { userId: String(never._id), from: null }], ctx.yan._id);
  assert.strictEqual(w.status, 200, JSON.stringify(w.json));
  for (const r of w.json.results) {
    assert.strictEqual(r.skip, 'not-on-campaign');
    assert.strictEqual(r.changed, false);
  }
  assert.strictEqual(await rosterRow(pat), null, 'the removal stands');
  assert.strictEqual(await rosterRow(never), null);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 3 }, 'their doors stay where the departure left them');
  assert.deepStrictEqual(await stamps(never), { [String(ctx.dana._id)]: 2 });
  assert.strictEqual((await records(pat)).length + (await records(never)).length, 0);
});

test('the bulk preview says who can\'t be added: a switched-off member and a deleted account', { skip }, async () => {
  const off = await mkPerson('Off', 'canvasser', { isActive: false });
  const gone = await mkPerson('Gone');
  await Membership.updateOne({ userId: gone._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  await User.updateOne({ _id: gone._id }, { $set: { deletedAt: new Date(), isActive: false } });
  const fine = await mkPerson('Fine');
  await rows(off, ctx.dana, { knocks: 2 });
  await rows(gone, ctx.dana, { knocks: 4 });
  await rows(fine, ctx.dana, { knocks: 1 });
  const p = await bulkPreview([off._id, gone._id, fine._id], ctx.yan._id);
  assert.strictEqual(p.status, 200, JSON.stringify(p.json));
  const byId = new Map(p.json.people.map((x) => [x.userId, x]));
  assert.strictEqual(byId.get(String(off._id)).skip, 'switched-off');
  assert.strictEqual(byId.get(String(gone._id)).skip, 'deleted');
  assert.strictEqual(byId.get(String(fine._id)).skip, undefined, 'an active member previews as joining');
  assert.strictEqual(byId.get(String(fine._id)).onCampaign, false);
  assert.strictEqual(p.json.totals.doors, 1, 'only the person who can be added counts');
});

test('the preview\'s intent makes its totals what the write does: a move leaves out who is off the roster, an add who is on it', { skip }, async () => {
  const on = await mkPerson('Ona');
  const off = await mkPerson('Ofa');
  await onRoster(on, ctx.dana._id);
  await rows(on, ctx.dana, { knocks: 3 });
  await rows(off, ctx.dana, { knocks: 2 }); // in the organization, off the campaign (removed earlier)
  const ids = [on._id, off._id];
  const body = (intent) => ({ userIds: ids.map(String), coordinatorId: String(ctx.yan._id), ...(intent ? { intent } : {}) });
  const ask = (intent) => api('POST', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk/preview`, ctx.adaToken, body(intent));

  const both = await ask(null);
  assert.strictEqual(both.json.totals.doors, 5, 'without an intent both are modelled');

  const move = await ask('move');
  const moveBy = new Map(move.json.people.map((p) => [p.userId, p]));
  assert.strictEqual(moveBy.get(String(off._id)).skip, 'not-on-campaign');
  assert.strictEqual(moveBy.get(String(on._id)).skip, undefined);
  assert.strictEqual(move.json.totals.doors, 3, 'the move counts only who it will move');

  const join = await ask('join');
  const joinBy = new Map(join.json.people.map((p) => [p.userId, p]));
  assert.strictEqual(joinBy.get(String(on._id)).skip, 'already-on-campaign');
  assert.strictEqual(joinBy.get(String(on._id)).doors, undefined, 'a skipped row counts nothing');
  assert.strictEqual(joinBy.get(String(off._id)).onCampaign, false);
  assert.strictEqual(join.json.totals.doors, 2, 'the add counts only who it will add');

  const bad = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/coordinator-bulk/preview`, ctx.adaToken, { ...body(null), intent: 'other' });
  assert.strictEqual(bad.status, 400);
});

test('a bare No-crew repeat stays out of the door total, so the total is what the write moves', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 2 });
  await onRoster(sam, null); // No crew, with 5 doors left on Yan's team — what a departure leaves
  await rows(sam, ctx.yan, { knocks: 5 });
  const p = await bulkPreview([pat._id, sam._id], null);
  const byId = new Map(p.json.people.map((x) => [x.userId, x]));
  assert.strictEqual(byId.get(String(sam._id)).skip, 'same-crew');
  assert.strictEqual(byId.get(String(sam._id)).doors, undefined, 'a skipped row counts nothing');
  assert.strictEqual(p.json.totals.doors, 2);
  const w = await bulkWrite(p.json.people.filter((x) => !x.skip).map((x) => ({ userId: x.userId, from: x.from })), null);
  assert.strictEqual(w.json.results.reduce((n, r) => n + r.doors, 0), p.json.totals.doors);
  assert.deepStrictEqual(await stamps(sam), { [String(ctx.yan._id)]: 5 });
});

test('a person\'s doors count once across teams: the one-person check, the bulk row and the email lookup agree', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, null);
  const house = new ObjectId();
  await rows(pat, ctx.dana, { knocks: 1, house });
  await rows(pat, null, { knocks: 1, house }); // the same door, same round, knocked again with no crew
  const single = await preview(pat, ctx.yan._id);
  const bulk = await bulkPreview([pat._id], ctx.yan._id);
  const look = await api('POST', `/admin/campaigns/${ctx.camp._id}/crew/resolve`, ctx.adaToken, { email: pat.email });
  assert.strictEqual(single.json.doors, 1);
  assert.strictEqual(bulk.json.people[0].doors, 1);
  assert.strictEqual(bulk.json.totals.doors, 1);
  assert.strictEqual(look.json.history.doors, 1);
  assert.deepStrictEqual(look.json.history.sources.map((s) => s.doors), [1, 1], 'each team still counts it in its own line');
});

test('skips a person can meet: staff and the picked coordinator, a change still running, a crew that already matches; an archived campaign refuses the write', { skip }, async () => {
  const staff = await mkPerson('Stu', 'canvasser', { isSuperAdmin: true });
  const busy = await mkPerson('Bea');
  const done = await mkPerson('Don');
  const left = await mkPerson('Lef');
  await onRoster(staff, null);
  await onRoster(ctx.yan, null);
  await onRoster(busy, ctx.dana._id);
  await onRoster(done, ctx.yan._id);
  await onRoster(left, ctx.dana._id);
  await rows(done, ctx.yan, { knocks: 3 });
  const job = (until) => ({ token: new ObjectId(), run: 'r1', until, from: ctx.dana._id, to: ctx.dana._id, activities: 0, surveys: 0, doors: 0, source: 'lead_crew' });
  await CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: busy._id }, { $set: { crewJob: job(new Date(Date.now() + 60_000)) } });
  await CampaignAssignment.updateOne({ campaignId: ctx.camp._id, userId: left._id }, { $set: { crewJob: job(new Date(Date.now() - 1000)) } });

  const asLead = await bulkPreview([staff._id, ctx.yan._id, busy._id, done._id, left._id], ctx.yan._id, ctx.leeToken);
  assert.strictEqual(asLead.status, 200, JSON.stringify(asLead.json));
  const byId = new Map(asLead.json.people.map((x) => [x.userId, x]));
  assert.strictEqual(byId.get(String(staff._id)).skip, 'staff');
  assert.strictEqual(byId.get(String(ctx.yan._id)).skip, 'is-coordinator');
  assert.strictEqual(byId.get(String(busy._id)).skip, 'busy');
  assert.ok(byId.get(String(busy._id)).retryAfterSeconds > 0);
  assert.strictEqual(byId.get(String(done._id)).skip, 'same-crew', 'on the crew already, nothing to move');
  assert.strictEqual(byId.get(String(left._id)).unfinished, true, 'a change left unfinished: the move finishes it');
  assert.strictEqual(byId.get(String(left._id)).skip, undefined);
  const asAdmin = await bulkPreview([staff._id], ctx.yan._id);
  assert.strictEqual(asAdmin.json.people[0].skip, undefined, 'an org admin may move a staff member who holds a membership here');

  const archived = await Campaign.create({ organizationId: ctx.org._id, name: 'Done Canvass', type: 'survey', state: 'FL', isActive: false, timeZone: 'America/New_York' });
  const w = await bulkWrite([{ userId: String(done._id), from: String(ctx.yan._id) }], ctx.dana._id, ctx.adaToken, archived);
  assert.strictEqual(w.status, 409);
});

// ── One person ────────────────────────────────────────────────────────────────────────────────────

test('fromCoordinatorId: absent means a released client (the server uses the crew it read); null means No crew and must match', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  await onRoster(pat, ctx.dana._id);
  await onRoster(sam, null);
  await rows(pat, ctx.dana, { knocks: 2 });
  const absent = await setCrew(pat, ctx.yan._id);
  assert.strictEqual(absent.status, 200, JSON.stringify(absent.json));
  const stale = await setCrew(pat, ctx.zoe._id, { fromCoordinatorId: null });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.json.code, 'changed-meanwhile');
  assert.strictEqual(stale.json.now, String(ctx.yan._id));
  const fromNone = await setCrew(sam, ctx.yan._id, { fromCoordinatorId: null });
  assert.strictEqual(fromNone.status, 200, 'a No-crew preview sends null');
});

test('a released phone re-sending a switched-off coordinator while another admin moves the person is told the crew changed', { skip }, async () => {
  const dee = await mkPerson('Dee', 'lead');
  const pat = await mkPerson('Pat');
  await onRoster(pat, dee._id);
  await rows(pat, dee, { knocks: 2 });
  await Membership.updateOne({ userId: dee._id, organizationId: ctx.org._id }, { $set: { isActive: false } });

  // Another admin's move lands just after the route reads Pat's crew (Dee), before the job's own read.
  let moved = false;
  const r = await wrapped(
    CampaignAssignment,
    'findOne',
    (findOne) => (...args) => {
      const q = findOne(...args);
      if (!moved && args[1] === 'coordinatorId' && String(args[0]?.userId) === String(pat._id)) {
        const exec = q.exec.bind(q);
        q.exec = async (...e) => {
          const out = await exec(...e);
          moved = true;
          await CampaignAssignment.collection.updateOne({ campaignId: ctx.camp._id, userId: pat._id }, { $set: { coordinatorId: ctx.yan._id } });
          return out;
        };
      }
      return q;
    },
    () => setCrew(pat, dee._id) // what a released phone sends: the crew it shows, and no `from`
  );
  assert.ok(moved, 'the race was staged');
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'changed-meanwhile', 'not an unvalidated pick of a switched-off coordinator');
  assert.strictEqual(String((await rosterRow(pat)).coordinatorId), String(ctx.yan._id));
  const fresh = await setCrew(pat, dee._id, { fromCoordinatorId: String(ctx.yan._id) });
  assert.strictEqual(fresh.status, 400, 'a NEW pick of a switched-off coordinator is refused');
});

test('the second pass reaches a first door saved while the crew changed', { skip }, async () => {
  const fresh = await mkPerson('Fre'); // on the roster with No crew and no doors yet, knocking their first
  await onRoster(fresh, null);
  let landed = false;
  const r = await wrapped(
    CanvassActivity,
    'updateMany',
    (updateMany) => async (...args) => {
      const out = await updateMany(...args);
      if (!landed) {
        landed = true; // the knock that read No crew writes its row just after the first pass
        await rows(fresh, null, { knocks: 1 });
      }
      return out;
    },
    () => setCrew(fresh, ctx.yan._id, { fromCoordinatorId: null })
  );
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(await stamps(fresh), { [String(ctx.yan._id)]: 1 });
});

test('a lost hold answers with the crew the row holds now', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 2 });
  CREW_JOB.holdMs = -1000; // the claim's hold has already passed when the first renewal runs
  let r;
  try {
    r = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
  } finally {
    CREW_JOB.holdMs = timings.holdMs;
  }
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'changed-meanwhile');
  assert.strictEqual(r.json.now, String(ctx.yan._id), 'the claim landed: the crew is Yan now');
});

test('a ledger error keeps its own words when the hold is then lost', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 2, surveys: 1 });
  let failed = false;
  const r = await wrapped(
    SurveyResponse,
    'updateMany',
    () => async () => {
      failed = true;
      throw new Error('operation exceeded time limit');
    },
    () =>
      wrapped(
        CampaignAssignment,
        'updateOne',
        (updateOne) => (filter, update, ...rest) =>
          failed && update?.$set?.['crewJob.until'] ? Promise.resolve({ matchedCount: 0, modifiedCount: 0 }) : updateOne(filter, update, ...rest),
        () => setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) })
      )
  );
  assert.strictEqual(r.status, 409);
  const [rec] = await records(pat);
  assert.strictEqual(rec.restampError, 'operation exceeded time limit', 'the real error, not "lost-hold"');
});

test('a timed-out ledger write keeps the job until its hold passes, then Finish it completes it', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 3, surveys: 2 });
  const r = await wrapped(
    SurveyResponse,
    'updateMany',
    () => async () => {
      const err = new Error('operation exceeded time limit');
      err.code = 50; // MaxTimeMSExpired
      throw err;
    },
    () => setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) })
  );
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.finished, false);
  assert.match(r.json.restamp.error, /time limit/);
  const held = await preview(pat, ctx.yan._id);
  assert.strictEqual(held.json.busy, true, 'the job keeps its hold: a write may still be running on mongod');
  assert.strictEqual(held.json.finishIt, false);
  await ageHold(pat);
  const p = await preview(pat, ctx.yan._id);
  assert.strictEqual(p.json.finishIt, true);
  const fin = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.yan._id) });
  assert.strictEqual(fin.status, 200, JSON.stringify(fin.json));
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 5 });
  const recs = await records(pat);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].restampError, null, 'Finish it cleared its own job\'s error');
});

test('a renewal slower than 30 seconds stops the run before its next write', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 4 });
  CREW_JOB.slowRenewalMs = -1; // every renewal now "took too long"
  let r;
  try {
    r = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
  } finally {
    CREW_JOB.slowRenewalMs = timings.slowRenewalMs;
  }
  assert.strictEqual(r.status, 409);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.dana._id)]: 4 }, 'no write after a slow renewal');
  await ageHold(pat);
  assert.strictEqual((await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.yan._id) })).status, 200);
  assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 4 });
});

test('a stalled run that wakes during Finish it changes nothing and leaves Finish it\'s record alone', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await onRoster(pat, ctx.dana._id);
  await rows(pat, ctx.dana, { knocks: 4, surveys: 1 });
  let wake;
  const gate = new Promise((r) => { wake = r; });
  let stalled;
  const stalledAt = new Promise((r) => { stalled = r; });
  let first = true;
  const original = CanvassActivity.updateMany;
  CanvassActivity.updateMany = async (...args) => {
    if (first) {
      first = false;
      stalled();
      await gate; // a database pause longer than the hold, before this run's first write
    }
    return original.apply(CanvassActivity, args);
  };
  try {
    const a = setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) });
    await stalledAt;
    await ageHold(pat);
    const fin = await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.yan._id) });
    assert.strictEqual(fin.status, 200, JSON.stringify(fin.json));
    assert.strictEqual(fin.json.finished, true);
    const [rec] = await records(pat);
    assert.strictEqual((await rosterRow(pat)).crewJob, undefined, 'Finish it released the job');
    wake();
    const late = await a;
    assert.strictEqual(late.status, 409, 'the stalled run lost its hold');
    const recs = await records(pat);
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].restampError, null, 'never overwritten by the stalled run');
    assert.strictEqual(String(recs[0].updatedAt), String(rec.updatedAt));
    assert.deepStrictEqual(await stamps(pat), { [String(ctx.yan._id)]: 5 });
  } finally {
    CanvassActivity.updateMany = original;
    wake();
  }
});

test('renewals and the release never scan the roster: they read the person\'s row, not the roster\'s 300', { skip }, async () => {
  const filler = Array.from({ length: 300 }, () => ({ _id: new ObjectId(), campaignId: ctx.camp._id, userId: new ObjectId(), organizationId: ctx.org._id, coordinatorId: null }));
  await CampaignAssignment.collection.insertMany(filler);
  const db = mongoose.connection.db;
  try {
    const pat = await mkPerson('Pat');
    await onRoster(pat, ctx.dana._id);
    await rows(pat, ctx.dana, { knocks: 2 });
    // Earlier tests ran the same update shapes on a roster of a few rows, where the planner may have
    // cached a plan on { campaignId, coordinatorId } (a tie at that size). On 300 rows that plan reads a
    // few rows before mongod replans — bounded, but not what this checks. Plan from scratch.
    await db.command({ planCacheClear: 'campaignassignments' });
    await db.command({ profile: 2 });
    try {
      assert.strictEqual((await setCrew(pat, ctx.yan._id, { fromCoordinatorId: String(ctx.dana._id) })).status, 200);
    } finally {
      await db.command({ profile: 0 });
    }
    // The profiler's entries, once they're all in: four renewals, two more for the second pass, the release.
    let ops = [];
    for (let i = 0; i < 20 && ops.length < 3; i += 1) {
      if (i) await new Promise((r) => setTimeout(r, 50));
      ops = (await db.collection('system.profile').find({ op: 'update', ns: `${db.databaseName}.campaignassignments` }).toArray()).filter(
        (o) => o.command?.q && Object.keys(o.command.q).includes('crewJob.token')
      );
    }
    assert.ok(ops.length >= 3, `renewals and the release were seen (${ops.length})`);
    for (const o of ops) {
      // Either index that leads with the person will do ({ campaignId, userId } unique, or { userId,
      // organizationId }); the planner picks between them from run to run. A filter without the person
      // (round 6's bug) reads all 300.
      const seen = `${o.planSummary}, ${o.keysExamined} keys, ${o.docsExamined} rows`;
      assert.match(String(o.planSummary), /IXSCAN/, `an index scan, not ${seen}`);
      assert.ok(o.docsExamined <= 20, `the person's row, not the roster: ${seen}`);
    }
  } finally {
    await CampaignAssignment.deleteMany({ _id: { $in: filler.map((f) => f._id) } });
  }
});

// ── Joins ─────────────────────────────────────────────────────────────────────────────────────────

test('a join that fails after its insert still reports the person added, with Finish it to come', { skip }, async () => {
  const pat = await mkPerson('Pat');
  const sam = await mkPerson('Sam');
  await rows(pat, ctx.dana, { knocks: 2 });
  await rows(sam, ctx.dana, { knocks: 3 });
  const failClose = (updateMany) => (filter, ...rest) =>
    filter && 'finishedBy' in filter ? Promise.reject(new Error('connection pool wait timed out')) : updateMany(filter, ...rest);

  const fromOrg = await wrapped(CoordinatorChange, 'updateMany', failClose, () =>
    api('POST', `/admin/campaigns/${ctx.camp._id}/assignments`, ctx.adaToken, { userIds: [String(pat._id)], coordinatorId: String(ctx.yan._id) })
  );
  assert.strictEqual(fromOrg.status, 201, JSON.stringify(fromOrg.json));
  assert.strictEqual(fromOrg.json.created, 1, 'added');
  assert.deepStrictEqual(fromOrg.json.crew.skipped.map((s) => s.reason), ['unfinished']);
  assert.ok(await rosterRow(pat));

  const byEmail = await wrapped(CoordinatorChange, 'updateMany', failClose, () =>
    api('POST', `/admin/campaigns/${ctx.camp._id}/crew`, ctx.adaToken, { email: sam.email, coordinatorId: String(ctx.yan._id) })
  );
  assert.strictEqual(byEmail.status, 201, JSON.stringify(byEmail.json));
  assert.match(byEmail.json.restamp.error, /release/);
  assert.ok(await rosterRow(sam));
  await ageHold(sam);
  assert.strictEqual((await preview(sam, ctx.yan._id)).json.finishIt, true);
  assert.strictEqual((await setCrew(sam, ctx.yan._id, { fromCoordinatorId: String(ctx.yan._id) })).status, 200);
  assert.strictEqual((await rosterRow(sam)).crewJob, undefined);
});

test('a book join whose plan fails still puts the holder on the roster', { skip }, async () => {
  const bo = await mkPerson('Bo', 'admin');
  await rows(bo, ctx.dana, { knocks: 2 });
  const turf = await Turf.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.pass._id, name: 'Edge book', mode: 'manual', status: 'published' });
  const r = await wrapped(
    CanvassActivity,
    'countDocuments',
    (countDocuments) => (filter, ...rest) =>
      filter?.coordinatorId?.$ne !== undefined ? { hint: () => Promise.reject(new Error('planner died')) } : countDocuments(filter, ...rest),
    () => api('POST', `/admin/campaigns/${ctx.camp._id}/turfs/${turf._id}/assignments`, ctx.adaToken, { userIds: [String(bo._id)] })
  );
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.ok(await rosterRow(bo), 'on the roster, so the book shows on their phone');
  assert.deepStrictEqual(await stamps(bo), { [String(ctx.dana._id)]: 2 }, 'nothing moved: the plan never ran');
});

// ── Deletion ──────────────────────────────────────────────────────────────────────────────────────

test('a crew record written after the organization\'s delete cascade began goes with the organization', { skip }, async () => {
  assert.ok(LATE_WRITE_MODELS.includes(CoordinatorChange));
  const org = await Organization.create({ name: 'Going Org', slug: 'going-org', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Going', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  const dee = await mkPerson('Dee', 'lead', { orgId: org._id });
  const kay = await mkPerson('Kay', 'lead', { orgId: org._id });
  const pat = await mkPerson('Pat', 'canvasser', { orgId: org._id });
  await onRoster(pat, dee._id, camp, org._id);
  await rows(pat, dee, { knocks: 2, campaign: camp, orgId: org._id });
  // The cascade has begun (lateWriteSweep.js deletingTenant).
  await Organization.collection.updateOne({ _id: org._id }, { $set: { 'deletion.status': 'running', platformStatsCaptured: true } });
  CREW_JOB.holdMs = -1000; // the run loses its hold, as when the cascade deletes its roster row, and writes its record
  try {
    await setMemberCoordinator({ organizationId: org._id, campaignId: camp._id, userId: pat._id, coordinatorId: kay._id, actorUserId: dee._id, source: 'lead_crew', from: dee._id });
  } finally {
    CREW_JOB.holdMs = timings.holdMs;
  }
  assert.strictEqual(await CoordinatorChange.countDocuments({ organizationId: org._id }), 0, 'swept with the tenant');
});
