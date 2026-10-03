import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Opt-in door outcomes (Campaign.enabledOutcomes — docs/PROPOSAL_NOT_TARGET_OUTCOME.md §B) over the
// REAL Express app + throwaway mongod:
//   npm run test:int -- test/optInOutcomes.int.test.js
//
// The invariants this file exists to protect:
//   • OFF unless an org admin turns it on. Every campaign is born off — a POST carrying the key
//     still creates it off — a legacy document with no field reads off, and a lead's PATCH is a 403.
//   • Only what Doorline has RELEASED can be turned on (the OPT_IN_OUTCOMES config var, read at call
//     time, so each test sets it). Withdrawing never blocks turning it OFF, nor re-saving it as on.
//   • Survey campaigns only, and a campaign leaving the survey type sheds it — audited.
//   • everEnabledOutcomes only grows: it is the record the replay rule reads.
//   • Every switch is a History row naming who did it.
//   • Recording: a fresh tap is refused unless the outcome is on right now (OUTCOME_DISABLED, nothing
//     written); a queued replay is honored only on a campaign that has had it on at some point.
//   • The phone gets the EFFECTIVE list (on ∩ released ∩ survey) on the bootstrap, and the door
//     settings again on /mobile/changes only when its stamp is stale.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-opt-in-outcomes';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { isOutcomeEnabled, doorConfigStamp } = await import('../src/services/canvass/outcomeToggles.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const SAVED_RELEASE = process.env.OPT_IN_OUTCOMES;
const release = () => {
  process.env.OPT_IN_OUTCOMES = 'not_target';
};
const withdraw = () => {
  delete process.env.OPT_IN_OUTCOMES;
};

const makeHousehold = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Opt-in Way`,
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  normalizedAddress: `${n} opt-in way austin tx 78701`,
  location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
  status: 'unknocked',
  isActive: true,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager, CampaignChange, Subscription, Effort, Pass, Household, CanvassActivity]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Opt-in Org', slug: 'opt-in-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'oia@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'oil@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'oic@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const survey = await Campaign.create({
    organizationId: org._id, name: 'Opt-in Survey', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });
  const litDrop = await Campaign.create({
    organizationId: org._id, name: 'Opt-in Lit', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });
  // Uncanvassed, so the type lock lets it flip to lit-drop in the type-change test. Its doors don't
  // trip the lock (it reads knocks); a recording test replays a tap on one after the flip.
  const flipper = await Campaign.create({
    organizationId: org._id, name: 'Opt-in Flipper', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });
  // A document from before the feature: neither field exists.
  const legacy = await Campaign.create({
    organizationId: org._id, name: 'Opt-in Legacy', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });
  await Campaign.collection.updateOne({ _id: legacy._id }, { $unset: { enabledOutcomes: '', everEnabledOutcomes: '' } });
  // Turned on in the recording tests, by the real PATCH.
  const live = await Campaign.create({
    organizationId: org._id, name: 'Opt-in Live', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });

  // Doors to knock: an active round on every campaign the recording tests write to.
  const doors = {};
  let n = 0;
  for (const [key, c] of Object.entries({ survey, litDrop, legacy, live, flipper })) {
    const effort = await Effort.create({ organizationId: org._id, campaignId: c._id, name: 'Intake' });
    await Pass.create({
      organizationId: org._id, campaignId: c._id, effortId: effort._id,
      roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
    });
    doors[key] = await Household.insertMany([1, 2, 3].map(() => makeHousehold(org._id, c._id, effort._id, ++n)));
  }

  for (const c of [survey, litDrop, flipper, legacy, live]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: c._id, userId: canv._id });
    await CampaignManager.create({ organizationId: org._id, campaignId: c._id, userId: lead._id, isActive: true });
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, survey, litDrop, flipper, legacy, live, doors,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (SAVED_RELEASE === undefined) delete process.env.OPT_IN_OUTCOMES;
  else process.env.OPT_IN_OUTCOMES = SAVED_RELEASE;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

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
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const patch = (campaign, body, who = asAdmin()) => call('PATCH', `/admin/campaigns/${campaign._id}`, { ...who, body });
const stored = (campaign) => Campaign.findById(campaign._id, { enabledOutcomes: 1, everEnabledOutcomes: 1, type: 1 }).lean();
const auditRows = (campaign) => CampaignChange.find({ campaignId: campaign._id, field: 'enabledOutcomes' }).sort({ createdAt: 1, _id: 1 }).lean();
const asCanvasser = () => ({ token: ctx.canvTok, orgId: ctx.org._id });
const knock = (door, path, extra = {}) =>
  call('POST', `/mobile/households/${door._id}/${path}`, {
    ...asCanvasser(),
    body: { location: { lat: 30.26, lng: -97.74, accuracy: 5 }, ...extra },
  });
const replay = { wasOfflineSubmission: true };
const rowsAt = (door) => CanvassActivity.find({ householdId: door._id }).lean();
const bootstrapOf = async (campaign) => {
  const r = await call('GET', `/mobile/bootstrap?campaignId=${campaign._id}`, asCanvasser());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.campaign;
};
const changesOf = (campaign, stamp) =>
  call(
    'GET',
    `/mobile/changes?campaignId=${campaign._id}&since=${encodeURIComponent(new Date().toISOString())}` +
      (stamp === undefined ? '' : `&doorConfigStamp=${encodeURIComponent(stamp)}`),
    asCanvasser()
  );
const listRow = async (campaign) => {
  const list = await call('GET', '/admin/campaigns', asAdmin());
  assert.equal(list.status, 200, JSON.stringify(list.json));
  return { list: list.json, row: list.json.campaigns.find((c) => String(c._id) === String(campaign._id)) };
};

test('unreleased: the list offers nothing and a PATCH turning it on is refused, writing nothing', { skip }, async () => {
  withdraw();
  const { list } = await listRow(ctx.survey);
  assert.deepEqual(list.optInOutcomesAvailable, [], 'no released opt-in outcomes');

  const r = await patch(ctx.survey, { enabledOutcomes: ['not_target'] });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'OUTCOME_NOT_AVAILABLE', JSON.stringify(r.json));
  assert.deepEqual((await stored(ctx.survey)).enabledOutcomes, []);
  assert.equal((await auditRows(ctx.survey)).length, 0, 'a refused PATCH logs nothing');
});

test('released: off by default, on a fresh campaign and on a legacy document with no field', { skip }, async () => {
  release();
  const { list, row } = await listRow(ctx.survey);
  assert.deepEqual(list.optInOutcomesAvailable, ['not_target'], 'the config var is read at call time');
  assert.deepEqual(row.enabledOutcomes, []);
  assert.equal(isOutcomeEnabled(row, 'not_target', list.optInOutcomesAvailable), false);

  const { row: legacyRow } = await listRow(ctx.legacy);
  assert.equal(legacyRow.enabledOutcomes, undefined, 'the legacy fixture really has no field');
  assert.equal(isOutcomeEnabled(legacyRow, 'not_target', list.optInOutcomesAvailable), false, 'missing reads off');
});

test('a POST carrying enabledOutcomes still creates the campaign OFF, with no History row', { skip }, async () => {
  release();
  const r = await call('POST', '/admin/campaigns', {
    ...asAdmin(), body: { name: 'Born Off', type: 'survey', state: 'TX', enabledOutcomes: ['not_target'] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const doc = await Campaign.findById(r.json.campaign._id).lean();
  assert.deepEqual(doc.enabledOutcomes, [], 'the create schema strips the key');
  assert.deepEqual(doc.everEnabledOutcomes, []);
  assert.equal(await CampaignChange.countDocuments({ campaignId: doc._id }), 0);
  await Campaign.deleteOne({ _id: doc._id });
});

test("a lead's PATCH is refused with words, before anything is written — on or off", { skip }, async () => {
  release();
  for (const enabledOutcomes of [['not_target'], []]) {
    const r = await patch(ctx.survey, { enabledOutcomes }, asLead());
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.error, 'Only an org admin can turn off-by-default outcomes on or off.');
  }
  // The refusal is about this key only: the same lead still edits the deny-list (2026-08-16 ruling).
  const ok = await patch(ctx.survey, { disabledOutcomes: [] }, asLead());
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual((await stored(ctx.survey)).enabledOutcomes, []);
  assert.equal((await auditRows(ctx.survey)).length, 0);
});

test('junk is rejected: a toggleable key, an unknown key, and not_target in the deny-list', { skip }, async () => {
  release();
  for (const bad of [['refused'], ['door_slammed']]) {
    const r = await patch(ctx.survey, { enabledOutcomes: bad });
    assert.equal(r.status, 400, `'${bad}' must be rejected`);
  }
  // The deny-list's enum is the toggleable class — an opt-in outcome there would read ON on every [].
  const deny = await patch(ctx.survey, { disabledOutcomes: ['not_target'] });
  assert.equal(deny.status, 400);
});

test('an org admin turns it on: stored deduped, everEnabled grows, one History row naming the admin', { skip }, async () => {
  release();
  const r = await patch(ctx.survey, { enabledOutcomes: ['not_target', 'not_target'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const doc = await stored(ctx.survey);
  assert.deepEqual(doc.enabledOutcomes, ['not_target']);
  assert.deepEqual(doc.everEnabledOutcomes, ['not_target']);

  const rows = await auditRows(ctx.survey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromValue, null, 'off normalizes to null');
  assert.equal(rows[0].toValue, 'not_target');
  assert.equal(String(rows[0].byUserId), String(ctx.admin._id));

  const history = await call('GET', `/admin/campaigns/${ctx.survey._id}/history`, asAdmin());
  assert.equal(history.status, 200, JSON.stringify(history.json));
  const item = history.json.items.find((i) => i.field === 'enabledOutcomes');
  assert.equal(item.by.name, 'Ada Admin', 'the History feed names who switched it on');

  const { row } = await listRow(ctx.survey);
  assert.deepEqual(row.enabledOutcomes, ['not_target'], 'the list row carries the setting');
  assert.deepEqual(row.everEnabledOutcomes, ['not_target']);
});

test('re-saving the same value is a no-op: no phantom History row', { skip }, async () => {
  release();
  const r = await patch(ctx.survey, { enabledOutcomes: ['not_target'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await auditRows(ctx.survey)).length, 1);
});

test('survey campaigns only: a lit-drop PATCH, and a PATCH flipping the type in the same body, are refused', { skip }, async () => {
  release();
  const lit = await patch(ctx.litDrop, { enabledOutcomes: ['not_target'] });
  assert.equal(lit.status, 400);
  assert.equal(lit.json.code, 'OUTCOME_SURVEY_ONLY', JSON.stringify(lit.json));
  assert.deepEqual((await stored(ctx.litDrop)).enabledOutcomes, []);

  const both = await patch(ctx.flipper, { type: 'lit_drop', enabledOutcomes: ['not_target'] });
  assert.equal(both.status, 400, 'checked against the MERGED type');
  assert.equal(both.json.code, 'OUTCOME_SURVEY_ONLY');
  assert.equal((await stored(ctx.flipper)).type, 'survey', 'and nothing else in the body landed');
});

test('a survey → lit-drop type change sheds the outcome, as an audited change; everEnabled keeps it', { skip }, async () => {
  release();
  const on = await patch(ctx.flipper, { enabledOutcomes: ['not_target'] });
  assert.equal(on.status, 200, JSON.stringify(on.json));

  const r = await patch(ctx.flipper, { type: 'lit_drop' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const doc = await stored(ctx.flipper);
  assert.equal(doc.type, 'lit_drop');
  assert.deepEqual(doc.enabledOutcomes, []);
  assert.deepEqual(doc.everEnabledOutcomes, ['not_target']);

  const rows = await auditRows(ctx.flipper);
  assert.deepEqual(rows.map((x) => [x.fromValue, x.toValue]), [[null, 'not_target'], ['not_target', null]]);
  assert.equal(await CampaignChange.countDocuments({ campaignId: ctx.flipper._id, field: 'type' }), 1);
});

test('turning it off keeps everEnabledOutcomes, and logs the switch-off', { skip }, async () => {
  release();
  const r = await patch(ctx.survey, { enabledOutcomes: [] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const doc = await stored(ctx.survey);
  assert.deepEqual(doc.enabledOutcomes, []);
  assert.deepEqual(doc.everEnabledOutcomes, ['not_target'], 'never shrinks — the replay rule reads it');
  const rows = await auditRows(ctx.survey);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].fromValue, 'not_target');
  assert.equal(rows[1].toValue, null);
});

test('withdrawn: a campaign still set on can re-save it and turn it off, but nothing new turns on', { skip }, async () => {
  release();
  assert.equal((await patch(ctx.survey, { enabledOutcomes: ['not_target'] })).status, 200);
  withdraw();

  // App Customization may send the whole form: a withdrawal must not block saving it.
  const resave = await patch(ctx.survey, { enabledOutcomes: ['not_target'], doorAddPolicy: 'all' });
  assert.equal(resave.status, 200, `re-saving an already-on outcome is not turning it on: ${JSON.stringify(resave.json)}`);

  // The "Paused by Doorline" turn-off.
  const off = await patch(ctx.survey, { enabledOutcomes: [] });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.deepEqual((await stored(ctx.survey)).enabledOutcomes, []);

  const again = await patch(ctx.survey, { enabledOutcomes: ['not_target'] });
  assert.equal(again.status, 400);
  assert.equal(again.json.code, 'OUTCOME_NOT_AVAILABLE');
  assert.deepEqual((await stored(ctx.survey)).everEnabledOutcomes, ['not_target']);
});

// --- Recording ----------------------------------------------------------------------------------

test('a fresh tap is refused while it is off — in the canvasser words, writing nothing', { skip }, async () => {
  release();
  const door = ctx.doors.legacy[0];
  const r = await knock(door, 'not-target');
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'OUTCOME_DISABLED', JSON.stringify(r.json));
  assert.match(r.json.error, /^"Not a target voter" is turned off for this campaign/, 'the label, never the slug');
  assert.equal((await rowsAt(door)).length, 0);
  assert.equal((await Household.findById(door._id).lean()).status, 'unknocked');
});

test('a replay on a campaign that NEVER had it on is refused: no phone ever showed the button', { skip }, async () => {
  release();
  const door = ctx.doors.legacy[0];
  const r = await knock(door, 'not-target', { ...replay, timestamp: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.code, 'OUTCOME_DISABLED');
  assert.equal((await rowsAt(door)).length, 0);
});

test('survey campaigns only: the route refuses a lit-drop door before the gate', { skip }, async () => {
  release();
  const r = await knock(ctx.doors.litDrop[0], 'not-target');
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'Action not valid for campaign type "lit_drop".', 'the type check, not OUTCOME_DISABLED');
  assert.equal((await rowsAt(ctx.doors.litDrop[0])).length, 0);
});

test('flipped to lit-drop after it was on: the gate would honor a queued replay, the type check refuses it', { skip }, async () => {
  release();
  // ctx.flipper had it on as a survey campaign until the type-change test above flipped it to
  // lit-drop. everEnabledOutcomes remembers, so the replay rule lets this queued tap past the gate:
  // only the route's type check keeps it from replacing a canvasser's lit_dropped at the door.
  const doc = await stored(ctx.flipper);
  assert.equal(doc.type, 'lit_drop');
  assert.deepEqual(doc.enabledOutcomes, []);
  assert.deepEqual(doc.everEnabledOutcomes, ['not_target']);

  const door = ctx.doors.flipper[0];
  const r = await knock(door, 'not-target', { ...replay, timestamp: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'Action not valid for campaign type "lit_drop".');
  assert.equal((await rowsAt(door)).length, 0);
  assert.equal((await Household.findById(door._id).lean()).status, 'unknocked');
});

test('flipped to lit-drop after it was on: nothing reads it as in use, so its per-round file keeps its shape', { skip }, async () => {
  // everEnabledOutcomes still remembers (above), but a lit-drop campaign can never record the outcome.
  // knocksByPass loads the campaign NARROWED, so it must load `type` for outcomeInUse to say no — the
  // flag the per-round CSV and the Export Center's knocks-by-round file both read for their column.
  assert.deepEqual((await stored(ctx.flipper)).everEnabledOutcomes, ['not_target']);
  const r = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.flipper._id}`, asAdmin());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.notTargetInUse, false);
});

test('on: one tap records a knock row and the door reads Not a target voter on both wires', { skip }, async () => {
  release();
  assert.equal((await patch(ctx.live, { enabledOutcomes: ['not_target'] })).status, 200);
  const door = ctx.doors.live[0];

  const noGps = await call('POST', `/mobile/households/${door._id}/not-target`, { ...asCanvasser(), body: {} });
  assert.equal(noGps.status, 400, 'location is required, as for every disposition');
  assert.equal(noGps.json.code, 'LOCATION_REQUIRED', JSON.stringify(noGps.json));

  const r = await knock(door, 'not-target', { note: 'Spoke to the tenant, Sam; would not give a last name.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.household.status, 'not_target', 'the per-round action-response wire');
  const rows = await rowsAt(door);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actionType, 'not_target');
  assert.equal(rows[0].voterId ?? null, null, 'door-level: no voter');
  assert.equal(rows[0].note, 'Spoke to the tenant, Sam; would not give a last name.');
  assert.equal((await Household.findById(door._id).lean()).status, 'not_target');
});

test('latest wins inside the round: a later tap replaces it, and it replaces an earlier one', { skip }, async () => {
  release();
  const door = ctx.doors.live[0];
  const nh = await knock(door, 'not-home');
  assert.equal(nh.status, 201, JSON.stringify(nh.json));
  let rows = await rowsAt(door);
  assert.deepEqual(rows.map((x) => x.actionType), ['not_home'], 'one row per canvasser, door and round');

  const nt = await knock(door, 'not-target');
  assert.equal(nt.status, 201, JSON.stringify(nt.json));
  rows = await rowsAt(door);
  assert.deepEqual(rows.map((x) => x.actionType), ['not_target']);
  assert.equal((await Household.findById(door._id).lean()).status, 'not_target');
});

test('switched off after use: a fresh tap is refused, a queued replay is honored', { skip }, async () => {
  release();
  // ctx.survey was turned on and off by the settings tests above — everEnabledOutcomes remembers.
  const doc = await stored(ctx.survey);
  assert.deepEqual(doc.enabledOutcomes, []);
  assert.deepEqual(doc.everEnabledOutcomes, ['not_target']);

  const fresh = await knock(ctx.doors.survey[0], 'not-target');
  assert.equal(fresh.status, 400);
  assert.equal(fresh.json.code, 'OUTCOME_DISABLED');

  const queued = await knock(ctx.doors.survey[1], 'not-target', { ...replay, timestamp: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(queued.status, 201, `a tap queued while it was on must never be dropped: ${JSON.stringify(queued.json)}`);
  const rows = await rowsAt(ctx.doors.survey[1]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wasOfflineSubmission, true);
});

test('withdrawn by Doorline: fresh taps refused, queued replays honored, the setting kept', { skip }, async () => {
  withdraw();
  const fresh = await knock(ctx.doors.live[1], 'not-target');
  assert.equal(fresh.status, 400);
  assert.equal(fresh.json.code, 'OUTCOME_DISABLED');

  const queued = await knock(ctx.doors.live[2], 'not-target', { ...replay, timestamp: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(queued.status, 201, JSON.stringify(queued.json));
  assert.deepEqual((await stored(ctx.live)).enabledOutcomes, ['not_target'], 'a withdrawal never edits a campaign');
});

// --- The phone wires ----------------------------------------------------------------------------

test('the bootstrap carries the EFFECTIVE list and the stamp — on, withdrawn, off and lit-drop', { skip }, async () => {
  release();
  let camp = await bootstrapOf(ctx.live);
  assert.deepEqual(camp.enabledOutcomes, ['not_target']);
  assert.equal(camp.doorConfigStamp, doorConfigStamp(await Campaign.findById(ctx.live._id).lean(), ['not_target']));
  assert.deepEqual(camp.disabledOutcomes, [], 'the door settings it already carried are still there');
  assert.equal(camp.doorAddPolicy, 'all');
  assert.equal(camp.canAddVoters, true);

  withdraw();
  camp = await bootstrapOf(ctx.live);
  assert.deepEqual(camp.enabledOutcomes, [], 'withdrawn: no phone shows the button');

  release();
  assert.deepEqual((await bootstrapOf(ctx.survey)).enabledOutcomes, [], 'switched off');
  assert.deepEqual((await bootstrapOf(ctx.legacy)).enabledOutcomes, [], 'a legacy document with no field');
  assert.deepEqual((await bootstrapOf(ctx.litDrop)).enabledOutcomes, []);
});

test('/mobile/changes sends the door settings only when the phone stamp is stale', { skip }, async () => {
  release();
  // Two outcomes switched off put a comma in the stamp beside its pipes — both characters the
  // phone has to encode, so the round trip below proves both.
  assert.equal((await patch(ctx.live, { disabledOutcomes: ['refused', 'wrong_address'] })).status, 200);
  const camp = await bootstrapOf(ctx.live);
  assert.match(camp.doorConfigStamp, /\|/, 'the real stamp contains a pipe — the encoded form is the one under test');
  assert.match(camp.doorConfigStamp, /,/, 'and a comma');

  const same = await changesOf(ctx.live, camp.doorConfigStamp);
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(same.json.doorConfig, undefined, 'an encoded stamp must read back equal');

  const none = await changesOf(ctx.live);
  assert.equal(none.status, 200);
  assert.equal(none.json.doorConfig, undefined, 'an older bundle sends no stamp and gets nothing new');

  // An admin switches it off: the next poll carries exactly what a fresh bootstrap would.
  assert.equal((await patch(ctx.live, { enabledOutcomes: [] })).status, 200);
  const stale = await changesOf(ctx.live, camp.doorConfigStamp);
  assert.equal(stale.status, 200, JSON.stringify(stale.json));
  const fresh = await bootstrapOf(ctx.live);
  const { disabledOutcomes, enabledOutcomes, doorAddPolicy, canAddVoters, doorConfigStamp: stamp } = fresh;
  assert.deepEqual(stale.json.doorConfig, { disabledOutcomes, enabledOutcomes, doorAddPolicy, canAddVoters, doorConfigStamp: stamp });
  assert.deepEqual(stale.json.doorConfig.enabledOutcomes, []);

  const caughtUp = await changesOf(ctx.live, stale.json.doorConfig.doorConfigStamp);
  assert.equal(caughtUp.json.doorConfig, undefined, 'and the poll after that is quiet again');
});
