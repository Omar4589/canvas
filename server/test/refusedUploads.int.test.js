import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { inspect } from 'node:util';
import mongoose from 'mongoose';
import express from 'express';
import compression from 'compression';

// Doors not saved over the REAL Express app (docs/PROPOSAL_OFFLINE_QUEUE.md §D, §F, §O):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/refused_test node --test --test-force-exit test/refusedUploads.int.test.js
// createApp mounts middleware/refusalRecorder.js where routes/index.js puts it, so every refusal here comes
// from the real gates and routes: requireEntitlement's 402, orgContext's and requireOrgMember's 403/404,
// and routes/mobile/canvass.js's own. The recorder writes after the response, so each call is followed by
// settle(), which waits for the writes in flight (the same drain server.js runs on SIGTERM). The tests run
// in order on one set of fixtures; most find their rows by a queue item id of their own.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-refused-uploads';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Turf } = await import('../src/models/Turf.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { RefusedUpload } = await import('../src/models/RefusedUpload.js');
const { refusalRecorder, drainRefusalWrites, syncRefusedUploadIndexes, DAILY_CAP } = await import('../src/middleware/refusalRecorder.js');
const { accessLog } = await import('../src/middleware/accessLog.js');
const { errorHandler } = await import('../src/middleware/error.js');
const { ORG_SCOPED, deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { finishDeletion } = await import('../src/services/users/deleteAccount.js');
const { zonedDayStr } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const LOC = { lat: 30.26, lng: -97.74, accuracy: 5 };
const PIN_ROLE_MESSAGE = 'Only team leads and admins can move a house pin. Ask your lead to fix this one.';
const oid = () => new mongoose.Types.ObjectId();
const iso = (ms) => new Date(ms).toISOString();

let server;
let base;
const ctx = {};

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
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

// A queued replay's body, as mobile/lib/offlineQueue.js sends it.
const replay = (extra = {}) => ({ location: LOC, timestamp: iso(Date.now() - 60_000), wasOfflineSubmission: true, ...extra });
const surveyBody = (extra = {}) => replay({ surveyTemplateId: String(ctx.tplA._id), answers: [], ...extra });
const addBody = (extra = {}) => replay({ voterId: oid().toHexString(), firstName: 'Wally', lastName: 'Up', ...extra });
const pinBody = (extra = {}) => replay({ lat: 30.2601, lng: -97.7401, source: 'drag', ...extra });

const as = (who, org = ctx.orgA) => ({ token: ctx.tok[who], orgId: org?._id });
const post = (path, who, body, org) => call('POST', `/mobile${path}`, { ...as(who, org), body });

// The recorder writes on 'finish', after the response: let it start, then wait for it.
const settle = async () => {
  await new Promise((r) => setImmediate(r));
  await drainRefusalWrites(5000);
};
const rowOf = (who, queueItemId) => RefusedUpload.findOne({ userId: ctx.u[who]._id, queueItemId }).lean();

let seq = 0;
const house = (campaign, extra = {}) => {
  seq += 1;
  return {
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    addressLine1: `${seq} Probe St`,
    city: 'Austin',
    state: 'TX',
    zipCode: '78704',
    normalizedAddress: `${seq} probe st austin tx 78704`,
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status: 'unknocked',
    isActive: true,
    ...extra,
  };
};

const captureErrors = async (fn) => {
  const lines = [];
  const real = console.error;
  console.error = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lines;
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // Production's setting (config/db.js): a filter on an undeclared field is dropped, not matched.
  mongoose.set('strictQuery', true);
  await mongoose.connection.db.dropDatabase();
  await syncRefusedUploadIndexes('test');

  const org = (name, slug) => Organization.create({ name, slug, isActive: true });
  const orgA = await org('Org A', 'ru-org-a');
  const orgB = await org('Org B', 'ru-org-b');
  const orgC = await org('Org C', 'ru-org-c');
  for (const o of [orgA, orgB, orgC]) await Subscription.create({ organizationId: o._id, status: 'active' });

  const mk = (first, extra = {}) =>
    User.create({ firstName: first, lastName: 'T', email: `${first.toLowerCase()}@ru.test`, passwordHash: 'x', isActive: true, ...extra });
  const u = {};
  for (const n of ['Ada', 'Bea', 'Lena', 'Lou', 'Cara', 'Nina', 'Rex', 'Dee', 'Mona', 'Stan', 'Carl', 'Cappy', 'Gone']) u[n.toLowerCase()] = await mk(n);
  u.pat = await mk('Pat', { mustChangePassword: true });
  u.sam = await mk('Sam', { isSuperAdmin: true, platformRole: 'support' });
  const member = (user, o, role, extra = {}) => Membership.create({ userId: user._id, organizationId: o._id, role, isActive: true, ...extra });
  await member(u.ada, orgA, 'admin', { billingAccess: true });
  await member(u.lena, orgA, 'lead');
  await member(u.lou, orgA, 'lead');
  for (const k of ['cara', 'nina', 'rex', 'mona', 'pat', 'cappy']) await member(u[k], orgA, 'canvasser');
  await member(u.dee, orgA, 'canvasser', { isActive: false });
  await member(u.bea, orgB, 'admin', { billingAccess: true });
  await member(u.stan, orgB, 'canvasser');
  await member(u.mona, orgB, 'canvasser');
  await member(u.carl, orgC, 'canvasser');

  const tpl = (o, name) =>
    SurveyTemplate.create({
      organizationId: o._id,
      name,
      version: 1,
      questions: [{ key: 'q', label: 'Q?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }] }],
    });
  const tplA = await tpl(orgA, 'Ask');
  const tplOther = await tpl(orgA, 'Other survey');
  const tplB = await tpl(orgB, 'B survey');
  const camp = (o, name, extra = {}) =>
    Campaign.create({ organizationId: o._id, name, type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true, surveyTemplateId: tplA._id, ...extra });
  const campA = await camp(orgA, 'Campaign A');
  const campA2 = await camp(orgA, 'Campaign A2');
  const campArch = await camp(orgA, 'Archived', { isActive: false });
  const campDel = await camp(orgA, 'Deleting');
  const campRace = await camp(orgA, 'Racing a delete');
  const campB = await camp(orgB, 'Campaign B', { surveyTemplateId: tplB._id });
  const campC = await camp(orgC, 'Campaign C', { surveyTemplateId: null });

  const assign = (user, c) => CampaignAssignment.create({ organizationId: c.organizationId, campaignId: c._id, userId: user._id });
  for (const c of [campA, campArch, campDel]) await assign(u.cara, c);
  await assign(u.carl, campC);
  await CampaignManager.create({ organizationId: orgA._id, campaignId: campA._id, userId: u.lena._id });
  await CampaignManager.create({ organizationId: orgA._id, campaignId: campA2._id, userId: u.lou._id });

  const doorsA = await Household.insertMany(Array.from({ length: 16 }, () => house(campA)));
  const doorsA2 = await Household.insertMany([house(campA2), house(campA2)]);
  const [archDoor] = await Household.insertMany([house(campArch)]);
  const [delDoor] = await Household.insertMany([house(campDel)]);
  const [raceDoor] = await Household.insertMany([house(campRace)]);
  const doorsB = await Household.insertMany([house(campB), house(campB)]);
  const [doorC] = await Household.insertMany([house(campC)]);
  const book = (c, name, doors) => Turf.create({ organizationId: c.organizationId, campaignId: c._id, passId: oid(), name, mode: 'manual', householdIds: doors.map((d) => d._id) });
  const bookA = await book(campA, 'Book A', doorsA);
  const bookA2 = await book(campA2, 'Book A2', doorsA2);
  const bookB = await book(campB, 'Book B', doorsB);

  const voter = (door, first, extra = {}) =>
    Voter.create({
      organizationId: door.organizationId, campaignId: door.campaignId, householdId: door._id,
      stateVoterId: `sv-${first}`, firstName: first, lastName: 'Voter', fullName: `${first} Voter`, ...extra,
    });
  const voterA = await voter(doorsA[0], 'Val');
  const voterDnc = await voter(doorsA[1], 'Dana', { doNotContact: { flagged: true, at: new Date() } });
  // A corrupt row: an org-A voter whose household sits in org B. A join that crosses organizations files nothing.
  const voterCrossed = await Voter.create({
    organizationId: orgA._id, campaignId: campA._id, householdId: doorsB[1]._id,
    stateVoterId: 'sv-crossed', firstName: 'Cross', lastName: 'Voter', fullName: 'Cross Voter',
  });

  // Rex and Sam worked in org A once (Rex before he was removed; Sam under a support grant since lapsed).
  for (const who of [u.rex, u.sam]) {
    await CanvassActivity.create({
      organizationId: orgA._id, campaignId: campA._id, householdId: doorsA[15]._id, userId: who._id,
      actionType: 'not_home', location: LOC, timestamp: new Date(Date.now() - 86_400_000),
    });
  }
  await Membership.deleteOne({ userId: u.rex._id, organizationId: orgA._id }); // Remove deletes the row

  Object.assign(ctx, {
    orgA, orgB, orgC, u, tplA, tplOther, tplB, campA, campA2, campArch, campDel, campRace, campB, campC,
    doorsA, doorsA2, archDoor, delDoor, raceDoor, doorsB, doorC, bookA, bookA2, bookB, voterA, voterDnc, voterCrossed,
    tok: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, signUserToken(v)])),
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await drainRefusalWrites(5000);
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (URI) await mongoose.disconnect();
});

test('each refusal class is recorded with its code and campaign', { skip }, async () => {
  const { doorsA, bookA, campA, campB, orgA, orgB } = ctx;

  // Not on the campaign's team (403, now coded). The body's campaign and org are ignored.
  const ts = iso(Date.now() - 90_000);
  let r = await post(`/households/${doorsA[2]._id}/not-home`, 'nina', replay({
    queueItemId: 'na-1', timestamp: ts, turfId: String(bookA._id), campaignId: String(campB._id), organizationId: String(orgB._id),
  }));
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual({ error: r.json.error, code: r.json.code }, { error: 'Not assigned to this campaign', code: 'NOT_ASSIGNED' });
  await settle();
  const row = await rowOf('nina', 'na-1');
  assert.ok(row, 'recorded');
  assert.strictEqual(String(row.organizationId), String(orgA._id));
  assert.strictEqual(String(row.campaignId), String(campA._id), 'the household’s campaign, never the body’s');
  assert.strictEqual(row.kind, 'result');
  assert.strictEqual(row.actionType, 'not_home');
  assert.strictEqual(String(row.householdId), String(doorsA[2]._id));
  assert.strictEqual(String(row.turfId), String(bookA._id));
  assert.strictEqual(row.status, 403);
  assert.strictEqual(row.code, 'NOT_ASSIGNED');
  assert.strictEqual(row.reason, 'Not assigned to this campaign');
  assert.strictEqual(row.recordedAt.toISOString(), ts);
  assert.strictEqual(row.reviewedAt, null);
  assert.strictEqual(row.savedLaterAt, null);
  const days = (row.expiresAt - row.createdAt) / 86_400_000;
  assert.ok(Math.abs(days - 180) < 0.01, `expires in 180 days (${days})`);

  // The survey's refusals: do-not-contact, the walk list's survey switched, a deleted survey, a voter
  // that isn't there (a walk-up survey whose add was refused) — filed by the book.
  r = await post(`/voters/${ctx.voterDnc._id}/survey`, 'cara', surveyBody({ queueItemId: 'sv-dnc' }));
  assert.strictEqual(r.json.code, 'DO_NOT_CONTACT');
  r = await post(`/voters/${ctx.voterA._id}/survey`, 'cara', surveyBody({ queueItemId: 'sv-switched', surveyTemplateId: String(ctx.tplOther._id) }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'SURVEY_TEMPLATE_MISMATCH');
  assert.strictEqual(r.json.error, "Survey template doesn't match this door's effort survey.", 'the message is unchanged');
  r = await post(`/voters/${ctx.voterA._id}/survey`, 'cara', surveyBody({ queueItemId: 'sv-gone-template', surveyTemplateId: oid().toHexString() }));
  assert.strictEqual(r.json.code, 'TEMPLATE_NOT_FOUND');
  const ghostVoter = oid();
  r = await post(`/voters/${ghostVoter}/survey`, 'cara', surveyBody({ queueItemId: 'sv-no-voter', turfId: String(bookA._id) }));
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.json.code, 'VOTER_NOT_FOUND');
  // A house that isn't there any more (Undo import), filed by the book too.
  const ghostHouse = oid();
  r = await post(`/households/${ghostHouse}/refused`, 'cara', replay({ queueItemId: 'nh-no-house', turfId: String(bookA._id) }));
  assert.strictEqual(r.json.code, 'HOUSEHOLD_NOT_FOUND');
  // A pin move by a canvasser; a walk-up add on an archived campaign; zod's invalid input.
  r = await post(`/households/${doorsA[3]._id}/location`, 'cara', pinBody({ queueItemId: 'pin-role' }));
  assert.strictEqual(r.json.code, 'FORBIDDEN_ROLE');
  r = await post(`/households/${ctx.archDoor._id}/voters`, 'cara', addBody({ queueItemId: 'add-archived' }));
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'campaign-archived');
  r = await post(`/households/${doorsA[4]._id}/not-home`, 'cara', replay({ queueItemId: 'nh-invalid', note: 12345 }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'INVALID_INPUT');
  await settle();

  const dnc = await rowOf('cara', 'sv-dnc');
  assert.deepStrictEqual(
    [dnc.kind, dnc.code, String(dnc.voterId), String(dnc.householdId), String(dnc.surveyTemplateId), String(dnc.campaignId)],
    ['survey', 'DO_NOT_CONTACT', String(ctx.voterDnc._id), String(doorsA[1]._id), String(ctx.tplA._id), String(campA._id)]
  );
  assert.strictEqual((await rowOf('cara', 'sv-switched')).code, 'SURVEY_TEMPLATE_MISMATCH');
  assert.strictEqual((await rowOf('cara', 'sv-gone-template')).code, 'TEMPLATE_NOT_FOUND');
  const noVoter = await rowOf('cara', 'sv-no-voter');
  assert.deepStrictEqual(
    [noVoter.code, String(noVoter.campaignId), String(noVoter.voterId), noVoter.householdId, String(noVoter.turfId)],
    ['VOTER_NOT_FOUND', String(campA._id), String(ghostVoter), null, String(bookA._id)]
  );
  const noHouse = await rowOf('cara', 'nh-no-house');
  assert.deepStrictEqual(
    [noHouse.code, noHouse.actionType, String(noHouse.campaignId), String(noHouse.householdId)],
    ['HOUSEHOLD_NOT_FOUND', 'refused', String(campA._id), String(ghostHouse)]
  );
  const pin = await rowOf('cara', 'pin-role');
  assert.deepStrictEqual([pin.kind, pin.code, pin.reason, pin.actionType], ['pin_move', 'FORBIDDEN_ROLE', PIN_ROLE_MESSAGE, null]);
  const archived = await rowOf('cara', 'add-archived');
  assert.deepStrictEqual([archived.kind, archived.code, String(archived.campaignId)], ['add_person', 'campaign-archived', String(ctx.campArch._id)]);
  assert.strictEqual((await rowOf('cara', 'nh-invalid')).code, 'INVALID_INPUT');
});

test('the 402 and the org-context refusals are recorded for all four kinds, a pin move included', { skip }, async () => {
  const { doorsA, orgA, campA } = ctx;
  const four = (who, prefix, org) => [
    post(`/households/${doorsA[5]._id}/not-home`, who, replay({ queueItemId: `${prefix}-result`, timestamp: iso(Date.now() - 5_000) }), org),
    post(`/voters/${ctx.voterA._id}/survey`, who, surveyBody({ queueItemId: `${prefix}-survey`, timestamp: iso(Date.now() - 5_000) }), org),
    post(`/households/${doorsA[6]._id}/voters`, who, addBody({ queueItemId: `${prefix}-add`, timestamp: iso(Date.now() - 5_000) }), org),
    post(`/households/${doorsA[7]._id}/location`, who, pinBody({ queueItemId: `${prefix}-pin`, timestamp: iso(Date.now() - 5_000) }), org),
  ];
  const kinds = { result: 'result', survey: 'survey', add: 'add_person', pin: 'pin_move' };
  const expectRows = async (who, prefix, code, reason) => {
    for (const [suffix, kind] of Object.entries(kinds)) {
      const row = await rowOf(who, `${prefix}-${suffix}`);
      assert.ok(row, `${prefix}-${suffix} recorded`);
      assert.deepStrictEqual(
        [row.kind, row.code, String(row.organizationId), String(row.campaignId)],
        [kind, code, String(orgA._id), String(campA._id)],
        `${prefix}-${suffix}`
      );
      if (reason) assert.strictEqual(row.reason, reason);
    }
  };

  // Paused AFTER these were recorded: requireEntitlement answers 402 before any router.
  await Subscription.updateOne({ organizationId: orgA._id }, { $set: { status: 'suspended', statusChangedAt: new Date(Date.now() - 30_000) } });
  try {
    for (const r of await Promise.all(four('cara', 'paused'))) {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.json.code, 'subscription-inactive');
    }
    await settle();
  } finally {
    await Subscription.updateOne({ organizationId: orgA._id }, { $set: { status: 'active' } });
  }
  await expectRows('cara', 'paused', 'subscription-inactive');

  // Removed from the organization (the membership row is gone), with org A pinned on the item: orgContext's
  // 403. Filed in org A because his own earlier knock is there.
  for (const r of await Promise.all(four('rex', 'removed'))) {
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.json.code, 'ORG_CONTEXT');
  }
  // Deactivated: the membership stays, switched off — the same 403.
  const deactivated = await post(`/households/${doorsA[5]._id}/not-home`, 'dee', replay({ queueItemId: 'deactivated-result' }));
  assert.strictEqual(deactivated.json.code, 'ORG_CONTEXT');
  // An item with no org pinned, from someone with no active membership: requireOrgMember's FORBIDDEN_ROLE.
  const noOrg = await post(`/households/${doorsA[7]._id}/location`, 'rex', pinBody({ queueItemId: 'removed-no-org-pin' }), null);
  assert.strictEqual(noOrg.status, 403);
  assert.deepStrictEqual([noOrg.json.code, noOrg.json.error], ['FORBIDDEN_ROLE', 'No active org membership']);
  // Doorline staff whose support grant has lapsed.
  const staff = await post(`/households/${doorsA[5]._id}/not-home`, 'sam', replay({ queueItemId: 'staff-result' }));
  assert.strictEqual(staff.json.code, 'SUPPORT_ACCESS_REQUIRED');
  await settle();

  await expectRows('rex', 'removed', 'ORG_CONTEXT', 'Not a member of this organization');
  assert.strictEqual((await rowOf('dee', 'deactivated-result')).code, 'ORG_CONTEXT');
  const pin = await rowOf('rex', 'removed-no-org-pin');
  assert.deepStrictEqual([pin.kind, pin.code, pin.reason, String(pin.organizationId)], ['pin_move', 'FORBIDDEN_ROLE', 'No active org membership', String(orgA._id)]);
  assert.strictEqual((await rowOf('sam', 'staff-result')).code, 'SUPPORT_ACCESS_REQUIRED');
});

test('live refusals, a 401, the temp-password 403 and a 5xx are not recorded', { skip }, async () => {
  const { doorsA } = ctx;
  const before_ = await RefusedUpload.countDocuments({});
  // Live: the phone shows these itself, so nothing is listed.
  let r = await post(`/households/${doorsA[2]._id}/not-home`, 'nina', { location: LOC, timestamp: iso(Date.now()), queueItemId: 'live-1' });
  assert.strictEqual(r.status, 403);
  r = await post(`/households/${doorsA[2]._id}/not-home`, 'nina', replay({ queueItemId: 'live-2', wasOfflineSubmission: 'true' }));
  assert.strictEqual(r.status, 403);
  // Held on the phone for the next sign-in, and answered before the recorder mounts anyway.
  r = await call('POST', `/mobile/households/${doorsA[2]._id}/not-home`, { orgId: ctx.orgA._id, body: replay({ queueItemId: 'no-token' }) });
  assert.strictEqual(r.status, 401);
  r = await post(`/households/${doorsA[2]._id}/not-home`, 'pat', replay({ queueItemId: 'temp-password' }));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'PASSWORD_CHANGE_REQUIRED');
  // A 5xx is retried by the phone (a malformed id fails the handler's cast).
  r = await post('/households/abc/not-home', 'cara', replay({ queueItemId: 'server-error', turfId: String(ctx.bookA._id) }));
  assert.strictEqual(r.status, 500);
  await settle();
  assert.strictEqual(await RefusedUpload.countDocuments({}), before_);
});

test('filing comes from server records only: the header is ignored, and a join across organizations files nothing', { skip }, async () => {
  const { doorsA, orgA, orgB, campA, bookB } = ctx;
  // Mona is in both organizations; her item carries org B's header, but the house is org A's.
  let r = await post(`/households/${doorsA[8]._id}/not-home`, 'mona', replay({ queueItemId: 'wrong-header' }), orgB);
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.json.code, 'HOUSEHOLD_NOT_FOUND');
  // The house in org A, the book in org B: nothing.
  r = await post(`/households/${doorsA[9]._id}/not-home`, 'nina', replay({ queueItemId: 'crossed-book', turfId: String(bookB._id) }));
  assert.strictEqual(r.json.code, 'NOT_ASSIGNED');
  // The voter in org A, its household in org B: nothing.
  r = await post(`/voters/${ctx.voterCrossed._id}/survey`, 'cara', surveyBody({ queueItemId: 'crossed-voter' }));
  assert.strictEqual(r.status, 404);
  // Nothing resolves (a pin move on a house that's gone carries no book): nothing.
  r = await post(`/households/${oid()}/location`, 'cara', pinBody({ queueItemId: 'nothing-resolves' }));
  assert.strictEqual(r.json.code, 'HOUSEHOLD_NOT_FOUND');
  await settle();

  const filed = await rowOf('mona', 'wrong-header');
  assert.deepStrictEqual([String(filed.organizationId), String(filed.campaignId)], [String(orgA._id), String(campA._id)]);
  assert.strictEqual(await RefusedUpload.countDocuments({ organizationId: orgB._id }), 0, 'never in front of org B');
  assert.strictEqual(await rowOf('nina', 'crossed-book'), null);
  assert.strictEqual(await rowOf('cara', 'crossed-voter'), null);
  assert.strictEqual(await rowOf('cara', 'nothing-resolves'), null);
});

test('a removed member with earlier work is filed in the old organization; a stranger is filed nowhere', { skip }, async () => {
  // Rex (removed, one old knock in org A) was filed in test 2. Stan has never belonged to org A or worked there.
  assert.ok((await RefusedUpload.countDocuments({ userId: ctx.u.rex._id, organizationId: ctx.orgA._id })) >= 5);
  const r = await post(`/households/${ctx.doorsA[10]._id}/not-home`, 'stan', replay({ queueItemId: 'stranger' }), ctx.orgB);
  assert.strictEqual(r.status, 404);
  await settle();
  assert.strictEqual(await RefusedUpload.countDocuments({ userId: ctx.u.stan._id }), 0);
});

test('a deleting organization or campaign gets nothing, and a write racing a deletion takes itself back out', { skip }, async () => {
  await Organization.updateOne({ _id: ctx.orgC._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
  let r = await post(`/households/${ctx.doorC._id}/not-home`, 'carl', replay({ queueItemId: 'org-deleting' }), ctx.orgC);
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.json.code, 'ORG_CONTEXT');
  await Campaign.updateOne({ _id: ctx.campDel._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
  r = await post(`/households/${ctx.delDoor._id}/not-home`, 'cara', replay({ queueItemId: 'campaign-deleting' }));
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.json.code, 'CAMPAIGN_NOT_FOUND');
  await settle();
  assert.strictEqual(await RefusedUpload.countDocuments({ organizationId: ctx.orgC._id }), 0);
  assert.strictEqual(await RefusedUpload.countDocuments({ campaignId: ctx.campDel._id }), 0);

  // The deletion is stamped between the recorder's check and its write (an old phone's item: no queue
  // item id, so a plain insert).
  const realCreate = RefusedUpload.create;
  let raced = 0;
  RefusedUpload.create = async function racingCreate(...args) {
    raced += 1;
    await Campaign.updateOne({ _id: ctx.campRace._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
    return realCreate.apply(this, args);
  };
  try {
    r = await post(`/households/${ctx.raceDoor._id}/not-home`, 'nina', replay());
    assert.strictEqual(r.status, 403);
    await settle();
  } finally {
    RefusedUpload.create = realCreate;
  }
  assert.strictEqual(raced, 1, 'the row was written…');
  assert.strictEqual(await RefusedUpload.countDocuments({ campaignId: ctx.campRace._id }), 0, '…and took itself back out');
});

test('one row per queue item: a resend after a lost response, and copies racing each other', { skip }, async () => {
  const door = ctx.doorsA[12];
  const send = (queueItemId) => post(`/households/${door._id}/wrong-address`, 'nina', replay({ queueItemId }));
  assert.strictEqual((await send('dup-seq')).status, 403);
  await settle();
  const first = await rowOf('nina', 'dup-seq');
  assert.strictEqual((await send('dup-seq')).status, 403);
  await settle();
  const rows = await RefusedUpload.find({ userId: ctx.u.nina._id, queueItemId: 'dup-seq' }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(String(rows[0]._id), String(first._id));

  const logged = await captureErrors(async () => {
    const answers = await Promise.all(Array.from({ length: 8 }, () => send('dup-race')));
    assert.ok(answers.every((a) => a.status === 403));
    await settle();
  });
  assert.strictEqual(await RefusedUpload.countDocuments({ userId: ctx.u.nina._id, queueItemId: 'dup-race' }), 1);
  assert.deepStrictEqual(logged.filter((l) => l.includes('[refused-uploads]')), [], 'a lost race is "already recorded", never a failure');
});

test('a later accepted replay of the same item closes its row (saved later), and only that row', { skip }, async () => {
  const { doorsA, campA, orgA } = ctx;
  const door = doorsA[11];
  const nh = (queueItemId, d = door) => post(`/households/${d._id}/not-home`, 'nina', replay({ queueItemId, timestamp: iso(Date.now() - 120_000) }));
  assert.strictEqual((await nh('later-1')).status, 403);
  assert.strictEqual((await nh('later-2')).status, 403);
  await settle();
  // Nina is put back on the team, and the phone resends later-1 (its first answer was lost on the way).
  const assignment = await CampaignAssignment.create({ organizationId: orgA._id, campaignId: campA._id, userId: ctx.u.nina._id });
  try {
    assert.strictEqual((await nh('later-1')).status, 201);
    // A 2xx carrying later-2 but for another door closes nothing.
    assert.strictEqual((await nh('later-2', doorsA[13])).status, 201);
    await settle();
  } finally {
    await CampaignAssignment.deleteOne({ _id: assignment._id });
  }
  const one = await rowOf('nina', 'later-1');
  const two = await rowOf('nina', 'later-2');
  assert.ok(one.savedLaterAt instanceof Date, 'later-1 saved later');
  assert.strictEqual(two.savedLaterAt, null, 'later-2 still open');

  const open = await call('GET', `/admin/campaigns/${campA._id}/refused-uploads?status=open&userId=${ctx.u.nina._id}`, as('ada'));
  assert.ok(!open.json.rows.some((x) => x.id === String(one._id)), 'out of Open');
  assert.ok(open.json.rows.some((x) => x.id === String(two._id)));
  const all = await call('GET', `/admin/campaigns/${campA._id}/refused-uploads?status=all&userId=${ctx.u.nina._id}`, as('ada'));
  assert.ok(all.json.rows.find((x) => x.id === String(one._id)).savedLaterAt, 'All says Saved later');
});

test('what a body may put in a row is kept only when sane: a 2 MB queue item id is stored as null', { skip }, async () => {
  const door = ctx.doorsA[14];
  const r = await post(`/households/${door._id}/no-soliciting`, 'nina', replay({
    queueItemId: 'q'.repeat(2_000_000), timestamp: 'not a date', turfId: 'x'.repeat(5_000), surveyTemplateId: { $ne: null },
  }));
  assert.strictEqual(r.status, 403);
  await settle();
  const row = await RefusedUpload.findOne({ userId: ctx.u.nina._id, householdId: door._id }).lean();
  assert.ok(row, 'still recorded');
  assert.deepStrictEqual([row.queueItemId, row.recordedAt, row.turfId, row.surveyTemplateId], [null, null, null, null]);
  assert.ok(JSON.stringify(row).length < 2_000, 'a small row');
});

test(`the daily cap: ${DAILY_CAP} rows per person per organization per day`, { skip }, async () => {
  // On campaign A2, so campaign A's list (capped at 500 rows itself) keeps the rows the next tests read.
  const door = ctx.doorsA2[0];
  const total = DAILY_CAP + 3;
  for (let i = 0; i < total; i += 50) {
    const batch = Array.from({ length: Math.min(50, total - i) }, () => post(`/households/${door._id}/not-home`, 'cappy', replay()));
    for (const r of await Promise.all(batch)) assert.strictEqual(r.status, 403);
    await settle();
  }
  assert.strictEqual(await RefusedUpload.countDocuments({ userId: ctx.u.cappy._id, organizationId: ctx.orgA._id }), DAILY_CAP);
  assert.ok(zonedDayStr(new Date(), 'America/Chicago'), 'counted per Central-time day');
});

test('REFUSAL_RECORDER=off turns the recorder off, read per request; the answer is the same either way', { skip }, async () => {
  const door = ctx.doorsA[12];
  process.env.REFUSAL_RECORDER = ' OFF ';
  let r;
  try {
    r = await post(`/households/${door._id}/not-home`, 'nina', replay({ queueItemId: 'switch-off' }));
    await settle();
  } finally {
    delete process.env.REFUSAL_RECORDER;
  }
  assert.deepStrictEqual([r.status, r.json.code], [403, 'NOT_ASSIGNED']);
  assert.strictEqual(await rowOf('nina', 'switch-off'), null);
  r = await post(`/households/${door._id}/not-home`, 'nina', replay({ queueItemId: 'switch-on' }));
  assert.deepStrictEqual([r.status, r.json.code], [403, 'NOT_ASSIGNED']);
  await settle();
  assert.ok(await rowOf('nina', 'switch-on'));
});

test('the list: the Audit rule (leads see their campaign only), names, houses, books and surveys, every join org-scoped', { skip }, async () => {
  const { campA, campA2, doorsA, doorsB, bookA, bookB, orgA } = ctx;
  const list = (who, campaign, qs = '', org = orgA) => call('GET', `/admin/campaigns/${campaign._id}/refused-uploads${qs}`, as(who, org));

  const lead = await list('lena', campA, '?status=all');
  assert.strictEqual(lead.status, 200);
  const byQueue = async (who, q) => {
    const id = String((await rowOf(who, q))._id);
    return lead.json.rows.find((x) => x.id === id);
  };
  const na = await byQueue('nina', 'na-1');
  assert.deepStrictEqual(
    [na.kind, na.actionType, na.signedInAs, na.address, na.book, na.code, na.reason, na.status],
    ['result', 'not_home', 'Nina T', `${doorsA[2].addressLine1}, Austin`, 'Book A', 'NOT_ASSIGNED', 'Not assigned to this campaign', 403]
  );
  assert.ok(na.recordedAt && na.refusedAt);
  assert.strictEqual((await byQueue('cara', 'sv-dnc')).survey, 'Ask');
  const gone = await byQueue('cara', 'nh-no-house');
  assert.deepStrictEqual([gone.address, gone.book], [null, 'Book A'], 'a house no longer in the campaign');
  assert.strictEqual((await byQueue('rex', 'removed-result')).signedInAs, 'Rex T', 'a removed member keeps a name');
  assert.ok(lead.json.rows.every((x) => !('answers' in x) && !('location' in x)));

  // A row pointing at another organization's house and book shows neither.
  const crafted = await RefusedUpload.create({
    organizationId: orgA._id, campaignId: campA._id, userId: ctx.u.nina._id, kind: 'result', actionType: 'not_home',
    householdId: doorsB[0]._id, turfId: bookB._id, status: 403, code: 'NOT_ASSIGNED', expiresAt: new Date(Date.now() + 86_400_000),
  });
  const again = await list('ada', campA, '?status=all');
  const c = again.json.rows.find((x) => x.id === String(crafted._id));
  assert.deepStrictEqual([c.address, c.book], [null, null]);
  await RefusedUpload.deleteOne({ _id: crafted._id });

  // Counts and filters: open + all count the same person-scope as the rows; limit caps the rows.
  const nina = await list('ada', campA, `?status=all&userId=${ctx.u.nina._id}`);
  assert.ok(nina.json.rows.length > 0 && nina.json.rows.every((x) => x.userId === String(ctx.u.nina._id)));
  assert.strictEqual(nina.json.all, await RefusedUpload.countDocuments({ campaignId: campA._id, userId: ctx.u.nina._id }));
  assert.strictEqual(nina.json.open, await RefusedUpload.countDocuments({ campaignId: campA._id, userId: ctx.u.nina._id, reviewedAt: null, savedLaterAt: null }));
  const two = await list('ada', campA, '?status=all&limit=2');
  assert.strictEqual(two.json.rows.length, 2);
  assert.ok(two.json.total > 2);
  const capped = await list('ada', campA, '?status=all&limit=100000');
  assert.ok(capped.json.rows.length <= 500, 'never more than the flag list’s cap');
  assert.ok((await list('ada', campA, '?status=bogus')).json.rows.every((x) => !x.reviewedAt && !x.savedLaterAt), 'an unknown status reads as Open');

  // Who may look.
  assert.strictEqual((await list('lena', campA2)).status, 403, 'a lead, another campaign');
  assert.strictEqual((await list('lou', campA)).status, 403, 'the other campaign’s lead');
  assert.strictEqual((await list('lou', campA2)).status, 200);
  assert.strictEqual((await list('cara', campA)).status, 403, 'a canvasser');
  assert.strictEqual((await list('bea', campA, '', ctx.orgB)).status, 404, 'another organization’s admin');
  assert.strictEqual((await list('ada', { _id: 'not-an-id' })).status, 404);
});

test('Mark reviewed and Reopen, scoped by organization and campaign; another organization can’t touch a row', { skip }, async () => {
  const { campA, campA2, campB, orgA, orgB } = ctx;
  const row = await rowOf('nina', 'na-1');
  const patch = (who, campaign, id, body, org = orgA) =>
    call('PATCH', `/admin/campaigns/${campaign._id}/refused-uploads/${id}`, { ...as(who, org), body });

  let r = await patch('lena', campA, row._id, { reviewed: true });
  assert.strictEqual(r.status, 200);
  let stored = await RefusedUpload.findById(row._id).lean();
  assert.ok(stored.reviewedAt instanceof Date);
  assert.strictEqual(String(stored.reviewedBy), String(ctx.u.lena._id));
  const reviewed = await call('GET', `/admin/campaigns/${campA._id}/refused-uploads?status=reviewed`, as('ada'));
  assert.deepStrictEqual(reviewed.json.rows.find((x) => x.id === String(row._id)).reviewedBy, { id: String(ctx.u.lena._id), name: 'Lena T' });
  const open = await call('GET', `/admin/campaigns/${campA._id}/refused-uploads`, as('ada'));
  assert.ok(!open.json.rows.some((x) => x.id === String(row._id)), 'out of Open');

  r = await patch('ada', campA, row._id, { reviewed: false });
  assert.strictEqual(r.status, 200);
  stored = await RefusedUpload.findById(row._id).lean();
  assert.deepStrictEqual([stored.reviewedAt, stored.reviewedBy], [null, null], 'reopened');

  // Another organization's admin, through their own campaign or this one: 404, and the row is untouched.
  assert.strictEqual((await patch('bea', campB, row._id, { reviewed: true }, orgB)).status, 404);
  assert.strictEqual((await patch('bea', campA, row._id, { reviewed: true }, orgB)).status, 404);
  // The row through the wrong campaign of its own organization: 404 too.
  assert.strictEqual((await patch('ada', campA2, row._id, { reviewed: true })).status, 404);
  assert.strictEqual((await patch('lou', campA, row._id, { reviewed: true })).status, 403, 'a lead of another campaign');
  assert.strictEqual((await patch('ada', campA, row._id, { reviewed: 'yes' })).status, 400);
  assert.strictEqual((await patch('ada', campA, 'nope', { reviewed: true })).status, 404);
  assert.strictEqual((await RefusedUpload.findById(row._id).lean()).reviewedAt, null);

  // A paused organization reviews nothing (requireEntitlement), like flag review.
  await Subscription.updateOne({ organizationId: orgA._id }, { $set: { status: 'suspended', statusChangedAt: new Date() } });
  try {
    r = await patch('ada', campA, row._id, { reviewed: true });
    assert.strictEqual(r.status, 402);
  } finally {
    await Subscription.updateOne({ organizationId: orgA._id }, { $set: { status: 'active' } });
  }
});

test('the section counts the campaign’s open rows only, for an admin and a lead alike', { skip }, async () => {
  const { campA, orgA } = ctx;
  const campaignOpen = await RefusedUpload.countDocuments({ campaignId: campA._id, reviewedAt: null, savedLaterAt: null });
  const orgOpen = await RefusedUpload.countDocuments({ organizationId: orgA._id, reviewedAt: null, savedLaterAt: null });
  assert.ok(orgOpen > campaignOpen && campaignOpen > 0, 'org A has open rows on more than one campaign');
  for (const who of ['ada', 'lena']) {
    const r = await call('GET', `/admin/campaigns/${campA._id}/refused-uploads`, as(who));
    assert.strictEqual(r.status, 200, who);
    assert.strictEqual(r.json.open, campaignOpen, who);
  }
});

test('both cascades remove the rows and spare another tenant’s; the indexes exist; account deletion keeps the org for the name', { skip }, async () => {
  const { orgA, orgB, campA, campB } = ctx;
  assert.ok(ORG_SCOPED.includes(RefusedUpload));

  const indexes = await RefusedUpload.collection.indexes();
  const ttl = indexes.find((i) => i.key.expiresAt === 1);
  assert.strictEqual(ttl?.expireAfterSeconds, 0, 'the 180-day TTL');
  const unique = indexes.find((i) => i.key.userId === 1 && i.key.queueItemId === 1);
  assert.strictEqual(unique?.unique, true);
  assert.deepStrictEqual(unique?.partialFilterExpression, { queueItemId: { $type: 'string' } });
  assert.ok(indexes.some((i) => i.key.organizationId === 1 && i.key.campaignId === 1 && i.key.createdAt === -1));

  const stub = (organizationId, campaignId, userId = ctx.u.nina._id) =>
    RefusedUpload.create({ organizationId, campaignId, userId, kind: 'result', status: 403, expiresAt: new Date(Date.now() + 86_400_000) });

  // The campaign cascade.
  const doomedCampaign = await Campaign.create({ organizationId: orgA._id, name: 'Throwaway', type: 'survey', state: 'TX', isActive: true });
  await stub(orgA._id, doomedCampaign._id);
  await stub(orgB._id, campB._id);
  const keptA = await RefusedUpload.countDocuments({ campaignId: campA._id });
  await deleteCampaignCascade(doomedCampaign);
  assert.strictEqual(await RefusedUpload.countDocuments({ campaignId: doomedCampaign._id }), 0);
  assert.strictEqual(await RefusedUpload.countDocuments({ campaignId: campA._id }), keptA, 'the other campaigns untouched');

  // The org cascade.
  const doomedOrg = await Organization.create({ name: 'Doomed', slug: 'ru-doomed', isActive: true });
  const doomedOrgCampaign = await Campaign.create({ organizationId: doomedOrg._id, name: 'Doomed C', type: 'survey', state: 'TX', isActive: true });
  await stub(doomedOrg._id, doomedOrgCampaign._id);
  await stub(doomedOrg._id, doomedOrgCampaign._id, ctx.u.cara._id);
  const keptB = await RefusedUpload.countDocuments({ organizationId: orgB._id });
  const keptOrgA = await RefusedUpload.countDocuments({ organizationId: orgA._id });
  await deleteOrganization(doomedOrg._id);
  assert.strictEqual(await RefusedUpload.countDocuments({ organizationId: doomedOrg._id }), 0);
  assert.strictEqual(await RefusedUpload.countDocuments({ organizationId: orgB._id }), keptB, 'another tenant’s rows survive');
  assert.strictEqual(await RefusedUpload.countDocuments({ organizationId: orgA._id }), keptOrgA);

  // Account deletion: a person whose only tie to org A is a door listed there keeps org A on the
  // deletion record, so the Audit page still shows the kept name.
  await stub(orgA._id, campA._id, ctx.u.gone._id);
  const { organizationIds } = await finishDeletion(ctx.u.gone._id, { reason: 'operator' });
  assert.deepStrictEqual(organizationIds.map(String), [String(orgA._id)]);
  assert.deepStrictEqual((await DeletedUserRecord.findOne({ userId: ctx.u.gone._id }).lean()).organizationIds.map(String), [String(orgA._id)]);
});

test('the shutdown drain waits for a record still being written, and gives up at its bound', { skip }, async () => {
  // server.js calls drainRefusalWrites(5000) inside the http server's close callback on SIGTERM. Here a
  // refused replay's book lookup is held open, so its record() is still running after the response.
  const realFindById = Turf.findById;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  Turf.findById = () => ({ lean: async () => { await gate; return null; } });
  try {
    const r = await post(`/households/${oid()}/not-home`, 'cara', replay({ turfId: String(ctx.bookA._id) }));
    assert.strictEqual(r.status, 404, 'the response never waits for the record');
    await new Promise((resolve) => setImmediate(resolve));
    let t0 = Date.now();
    assert.strictEqual(await drainRefusalWrites(150), 1, 'one record in flight');
    assert.ok(Date.now() - t0 >= 140, 'held to its bound');
    setTimeout(() => release(), 200);
    t0 = Date.now();
    assert.strictEqual(await drainRefusalWrites(5000), 1);
    const waited = Date.now() - t0;
    assert.ok(waited >= 150 && waited < 4000, `returned once the write settled (${waited} ms)`);
    assert.strictEqual(await drainRefusalWrites(5000), 0, 'nothing left in flight');
  } finally {
    release();
    Turf.findById = realFindById;
  }
});

test('crash safety: a throwing matcher, a throwing capture, a throw before the first await, a rejection that isn’t an Error', { skip }, async () => {
  const problems = [];
  const onRejection = (reason) => problems.push(['unhandledRejection', reason]);
  const onException = (err) => problems.push(['uncaughtException', err]);
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  try {
    // A harness with the recorder's real neighbours (compression, express.json, accessLog wrapping
    // res.json after it, errorHandler) and three ways to break it from outside.
    let inject = {};
    const app = express();
    app.use(compression());
    app.use(express.json({ limit: '2mb' }));
    const r = express.Router();
    r.use((req, res, next) => {
      req.user = { _id: ctx.u.cara._id };
      next();
    });
    r.use('/mobile', (req, res, next) => (inject.before ? inject.before(req, res, next) : next()));
    r.use('/mobile', refusalRecorder);
    r.use('/mobile', (req, res, next) => (inject.after ? inject.after(req, res, next) : next()));
    r.use('/mobile', accessLog);
    r.post('/mobile/households/:id/not-home', (req, res) =>
      res.status(403).json(inject.body ? inject.body() : { error: 'Not assigned to this campaign', code: 'NOT_ASSIGNED' })
    );
    app.use('/api', r);
    app.use(errorHandler);
    const harness = http.createServer(app);
    await new Promise((res) => harness.listen(0, '127.0.0.1', res));
    const at = `http://127.0.0.1:${harness.address().port}/api/mobile/households/${oid()}/not-home`;
    // Compared as { status, error, code } on purpose: a regression answers errorHandler's 500, whose body
    // carries a stack outside production, and Node 20's failure report on a deepStrictEqual of a long
    // multi-line string spins instead of failing (seen while mutation-testing this suite).
    const hit = async () => {
      const res = await fetch(at, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replay()) });
      const json = await res.json();
      return { status: res.status, error: json?.error, code: json?.code };
    };
    const EXPECTED = { status: 403, error: 'Not assigned to this campaign', code: 'NOT_ASSIGNED' };
    try {
      assert.deepStrictEqual(await hit(), EXPECTED, 'baseline');

      // The matcher throws (its req.path read).
      inject = {
        before: (req, res, next) => {
          Object.defineProperty(req, 'path', { configurable: true, get() { throw new Error('matcher bug'); } });
          next();
        },
        after: (req, res, next) => {
          delete req.path;
          next();
        },
      };
      assert.deepStrictEqual(await hit(), EXPECTED, 'a throwing matcher');

      // The capture throws; the response is still the handler's. The body's code is read first by
      // accessLog's row count (its res.json wrapper is the outer one), then by the recorder's capture —
      // the read that throws — then by JSON.stringify.
      let captureThrew = false;
      inject = {
        body: () => {
          let reads = 0;
          return {
            error: 'Not assigned to this campaign',
            get code() {
              reads += 1;
              if (reads === 2) {
                captureThrew = true;
                throw new Error('capture bug');
              }
              return 'NOT_ASSIGNED';
            },
          };
        },
      };
      assert.deepStrictEqual(await hit(), EXPECTED, 'a throwing capture');
      assert.ok(captureThrew, 'the capture really threw');
      await settle();

      // record() throws before its first await (its req.body read, at finish).
      inject = {
        after: (req, res, next) => {
          Object.defineProperty(req, 'body', { configurable: true, get() { throw new Error('boom before the first await'); } });
          next();
        },
      };
      const logged = await captureErrors(async () => {
        assert.deepStrictEqual(await hit(), EXPECTED, 'a throw before the first await');
        await settle();
      });
      assert.ok(logged.some((l) => l.includes('[refused-uploads] record failed:') && l.includes('boom before the first await')), logged.join('\n'));
    } finally {
      harness.closeAllConnections();
      await new Promise((res) => harness.close(res));
    }

    // Rejections that aren't Errors, through the REAL app: a refused replay of a house that's gone, filed
    // by its book, whose lookup rejects with each of these.
    const realFindById = Turf.findById;
    const strange = [undefined, null, 'boom', Object.create(null), { get message() { throw new Error('getter'); } }];
    const send = async () => {
      const r2 = await post(`/households/${oid()}/not-home`, 'cara', replay({ turfId: String(ctx.bookA._id) }));
      return { status: r2.status, error: r2.json?.error, code: r2.json?.code };
    };
    const baseline = await send();
    assert.deepStrictEqual(baseline, { status: 404, error: 'Household not found', code: 'HOUSEHOLD_NOT_FOUND' });
    await settle();
    for (const reason of strange) {
      Turf.findById = () => ({ lean: () => Promise.reject(reason) });
      try {
        const got = await send();
        assert.deepStrictEqual(got, baseline, `the response is unchanged (${inspect(reason)})`);
        await settle();
      } finally {
        Turf.findById = realFindById;
      }
    }
    await new Promise((res) => setTimeout(res, 50));
    // Still up, and still recording.
    const after_ = await post(`/households/${ctx.doorsA[12]._id}/not-home`, 'nina', replay({ queueItemId: 'still-up' }));
    assert.strictEqual(after_.status, 403);
    await settle();
    assert.ok(await rowOf('nina', 'still-up'));
  } finally {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  }
  assert.deepStrictEqual(problems, []);
});
