import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Late knocks count in the pass they were made in — docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.7, §C.6
// (services/canvass/attribution.js) — over the REAL Express app + a throwaway mongod:
//   npm run test:int -- test/lateKnocks.int.test.js
//
// An updated phone sends the door's `turfId` (the book it was tapped in) and the tap `timestamp`.
// The invariants this file exists to protect:
//   • the book the phone names wins when it still exists, still holds the door and belongs to the
//     door's walk list: a live pass's book as is; an ENDED pass's book when the tap came before the
//     end, or when no live book holds the door (ruling 9: after the next pass started, a door that
//     pass holds counts in it);
//   • anything else — no turfId, garbage, a book gone or moved on, another walk list's book, the
//     switch off — is exactly today's rule (the live book holding the door, else no pass), never a
//     4xx/5xx (the phone's queue drops a 4xx and stalls on a 5xx), and never touches an earlier
//     pass's rows;
//   • a late knock never drags the door's last visit backwards, yet still reaches teammates' phones.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-late-knocks';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const LOC = { lat: 30.26, lng: -97.74, accuracy: 5 };
let doorSeq = 0;
const makeHousehold = (campaign, effortId) => {
  doorSeq += 1;
  return {
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    effortId,
    addressLine1: `${doorSeq} Late St`,
    city: 'Austin',
    state: 'TX',
    zipCode: '78704',
    normalizedAddress: `${doorSeq} late st austin tx 78704`,
    location: { type: 'Point', coordinates: [-97.74 + (doorSeq % 9) * 0.0002, 30.26 + Math.floor(doorSeq / 9) * 0.0002] },
    status: 'unknocked',
    isActive: true,
  };
};

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
const iso = (d) => new Date(d).toISOString();
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const str = (v) => (v == null ? null : String(v));

// A walk list's doors; passes are added to it with addPass.
const seedWalkList = async (campaign, name, doors) => {
  const effort = await Effort.create({ organizationId: campaign.organizationId, campaignId: campaign._id, name, status: 'active' });
  const hh = await Household.insertMany(Array.from({ length: doors }, () => makeHousehold(campaign, effort._id)));
  return { campaign, effort, doors: hh, rounds: 0 };
};
// A draft pass with one published book over the doors at `idx`, assigned to `assign`.
const addPass = async (w, idx, assign = [ctx.cara]) => {
  w.rounds += 1;
  const c = w.campaign;
  const pass = await Pass.create({ organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, roundNumber: w.rounds, name: `Pass ${w.rounds}`, status: 'draft' });
  const book = await addBook(w, pass, idx);
  for (const u of assign) {
    await TurfAssignment.create({ turfId: book._id, userId: u._id, organizationId: c.organizationId, campaignId: c._id, passId: pass._id });
  }
  return { pass, book };
};
const addBook = (w, pass, idx, status = 'published') =>
  Turf.create({
    organizationId: w.campaign.organizationId, campaignId: w.campaign._id, passId: pass._id, name: `Book ${pass.roundNumber}.${idx.join('')}`, mode: 'manual',
    status, householdIds: idx.map((i) => w.doors[i]._id), doorCount: idx.length,
  });
const activate = async (w, pass) => {
  const r = await call('POST', `/admin/campaigns/${w.campaign._id}/passes/${pass._id}/activate`, asAdmin());
  assert.strictEqual(r.status, 200, `activate: ${show(r)}`);
};
const archiveByHand = async (w, pass) => {
  const r = await call('POST', `/admin/campaigns/${w.campaign._id}/passes/${pass._id}/archive`, { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, `archive: ${show(r)}`);
};

// A door result from the phone. `turfId` is sent only when given (undefined = a phone without the
// update); `late` marks an offline replay with the tap time it was recorded at.
const knock = (door, { kind = 'lit-drop', who = 'cara', turfId, at, late = false } = {}) =>
  call('POST', `/mobile/households/${door._id}/${kind}`, {
    token: ctx.tok[who],
    orgId: ctx.org._id,
    body: {
      location: LOC,
      ...(turfId !== undefined ? { turfId } : {}),
      ...(at ? { timestamp: iso(at) } : {}),
      ...(late ? { wasOfflineSubmission: true } : {}),
    },
  });
const rowOf = (door, who = 'cara') =>
  CanvassActivity.findOne({ householdId: door._id, userId: ctx.users[who]._id }).sort({ createdAt: -1, _id: -1 }).lean();
const expectRow = async (r, door, { passId, turfId, who = 'cara' }, what) => {
  assert.strictEqual(r.status, 201, `${what}: ${show(r)}`);
  const row = await rowOf(door, who);
  assert.strictEqual(str(row?.passId), str(passId), `${what}: counted in the wrong pass`);
  if (turfId !== undefined) assert.strictEqual(str(row?.turfId), str(turfId), `${what}: wrong book`);
  return row;
};
const passRows = async (pass) =>
  (await CanvassActivity.find({ passId: pass._id }).sort({ _id: 1 }).lean()).map((a) => `${a._id}|${a.householdId}|${a.userId}|${a.actionType}|${new Date(a.timestamp).getTime()}`);

const withSwitch = async (value, fn) => {
  const prev = process.env.LATE_KNOCK_ATTRIBUTION;
  if (value === undefined) delete process.env.LATE_KNOCK_ATTRIBUTION;
  else process.env.LATE_KNOCK_ATTRIBUTION = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.LATE_KNOCK_ATTRIBUTION;
    else process.env.LATE_KNOCK_ATTRIBUTION = prev;
  }
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, CampaignChange, SurveyTemplate, SurveyResponse,
    Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity]) {
    await M.deleteMany({});
  }
  delete process.env.LATE_KNOCK_ATTRIBUTION;
  const org = await Organization.create({ name: 'Late Org', slug: 'late-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'lk-a@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'lk-c@t.co', passwordHash: 'x', isActive: true });
  const ben = await User.create({ firstName: 'Ben', lastName: 'Teammate', email: 'lk-b@t.co', passwordHash: 'x', isActive: true });
  const carl = await User.create({ firstName: 'Carl', lastName: 'Late', email: 'lk-l@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [cara, 'canvasser'], [ben, 'canvasser'], [carl, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Ask', version: 1,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }, { id: 'n', text: 'No', order: 1 }] }],
  });
  const lit = await Campaign.create({ organizationId: org._id, name: 'Late Lit', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true });
  const survey = await Campaign.create({ organizationId: org._id, name: 'Late Survey', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true, surveyTemplateId: template._id });
  for (const c of [lit, survey]) {
    for (const u of [cara, ben, carl]) await CampaignAssignment.create({ organizationId: org._id, campaignId: c._id, userId: u._id });
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, cara, ben, carl, template, lit, survey,
    users: { cara, ben, carl },
    adminTok: signUserToken(admin),
    tok: { cara: signUserToken(cara), ben: signUserToken(ben), carl: signUserToken(carl) },
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('(1) the phone names the live book: the knock counts in the live pass — and without turfId, the same', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Live Book', 3);
  const a = await addPass(w, [0, 1, 2]);
  await activate(w, a.pass);
  const row = await expectRow(await knock(w.doors[0], { turfId: String(a.book._id) }), w.doors[0], { passId: a.pass._id, turfId: a.book._id }, 'live book');
  assert.strictEqual(str(row.effortId), str(w.effort._id), 'effortId is always the door owner');
  await expectRow(await knock(w.doors[1]), w.doors[1], { passId: a.pass._id, turfId: a.book._id }, 'no turfId');
});

test('(2) the pass ended (archived by hand) after the tap: the late knock counts in that pass, not in "no pass"', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Ended After Tap', 3);
  const a = await addPass(w, [0, 1, 2]);
  await activate(w, a.pass);
  const tappedAt = new Date(Date.now() - 1000);
  await archiveByHand(w, a.pass);
  const r = await knock(w.doors[0], { turfId: String(a.book._id), at: tappedAt, late: true });
  await expectRow(r, w.doors[0], { passId: a.pass._id, turfId: a.book._id }, 'tapped while live');
  assert.strictEqual(r.json.household.status, 'lit_dropped', 'the response answers for the pass it counted in');
  // A phone without the update: today's rule — nothing live holds the door, so no pass.
  await expectRow(await knock(w.doors[1], { at: tappedAt, late: true }), w.doors[1], { passId: null, turfId: null }, 'no turfId');
});

test('(3) the next pass went live: before the switch → old pass; after, a door the new pass holds → new pass (ruling 9), else old pass', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Switch', 4);
  const a = await addPass(w, [0, 1, 2, 3]);
  const b = await addPass(w, [0, 1, 2]); // a follow-up pass without door 3
  await activate(w, a.pass);
  const before0 = new Date(Date.now() - 1000);
  await activate(w, b.pass);
  const ended = (await Pass.findById(a.pass._id).lean()).archivedAt;
  assert.ok(ended >= before0);
  await sleep(10);
  const after0 = new Date();
  const bookA = String(a.book._id);

  await expectRow(await knock(w.doors[0], { turfId: bookA, at: before0, late: true }), w.doors[0], { passId: a.pass._id, turfId: a.book._id }, 'tapped before the switch');
  const r1 = await knock(w.doors[1], { turfId: bookA, at: after0 });
  await expectRow(r1, w.doors[1], { passId: b.pass._id, turfId: b.book._id }, 'tapped after the switch, door in the new pass');
  assert.strictEqual(r1.json.household.status, 'lit_dropped');
  await expectRow(await knock(w.doors[3], { turfId: bookA, at: after0 }), w.doors[3], { passId: a.pass._id, turfId: a.book._id }, 'after the switch, door in no live book');
  // The tap time equal to the end counts as made while live (tap <= archivedAt).
  await expectRow(await knock(w.doors[2], { turfId: bookA, at: ended, late: true }), w.doors[2], { passId: a.pass._id }, 'tapped at the very ms the pass ended');
});

test('(3b) tapped after the pass ended but before the next one started: the old pass — once, however late or often it arrives', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Gap', 3);
  const a = await addPass(w, [0, 1, 2]);
  const b = await addPass(w, [0, 1, 2]);
  await activate(w, a.pass);
  await archiveByHand(w, a.pass);
  await sleep(10);
  const inGap = new Date();
  await sleep(10);
  const bookA = String(a.book._id);

  // Delivered before the next pass started (no live book holds the door) — and its reply lost...
  await expectRow(await knock(w.doors[0], { turfId: bookA, at: inGap, late: true }), w.doors[0], { passId: a.pass._id, turfId: a.book._id }, 'delivered in the gap');
  await activate(w, b.pass);
  // ...so the phone sends it again after: the same knock, nothing new written.
  const retry = await knock(w.doors[0], { turfId: bookA, at: inGap, late: true });
  assert.strictEqual(retry.status, 200, `the retry is the knock already counted: ${show(retry)}`);
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: w.doors[0]._id }), 1, 'one tap, one row');
  // Made in the gap, first delivered after the next pass started: still the old pass.
  await expectRow(await knock(w.doors[1], { turfId: bookA, at: inGap, late: true }), w.doors[1], { passId: a.pass._id, turfId: a.book._id }, 'made in the gap, delivered after');
  assert.strictEqual(await CanvassActivity.countDocuments({ passId: b.pass._id }), 0, "nothing landed in the new pass — its crew still sees these doors to knock");
});

test('(4) a book that no longer leads anywhere falls to today\'s rule, and no earlier pass\'s rows change', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Gone Books', 6);
  const a = await addPass(w, [0, 1, 2, 3, 4, 5]);
  const b = await addPass(w, [0, 1, 2]);
  await activate(w, a.pass);
  // History in A, made while it was live (Ben's, so Cara's knocks below never replace them).
  for (const i of [0, 3, 4, 5]) assert.strictEqual((await knock(w.doors[i], { who: 'ben', turfId: String(a.book._id) })).status, 201);
  await activate(w, b.pass);
  await sleep(10);
  const rowsA = await passRows(a.pass);
  assert.strictEqual(rowsA.length, 4);
  const now = new Date();

  // Deleted (as a discard or re-cut leaves it): gone.
  const deleted = await addBook(w, a.pass, [4]);
  await Turf.deleteOne({ _id: deleted._id });
  await expectRow(await knock(w.doors[4], { turfId: String(deleted._id), at: now }), w.doors[4], { passId: null, turfId: null }, 'deleted book');
  // Not published any more.
  const drafted = await addBook(w, a.pass, [5], 'draft');
  await expectRow(await knock(w.doors[5], { turfId: String(drafted._id), at: now }), w.doors[5], { passId: null }, 'unpublished book');
  // Still there, but no longer holding the door (merged or split away).
  const shrunk = await addBook(w, a.pass, [0]);
  await expectRow(await knock(w.doors[3], { turfId: String(shrunk._id), at: now }), w.doors[3], { passId: null }, 'book without the door');
  // A door the new pass holds, through a book that no longer holds it: the new pass, as today.
  await expectRow(await knock(w.doors[1], { turfId: String(shrunk._id), at: now }), w.doors[1], { passId: b.pass._id, turfId: b.book._id }, 'book without the door, door live elsewhere');
  // Another walk list's book — even one that (wrongly) holds the door and whose pass ended after the tap.
  const other = await seedWalkList(ctx.lit, 'Other List', 1);
  const q = await addPass(other, [0]);
  await activate(other, q.pass);
  const foreign = await addBook(other, q.pass, []);
  await Turf.updateOne({ _id: foreign._id }, { $set: { householdIds: [w.doors[2]._id], doorCount: 1 } });
  const tapped = new Date(Date.now() - 500);
  await archiveByHand(other, q.pass);
  await expectRow(await knock(w.doors[2], { turfId: String(foreign._id), at: tapped, late: true }), w.doors[2], { passId: b.pass._id, turfId: b.book._id }, "another walk list's book");
  // A well-formed id that names nothing.
  await expectRow(await knock(w.doors[0], { turfId: String(new mongoose.Types.ObjectId()), at: now }), w.doors[0], { passId: b.pass._id }, 'unknown id');

  assert.deepStrictEqual(await passRows(a.pass), rowsA, "the ended pass's rows are untouched");
  assert.strictEqual(await CanvassActivity.countDocuments({ passId: q.pass._id }), 0, "nothing landed in the other walk list's pass");
});

test('(5) no turfId is exactly today\'s rule, and a garbage turfId is ignored — always 201, never 4xx/5xx', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Garbage', 2);
  const a = await addPass(w, [0, 1]);
  await activate(w, a.pass);
  const garbage = ['x', 12345, { a: 1 }, [String(a.book._id)], '', null, true, 'z'.repeat(24), 'a'.repeat(12), `${String(a.book._id)}0`, { $ne: null }];
  for (const g of garbage) {
    await expectRow(await knock(w.doors[0], { turfId: g }), w.doors[0], { passId: a.pass._id, turfId: a.book._id }, `live, turfId ${JSON.stringify(g)}`);
  }
  // An upper-case spelling of the real id is still the id.
  await expectRow(await knock(w.doors[0], { turfId: String(a.book._id).toUpperCase() }), w.doors[0], { passId: a.pass._id }, 'upper-case hex');

  const tappedAt = new Date(Date.now() - 1000);
  await archiveByHand(w, a.pass);
  // Each one a later tap than the last, so none reads as a duplicate delivery of the one before.
  for (const [i, g] of garbage.entries()) {
    await expectRow(await knock(w.doors[1], { turfId: g, at: new Date(tappedAt.getTime() + i) }), w.doors[1], { passId: null, turfId: null }, `ended, turfId ${JSON.stringify(g)}`);
  }
  await expectRow(await knock(w.doors[1], { at: new Date(tappedAt.getTime() + 50) }), w.doors[1], { passId: null }, 'ended, no turfId');
});

test('(6) LATE_KNOCK_ATTRIBUTION=off, in any spelling, puts knocks back on today\'s rule; anything else leaves it on', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Switch Off', 6);
  const a = await addPass(w, [0, 1, 2, 3, 4, 5]);
  await activate(w, a.pass);
  const tappedAt = new Date(Date.now() - 1000);
  await archiveByHand(w, a.pass);
  const bookA = String(a.book._id);
  const cases = [['off', null], [' OFF ', null], ['Off\n', null], ['false', a.pass._id], ['0', a.pass._id], [undefined, a.pass._id]];
  for (const [i, [value, expected]] of cases.entries()) {
    await withSwitch(value, async () => {
      await expectRow(await knock(w.doors[i], { turfId: bookA, at: tappedAt, late: true }), w.doors[i], { passId: expected }, `LATE_KNOCK_ATTRIBUTION=${JSON.stringify(value)}`);
    });
  }
});

test('(7) the survey route honors turfId the same way', { skip }, async () => {
  const w = await seedWalkList(ctx.survey, 'Survey Late', 2);
  const voters = [];
  for (const [i, d] of w.doors.entries()) {
    voters.push(await Voter.create({
      organizationId: ctx.org._id, campaignId: ctx.survey._id, householdId: d._id, stateVoterId: `LK${doorSeq}-${i}`, firstName: `V${i}`, lastName: 'Late', fullName: `V${i} Late`,
    }));
  }
  const a = await addPass(w, [0, 1]);
  await activate(w, a.pass);
  const tappedAt = new Date(Date.now() - 1000);
  await archiveByHand(w, a.pass);
  const submit = (voter, extra) =>
    call('POST', `/mobile/voters/${voter._id}/survey`, {
      token: ctx.tok.cara,
      orgId: ctx.org._id,
      body: {
        surveyTemplateId: String(ctx.template._id),
        answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: ['y'] }],
        location: LOC,
        timestamp: iso(tappedAt),
        wasOfflineSubmission: true,
        ...extra,
      },
    });
  const r = await submit(voters[0], { turfId: String(a.book._id) });
  assert.strictEqual(r.status, 201, show(r));
  const resp = await SurveyResponse.findOne({ voterId: voters[0]._id }).lean();
  assert.strictEqual(str(resp.passId), str(a.pass._id), 'the answers count in the pass they were given in');
  assert.strictEqual(str(resp.turfId), str(a.book._id));
  const act = await CanvassActivity.findOne({ householdId: w.doors[0]._id, actionType: 'survey_submitted' }).lean();
  assert.strictEqual(str(act.passId), str(a.pass._id), 'the knock row matches its SurveyResponse');
  assert.strictEqual(r.json.household.status, 'surveyed');

  const r2 = await submit(voters[1], {});
  assert.strictEqual(r2.status, 201, show(r2));
  assert.strictEqual((await SurveyResponse.findOne({ voterId: voters[1]._id }).lean()).passId, null, 'no turfId: today\'s rule');
  // Garbage is ignored here too (a later tap, so it is not a duplicate delivery of the one above).
  const r3 = await submit(voters[1], { turfId: { a: 1 }, timestamp: iso(new Date(tappedAt.getTime() + 5)) });
  assert.strictEqual(r3.status, 201, show(r3));
  assert.strictEqual((await SurveyResponse.findOne({ voterId: voters[1]._id }).lean()).passId, null);
});

test('(8) the walk-up add accepts turfId for its per-round stamp', { skip }, async () => {
  const w = await seedWalkList(ctx.survey, 'Walk Up', 1);
  const a = await addPass(w, [0]);
  await activate(w, a.pass);
  assert.strictEqual((await knock(w.doors[0], { kind: 'not-home' })).status, 201);
  // Globally the door reads surveyed (an earlier round), so the answer shows which round it speaks for.
  await Household.updateOne({ _id: w.doors[0]._id }, { $set: { status: 'surveyed' } });
  await archiveByHand(w, a.pass);
  const add = (extra) =>
    call('POST', `/mobile/households/${w.doors[0]._id}/voters`, {
      token: ctx.tok.cara,
      orgId: ctx.org._id,
      body: { voterId: new mongoose.Types.ObjectId().toHexString(), firstName: 'Walk', lastName: 'Up', location: LOC, ...extra },
    });
  const r = await add({ turfId: String(a.book._id) });
  assert.strictEqual(r.status, 201, show(r));
  assert.strictEqual(r.json.household.status, 'not_home', 'it answers for the book the phone named (its ended pass)');
  const r2 = await add({});
  assert.strictEqual(r2.status, 201, show(r2));
  assert.strictEqual(r2.json.household.status, 'surveyed', 'no turfId: no pass, the door\'s global state');
  for (const g of ['x', 7, { a: 1 }]) {
    const rg = await add({ turfId: g });
    assert.strictEqual(rg.status, 201, show(rg));
  }
});

// C.6: the walk-up add passes "the same" as the other two routes — clientTurfId AND tappedAt.
test('(8b) a walk-up add tapped before its pass ended, delivered after the next pass started, answers for the old pass', { skip }, async () => {
  const w = await seedWalkList(ctx.survey, 'Walk Up Late', 1);
  const a = await addPass(w, [0]);
  const b = await addPass(w, [0]);
  await activate(w, a.pass);
  assert.strictEqual((await knock(w.doors[0], { kind: 'not-home' })).status, 201);
  const tappedAt = new Date(Date.now() - 1000);
  await activate(w, b.pass);
  const r = await call('POST', `/mobile/households/${w.doors[0]._id}/voters`, {
    token: ctx.tok.cara,
    orgId: ctx.org._id,
    body: {
      voterId: new mongoose.Types.ObjectId().toHexString(), firstName: 'Late', lastName: 'Add', location: LOC,
      turfId: String(a.book._id), timestamp: iso(tappedAt), wasOfflineSubmission: true,
    },
  });
  assert.strictEqual(r.status, 201, show(r));
  assert.strictEqual(r.json.household.status, 'not_home', `tapped while Pass 1 was live, so it answers for Pass 1; got ${r.json.household.status}`);
  // Control: the same add answering for the NEW pass reads differently, so the assertion above can tell.
  const now = await call('POST', `/mobile/households/${w.doors[0]._id}/voters`, {
    token: ctx.tok.cara,
    orgId: ctx.org._id,
    body: { voterId: new mongoose.Types.ObjectId().toHexString(), firstName: 'Now', lastName: 'Add', location: LOC, turfId: String(a.book._id) },
  });
  assert.strictEqual(now.status, 201, show(now));
  assert.strictEqual(now.json.household.status, 'unknocked', 'tapped after the switch: the new pass, where the door is fresh');
});

test('(9) a late knock never moves the last visit backwards — and a teammate\'s /changes still ships the door', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Last Visit', 2);
  const a = await addPass(w, [0, 1], [ctx.cara, ctx.ben, ctx.carl]);
  await activate(w, a.pass);
  const door = w.doors[0];
  assert.strictEqual((await knock(door, { who: 'cara' })).status, 201);
  const newer = await Household.findById(door._id).lean();
  assert.ok(newer.lastActionAt);
  await sleep(10);
  const since = new Date();
  await sleep(10);

  // Carl's phone replays an older lit drop at the same door.
  const r = await knock(door, { who: 'carl', turfId: String(a.book._id), at: new Date(newer.lastActionAt.getTime() - 3600_000), late: true });
  await expectRow(r, door, { passId: a.pass._id, who: 'carl' }, 'late lit drop');
  const after0 = await Household.findById(door._id).lean();
  assert.strictEqual(after0.lastActionAt.getTime(), newer.lastActionAt.getTime(), 'the last visit stays the later one');
  assert.strictEqual(str(after0.lastActionBy), str(ctx.cara._id), 'and keeps who made it');
  assert.strictEqual(after0.status, newer.status, 'nothing else about the door changed');
  assert.ok(after0.updatedAt > since, 'but the save still bumped updatedAt');

  const changes = await call('GET', `/mobile/changes?campaignId=${ctx.lit._id}&since=${encodeURIComponent(iso(since))}`, { token: ctx.tok.ben, orgId: ctx.org._id });
  assert.strictEqual(changes.status, 200, show(changes));
  assert.ok(changes.json.households.some((h) => String(h._id) === String(door._id)), "the teammate's poll ships the door");

  // A later knock still moves it forward.
  const r2 = await knock(door, { who: 'carl' });
  assert.strictEqual(r2.status, 201, show(r2));
  const after1 = await Household.findById(door._id).lean();
  assert.ok(after1.lastActionAt > newer.lastActionAt);
  assert.strictEqual(str(after1.lastActionBy), str(ctx.carl._id));
});

test('(9b) an older survey replay that completes the door this round reaches the teammate, with the last visit kept', { skip }, async () => {
  const w = await seedWalkList(ctx.survey, 'Late Survey Visit', 1);
  const door = w.doors[0];
  const voter = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.survey._id, householdId: door._id, stateVoterId: `LKS${doorSeq}`, firstName: 'Sam', lastName: 'Late', fullName: 'Sam Late', surveyStatus: 'surveyed',
  });
  const p0 = await addPass(w, [0]);
  const a = await addPass(w, [0], [ctx.cara, ctx.ben, ctx.carl]);
  // Surveyed in an earlier round: globally the door already reads surveyed.
  await Pass.updateOne({ _id: p0.pass._id }, { $set: { status: 'archived', activatedAt: new Date(Date.now() - 2 * 86400_000), archivedAt: new Date(Date.now() - 86400_000), archivedFrom: 'active', archivedVia: 'next-pass' } });
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.survey._id, effortId: w.effort._id, passId: p0.pass._id, householdId: door._id, voterId: voter._id,
    userId: ctx.ben._id, actionType: 'survey_submitted', timestamp: new Date(Date.now() - 1.5 * 86400_000), location: { lat: LOC.lat, lng: LOC.lng },
  });
  await activate(w, a.pass);
  assert.strictEqual((await knock(door, { kind: 'not-home', who: 'cara' })).status, 201);
  const newer = await Household.findById(door._id).lean();
  assert.strictEqual(newer.status, 'surveyed', 'completion-sticky across rounds');
  await sleep(10);
  const since = new Date();
  await sleep(10);

  const r = await call('POST', `/mobile/voters/${voter._id}/survey`, {
    token: ctx.tok.carl,
    orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: ['y'] }],
      location: LOC,
      timestamp: iso(new Date(newer.lastActionAt.getTime() - 3600_000)),
      wasOfflineSubmission: true,
      turfId: String(a.book._id),
    },
  });
  assert.strictEqual(r.status, 201, show(r));
  const after0 = await Household.findById(door._id).lean();
  assert.strictEqual(after0.status, 'surveyed');
  assert.strictEqual(after0.lastActionAt.getTime(), newer.lastActionAt.getTime(), 'the last visit stays the later one');
  assert.ok(after0.updatedAt > since, 'updatedAt still moved');
  const changes = await call('GET', `/mobile/changes?campaignId=${ctx.survey._id}&since=${encodeURIComponent(iso(since))}`, { token: ctx.tok.ben, orgId: ctx.org._id });
  assert.strictEqual(changes.status, 200, show(changes));
  const shipped = changes.json.households.find((h) => String(h._id) === String(door._id));
  assert.ok(shipped, "the teammate's poll ships the door");
  assert.strictEqual(shipped.status, 'surveyed', 'completed this round');
});

// One tap is one knock, whichever pass each delivery of it resolves to. Attribution is decided on
// arrival, so a retry (first reply lost) can resolve differently after a pass ends, starts or comes back
// in between — code review round 2 reproduced one tap counted in two passes. The retry is recognized as
// the same tap in any pass (routes/mobile/canvass.js deliveredInAnotherPass).
test('(10) one tap counts once however its deliveries straddle a pass change — the next pass ending or coming back, or the door saved again', { skip }, async () => {
  const w = await seedWalkList(ctx.lit, 'Straddle', 3);
  const a = await addPass(w, [0, 1, 2]);
  const b = await addPass(w, [0, 1, 2]);
  await activate(w, a.pass);
  await activate(w, b.pass); // Pass 1 ends; the phone still shows its book
  const bookA = String(a.book._id);
  const rowsOf = async (door) => (await CanvassActivity.find({ householdId: door._id }).sort({ _id: 1 }).lean()).map((r) => `${r.actionType}@${str(r.passId)}`);

  // A — tapped after Pass 2 started: the first delivery counts in Pass 2 (ruling 9), its reply lost.
  await sleep(10);
  const tapA = new Date();
  await expectRow(await knock(w.doors[0], { turfId: bookA, at: tapA, late: true }), w.doors[0], { passId: b.pass._id }, 'A: first delivery');
  // D — the same, and then the canvasser saves that door again: the later save replaces the first row.
  await sleep(10);
  const tapD = new Date();
  await expectRow(await knock(w.doors[1], { turfId: bookA, at: tapD, late: true }), w.doors[1], { passId: b.pass._id }, 'D: first delivery');
  await sleep(10);
  assert.strictEqual((await knock(w.doors[1], { kind: 'no-soliciting' })).status, 201);

  // Pass 2 ends, so each retry now resolves to Pass 1 (no live book) — and is the knock already counted.
  await archiveByHand(w, b.pass);
  const retryA = await knock(w.doors[0], { turfId: bookA, at: tapA, late: true });
  assert.strictEqual(retryA.status, 200, `A: ${show(retryA)}`);
  assert.strictEqual(retryA.json.household.status, 'lit_dropped', 'A: answered for the pass it counted in');
  assert.deepStrictEqual(await rowsOf(w.doors[0]), [`lit_dropped@${str(b.pass._id)}`], 'A: one tap, one row');
  const retryD = await knock(w.doors[1], { turfId: bookA, at: tapD, late: true });
  assert.strictEqual(retryD.status, 200, `D: ${show(retryD)}`);
  assert.deepStrictEqual(await rowsOf(w.doors[1]), [`no_soliciting@${str(b.pass._id)}`], 'D: the later save stands alone');

  // B — tapped while nothing is live: the first delivery counts in Pass 1. Pass 2 comes back, so the
  // retry would resolve to Pass 2 (the tap came after its first start) — the same knock again.
  await sleep(10);
  const tapB = new Date();
  await expectRow(await knock(w.doors[2], { turfId: bookA, at: tapB, late: true }), w.doors[2], { passId: a.pass._id }, 'B: first delivery');
  const back = await call('POST', `/admin/campaigns/${w.campaign._id}/passes/${b.pass._id}/bring-back`, asAdmin());
  assert.strictEqual(back.status, 200, show(back));
  const retryB = await knock(w.doors[2], { turfId: bookA, at: tapB, late: true });
  assert.strictEqual(retryB.status, 200, `B: ${show(retryB)}`);
  assert.deepStrictEqual(await rowsOf(w.doors[2]), [`lit_dropped@${str(a.pass._id)}`], 'B: one tap, one row');

  // A new tap is never mistaken for an old one: a later knock at door 0 lands in live Pass 2.
  await expectRow(await knock(w.doors[0], { turfId: bookA, late: true, at: new Date() }), w.doors[0], { passId: b.pass._id }, 'a new tap');
});

test('(10b) a survey retried across a pass change counts once — even after another answer at the door replaced its row', { skip }, async () => {
  const w = await seedWalkList(ctx.survey, 'Straddle Survey', 1);
  const door = w.doors[0];
  const voters = [];
  for (const i of [0, 1]) {
    voters.push(await Voter.create({
      organizationId: ctx.org._id, campaignId: ctx.survey._id, householdId: door._id, stateVoterId: `LKX${doorSeq}-${i}`, firstName: `X${i}`, lastName: 'Late', fullName: `X${i} Late`,
    }));
  }
  const a = await addPass(w, [0]);
  const b = await addPass(w, [0]);
  await activate(w, a.pass);
  await activate(w, b.pass);
  const submit = (voter, at, extra = {}) =>
    call('POST', `/mobile/voters/${voter._id}/survey`, {
      token: ctx.tok.cara,
      orgId: ctx.org._id,
      body: {
        surveyTemplateId: String(ctx.template._id),
        answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: ['y'] }],
        location: LOC,
        timestamp: iso(at),
        ...extra,
      },
    });
  await sleep(10);
  const tap = new Date();
  const first = await submit(voters[0], tap, { turfId: String(a.book._id), wasOfflineSubmission: true });
  assert.strictEqual(first.status, 201, show(first));
  assert.strictEqual(str((await SurveyResponse.findOne({ voterId: voters[0]._id }).lean()).passId), str(b.pass._id), 'ruling 9: Pass 2');
  // The housemate, live: one row per canvasser per door per pass, so this replaces the first survey's row.
  await sleep(10);
  assert.strictEqual((await submit(voters[1], new Date())).status, 201);
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: door._id, voterId: voters[0]._id }), 0, "the first survey's row was replaced");

  await archiveByHand(w, b.pass);
  const retry = await submit(voters[0], tap, { turfId: String(a.book._id), wasOfflineSubmission: true });
  assert.strictEqual(retry.status, 200, `the same survey, already counted: ${show(retry)}`);
  assert.deepStrictEqual((await SurveyResponse.find({ voterId: voters[0]._id }).lean()).map((r) => str(r.passId)), [str(b.pass._id)], 'one answer, in Pass 2');
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: door._id, passId: a.pass._id }), 0, 'nothing in Pass 1');
});

test('(10c) a tap an admin struck stays struck when its retry resolves to another pass — and no other tap is struck with it', { skip }, async () => {
  const c = await Campaign.create({ organizationId: ctx.org._id, name: 'Late Struck', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true });
  await CampaignAssignment.create({ organizationId: ctx.org._id, campaignId: c._id, userId: ctx.cara._id });
  const w = await seedWalkList(c, 'Struck', 1);
  const door = w.doors[0];
  const a = await addPass(w, [0]);
  const b = await addPass(w, [0]);
  await activate(w, a.pass);
  await activate(w, b.pass);
  const bookA = String(a.book._id);
  await sleep(10);
  const before = new Date(); // a different tap at the door, still in the phone's queue
  await sleep(10);
  const tap = new Date();
  await expectRow(await knock(door, { turfId: bookA, at: tap, late: true }), door, { passId: b.pass._id }, 'first delivery');

  const strike = await call('POST', `/admin/campaigns/${c._id}/unknock-entries`, { ...asAdmin(), body: { scope: { userId: String(ctx.cara._id) } } });
  assert.strictEqual(strike.status, 201, show(strike));
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: door._id }), 0, 'struck');

  await archiveByHand(w, b.pass); // the retry now resolves to Pass 1
  const retry = await knock(door, { turfId: bookA, at: tap, late: true });
  assert.strictEqual(retry.status, 200, `the struck tap stays out: ${show(retry)}`);
  assert.strictEqual(retry.json.superseded, true);
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: door._id }), 0);
  // Only that tap: an earlier one, never struck, lands in Pass 1.
  await expectRow(await knock(door, { turfId: bookA, at: before, late: true }), door, { passId: a.pass._id }, 'another tap');
});
