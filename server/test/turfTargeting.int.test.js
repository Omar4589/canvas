import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Target doors on a RE-CUT, end to end, over the real app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/turf_targeting node --test test/turfTargeting.int.test.js
//
// The mid-day list swap that found the gaps (2026-10-13): doors knocked under walk list A, the
// client's updated file imported, a CSV saved search, a new walk list B, "Move them here", then
// Target doors on B round 1. Pinned here:
//   1. the move keeps every knock on A's round — B round 1 draws every dot Unknocked, and the page
//      gets each door's all-rounds TARGETING status (`targetStatus`) beside it;
//   2. a status tick reads the targeting ladder (utils/statusPrecedence.js) over the door's whole
//      history: Restricted wins in any order, then a survey, then an answered outcome (newest),
//      then Not home when nobody ever answered;
//   3. with every status ticked and every box off, every drawn door is in the cut — the three
//      boxes are the only status-independent exclusions, the restricted / no-soliciting boxes
//      read the same ladder (a mark the crew knocked through, or one made in the OLD walk list's
//      other round, stays out), and the preview NAMES what each removed (`leftOut`) and what
//      Exclude doors removed (`excludedHouseholdIds`);
//   4. a survey-answer target on a walk list with a survey OVERRIDE matches that survey's
//      answers (it matched nothing before);
//   5. preview == cut: the doors the preview keeps are exactly the doors generateTurf books;
//   6. an excluded door a box would also drop is still named as the Exclude panel's;
//   7. the two ways back — Unmark (a desk mark) and Unknock (any entry) — put the door back,
//      through the real routes and service;
//   8. the ladder in the database (targetingIdsMatching) agrees door for door with the ladder
//      in JS (getTargetingStatusMap), for every status.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-turf-targeting';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.TURF_ENQUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { executeClaim } = await import('../src/services/walklist/claimDoors.js');
const { resolveWalkList } = await import('../src/services/walklist/resolveWalkList.js');
const { generateTurf } = await import('../src/services/turf/generateTurf.js');
const { recomputeHouseholdStatusesBatched } = await import('../src/services/canvass/status.js');
const { runUnknock } = await import('../src/services/canvass/unknock.js');
const { getTargetingStatusMap, targetingIdsMatching } = await import('../src/services/walklist/targetingStatus.js');
const { closeQueues } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const doors = {}; // label -> Household doc

const T0 = new Date('2026-10-13T14:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);
const q = (key) => ({
  key, label: 'Support?', type: 'single_choice', order: 0,
  options: [{ id: 'opt_yes', text: 'Yes', order: 0 }, { id: 'opt_no', text: 'No', order: 1 }],
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Pass, Turf, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, SavedSearch, Subscription]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Targeting Org', slug: 'targeting-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'tta@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'ttc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  // The campaign's default survey, and the client's survey both walk lists override with.
  const tDefault = await SurveyTemplate.create({ organizationId: org._id, name: 'Campaign default', version: 1, questions: [q('support')] });
  const tClient = await SurveyTemplate.create({ organizationId: org._id, name: 'Client survey', version: 1, questions: [q('support')] });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Targeting C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
    surveyTemplateId: tDefault._id,
  });
  const effortA = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Old list', surveyTemplateId: tClient._id });
  const effortB = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'New list', surveyTemplateId: tClient._id });
  const passA1 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effortA._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const passA2 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effortA._id, roundNumber: 2, name: 'Round 2', status: 'draft' });
  const passB1 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effortB._id, roundNumber: 1, name: 'Round 1', status: 'draft' });

  let n = 0;
  const mk = async (label, effortId, extra = {}) => {
    n += 1;
    const d = await Household.create({
      organizationId: org._id, campaignId: camp._id, effortId,
      addressLine1: `${n} Targeting St`, city: 'Naples', state: 'FL', zipCode: '34102',
      normalizedAddress: `${n} TARGETING ST|NAPLES|FL|34102`,
      location: { type: 'Point', coordinates: [-81.79 + n * 0.002, 26.14 + (n % 5) * 0.002] },
      isActive: true, status: 'unknocked', ...extra,
    });
    doors[label] = d;
    return d;
  };
  const act = (d, actionType, min, { pass = passA1, via = null, user = canv } = {}) =>
    CanvassActivity.create({
      organizationId: org._id, campaignId: camp._id, householdId: d._id, userId: user._id, actionType,
      location: { lat: d.location.coordinates[1], lng: d.location.coordinates[0] }, timestamp: at(min),
      passId: pass._id, effortId: pass.effortId, turfId: null, via,
    });

  // ── Knocked this morning under walk list A, round 1 (minute = order) ──
  await mk('not_home', effortA._id);                       await act(doors.not_home, 'not_home', 1);
  await mk('surveyed', effortA._id);                       await act(doors.surveyed, 'survey_submitted', 2);
  await mk('refused', effortA._id);                        await act(doors.refused, 'refused', 3);
  await mk('wrong_address', effortA._id);                  await act(doors.wrong_address, 'wrong_address', 4);
  await mk('no_soliciting', effortA._id);                  await act(doors.no_soliciting, 'no_soliciting', 5);
  await mk('restricted_field', effortA._id);               await act(doors.restricted_field, 'restricted', 6);
  await mk('restricted_desk', effortA._id);                await act(doors.restricted_desk, 'restricted', 7, { via: 'bulk', user: admin });
  await mk('surveyed_then_not_home', effortA._id);         await act(doors.surveyed_then_not_home, 'survey_submitted', 8); await act(doors.surveyed_then_not_home, 'not_home', 9);
  await mk('not_home_then_refused', effortA._id);          await act(doors.not_home_then_refused, 'not_home', 10); await act(doors.not_home_then_refused, 'refused', 11);
  await mk('refused_then_not_home', effortA._id);          await act(doors.refused_then_not_home, 'refused', 12); await act(doors.refused_then_not_home, 'not_home', 13);
  await mk('not_home_then_wrong_address', effortA._id);    await act(doors.not_home_then_wrong_address, 'not_home', 14); await act(doors.not_home_then_wrong_address, 'wrong_address', 15);
  await mk('desk_restricted_then_not_home', effortA._id);  await act(doors.desk_restricted_then_not_home, 'restricted', 16, { via: 'bulk', user: admin }); await act(doors.desk_restricted_then_not_home, 'not_home', 17);
  await mk('not_home_then_desk_restricted', effortA._id);  await act(doors.not_home_then_desk_restricted, 'not_home', 18); await act(doors.not_home_then_desk_restricted, 'restricted', 19, { via: 'bulk', user: admin });
  await mk('not_home_far_pin', effortA._id, { pinSuspect: 'far' });                 await act(doors.not_home_far_pin, 'not_home', 20);
  await mk('unknocked_placeholder_pin', effortA._id, { pinSuspect: 'placeholder' });
  await mk('not_home_far_pin_confirmed', effortA._id, { pinSuspect: 'far', locationConfirmedAt: at(0), locationConfirmedBy: admin._id }); await act(doors.not_home_far_pin_confirmed, 'not_home', 21);
  await mk('unknocked', effortA._id);
  await mk('not_home_fully_dnc', effortA._id, { fullyDnc: true });                  await act(doors.not_home_fully_dnc, 'not_home', 22);
  await mk('surveyed_A1_desk_restricted_A2', effortA._id); await act(doors.surveyed_A1_desk_restricted_A2, 'survey_submitted', 23); await act(doors.surveyed_A1_desk_restricted_A2, 'restricted', 24, { pass: passA2, via: 'bulk', user: admin });
  // ── New addresses from the updated file: Intake, never knocked ──
  await mk('new_address_intake_1', null);
  await mk('new_address_intake_2', null);

  // Global Household.status exactly as the knock path leaves it (coverage / Map rule).
  await recomputeHouseholdStatusesBatched(Object.values(doors).map((d) => d._id), 'survey');

  // The surveys behind the two surveyed doors were taken under A's effective survey — the CLIENT
  // survey (the override), never the campaign default.
  let seq = 0;
  const voter = (h) => Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: h._id, stateVoterId: `TT${++seq}`,
    firstName: `V${seq}`, lastName: 'Test', fullName: `V${seq} Test`,
  });
  const respond = (v, h, optId, text) => SurveyResponse.create({
    organizationId: org._id, campaignId: camp._id, effortId: effortA._id, passId: passA1._id,
    householdId: h._id, voterId: v._id, userId: canv._id, surveyTemplateId: tClient._id, surveyTemplateVersion: 1,
    location: { lat: 26.14, lng: -81.79 }, submittedAt: at(2), answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: text, optionIds: [optId] }],
  });
  await respond(await voter(doors.surveyed), doors.surveyed, 'opt_yes', 'Yes');
  await respond(await voter(doors.surveyed_then_not_home), doors.surveyed_then_not_home, 'opt_no', 'No');

  // One published book on A1 holding every A door (the live round, mid-day).
  const aIds = Object.values(doors).filter((d) => d.effortId).map((d) => d._id);
  const book = await Turf.create({ organizationId: org._id, campaignId: camp._id, passId: passA1._id, name: 'Book 1', mode: 'geometric', householdIds: aIds, doorCount: aIds.length, status: 'published' });
  await Household.updateMany({ _id: { $in: aIds } }, { $set: { turfId: book._id } });

  // The CSV saved search (built AFTER the import): the updated list's voter IDs resolve to these doors.
  const search = await SavedSearch.create({ organizationId: org._id, campaignId: camp._id, name: 'Updated list', createdBy: admin._id, source: 'csv', householdIds: Object.values(doors).map((d) => d._id) });
  // "Move them here" — exactly the job the confirm modal enqueues.
  await executeClaim({ campaignId: camp._id, effortId: effortB._id, walkListId: search._id, force: true, userId: admin._id, jobId: 'targeting-1' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, admin, effortA, effortB, passA1, passB1, tDefault, tClient, tok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await closeQueues().catch(() => {});
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, body) => {
  const headers = { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}/api/admin/campaigns/${ctx.camp._id}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
};
const id = (label) => String(doors[label]._id);
const PAGE_FILTER = (statuses, extra = {}) => ({ priorPassStatuses: statuses, answerFilters: [], combine: 'or', exclude: null, ...extra });
const ALL_STATUSES = ['unknocked', 'not_home', 'surveyed', 'refused', 'restricted', 'no_soliciting', 'lit_dropped', 'wrong_address', 'not_target'];
const BOXES_OFF = { excludeRestricted: false, excludeNoSoliciting: false, excludeUnplaced: false };
const BOXES_ON = { excludeRestricted: true, excludeNoSoliciting: true, excludeUnplaced: true };
// The five doors with a Restricted entry somewhere in their history.
const RESTRICTED = () => [id('restricted_field'), id('restricted_desk'), id('not_home_then_desk_restricted'), id('desk_restricted_then_not_home'), id('surveyed_A1_desk_restricted_A2')];
const preview = async (filter, boxes) => {
  const r = await call('POST', '/turfs/target-preview', { passId: String(ctx.passB1._id), filter, ...boxes });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return { ...r.json, set: new Set(r.json.householdIds) };
};

test('1. the move keeps the knocks on A; B round 1 draws Unknocked but carries each door\'s all-rounds targeting status', { skip }, async () => {
  const fresh = await Household.find({ campaignId: ctx.camp._id }).lean();
  for (const h of fresh) assert.strictEqual(String(h.effortId), String(ctx.effortB._id));
  assert.strictEqual(await CanvassActivity.countDocuments({ passId: ctx.passB1._id }), 0);

  // The all-rounds status rides only on request (withTarget=1): the page asks for it while the
  // Target doors panel is open, never on a plain load.
  const plain = await call('GET', `/turfs/doors?passId=${ctx.passB1._id}&withStatus=1`);
  assert.strictEqual(plain.status, 200);
  assert.ok(plain.json.doors.every((x) => x.targetStatus === undefined), 'no history aggregate on a plain load');
  const d = await call('GET', `/turfs/doors?passId=${ctx.passB1._id}&withStatus=1&withTarget=1`);
  assert.strictEqual(d.status, 200);
  const byId = new Map(d.json.doors.map((x) => [x.id, x]));
  assert.ok(!byId.has(id('not_home_fully_dnc')), 'a fully-DNC door is never drawn');
  for (const x of d.json.doors) assert.strictEqual(x.passStatus, 'unknocked', 'fresh round');
  const want = {
    not_home: 'not_home', surveyed: 'surveyed', refused: 'refused', wrong_address: 'wrong_address',
    no_soliciting: 'no_soliciting', restricted_field: 'restricted', restricted_desk: 'restricted',
    surveyed_then_not_home: 'surveyed', not_home_then_refused: 'refused', refused_then_not_home: 'refused',
    not_home_then_wrong_address: 'wrong_address', desk_restricted_then_not_home: 'restricted',
    not_home_then_desk_restricted: 'restricted', not_home_far_pin: 'not_home', unknocked_placeholder_pin: 'unknocked',
    not_home_far_pin_confirmed: 'not_home', unknocked: 'unknocked', surveyed_A1_desk_restricted_A2: 'restricted',
    new_address_intake_1: 'unknocked', new_address_intake_2: 'unknocked',
  };
  for (const [label, status] of Object.entries(want)) assert.strictEqual(byId.get(id(label))?.targetStatus, status, label);
  // The global (latest-visit) status and the targeting status part ways exactly where the ladder says.
  assert.strictEqual(byId.get(id('refused_then_not_home')).status, 'not_home', 'coverage/Map: latest visit');
  assert.strictEqual(byId.get(id('refused_then_not_home')).targetStatus, 'refused', 'targeting: someone answered');
  assert.strictEqual(byId.get(id('desk_restricted_then_not_home')).status, 'not_home', 'the phone-side rule: the crew got in');
  assert.strictEqual(byId.get(id('desk_restricted_then_not_home')).targetStatus, 'restricted', 'targeting: restricted wins every time');
  assert.strictEqual(byId.get(id('surveyed_A1_desk_restricted_A2')).status, 'surveyed', 'coverage: completion sticky');
  assert.strictEqual(byId.get(id('surveyed_A1_desk_restricted_A2')).targetStatus, 'restricted', 'targeting: a later mark wins');
  ctx.drawn = d.json.doors;

  const one = await call('GET', `/turfs/household/${id('refused_then_not_home')}`);
  assert.strictEqual(one.status, 200);
  assert.strictEqual(one.json.household.targetStatus, 'refused');
  assert.strictEqual(new Date(one.json.household.lastActionAt).getTime(), at(13).getTime(), 'newest visit, any round');

  // The page's two box counts come from the rollup, by the same ladder, over every drawable door.
  const g = await call('GET', `/turfs?passId=${ctx.passB1._id}&slim=1`);
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.json.restrictedDoorCount, 5, 'five doors carry a Restricted entry');
  assert.strictEqual(g.json.noSolicitingDoorCount, 1);
  assert.strictEqual(g.json.supplementalRestrictedCount, 5, 'all bookless before any cut');
});

test('2. status ticks read the targeting ladder (boxes off)', { skip }, async () => {
  const notHome = await preview(PAGE_FILTER(['not_home']), BOXES_OFF);
  const inNotHome = ['not_home', 'not_home_far_pin', 'not_home_far_pin_confirmed'];
  const outOfNotHome = ['surveyed_then_not_home', 'not_home_then_refused', 'refused_then_not_home', 'not_home_then_wrong_address', 'not_home_then_desk_restricted', 'desk_restricted_then_not_home', 'unknocked', 'new_address_intake_1'];
  for (const l of inNotHome) assert.ok(notHome.set.has(id(l)), `${l} is a not-home door`);
  for (const l of outOfNotHome) assert.ok(!notHome.set.has(id(l)), `${l} is not a not-home door`);
  assert.strictEqual(notHome.doorCount, inNotHome.length);

  const refused = await preview(PAGE_FILTER(['refused']), BOXES_OFF);
  assert.deepStrictEqual([...refused.set].sort(), [id('refused'), id('not_home_then_refused'), id('refused_then_not_home')].sort());

  const unknocked = await preview(PAGE_FILTER(['unknocked']), BOXES_OFF);
  assert.deepStrictEqual([...unknocked.set].sort(), [id('unknocked'), id('unknocked_placeholder_pin'), id('new_address_intake_1'), id('new_address_intake_2')].sort(), 'never visited, flagged pin or not');

  const surveyed = await preview(PAGE_FILTER(['surveyed']), BOXES_OFF);
  assert.deepStrictEqual([...surveyed.set].sort(), [id('surveyed'), id('surveyed_then_not_home')].sort(), 'surveyed in any round, any order — unless a mark came too');
  const restricted = await preview(PAGE_FILTER(['restricted']), BOXES_OFF);
  assert.deepStrictEqual([...restricted.set].sort(), RESTRICTED().sort(), 'any Restricted entry, in any round of any walk list, desk or field, knocked through or not');

  // The exclude side reads the same ladder.
  const exclude = await preview(PAGE_FILTER([], { exclude: { priorPassStatuses: ['refused'], answerFilters: [] } }), BOXES_OFF);
  assert.strictEqual(exclude.excludedDoorCount, 3);
  assert.ok(!exclude.set.has(id('refused_then_not_home')), 'excluding Refused removes the refused-then-not-home door');
  assert.deepStrictEqual(exclude.excludedHouseholdIds.sort(), [id('refused'), id('not_home_then_refused'), id('refused_then_not_home')].sort());
});

test('3. every status ticked + every box off = every drawn door; boxes on name what they removed', { skip }, async () => {
  const all = await preview(PAGE_FILTER(ALL_STATUSES), BOXES_OFF);
  assert.deepStrictEqual([...all.set].sort(), ctx.drawn.map((x) => x.id).sort(), 'nothing fades but the boxes');
  assert.deepStrictEqual(all.leftOut, { restricted: [], noSoliciting: [], unplaced: [], other: [] });

  const boxed = await preview(PAGE_FILTER(ALL_STATUSES), BOXES_ON);
  assert.deepStrictEqual(boxed.leftOut.restricted.sort(), RESTRICTED().sort(), 'the box reads the ladder: knocked-through and old-list marks included');
  assert.deepStrictEqual(boxed.leftOut.noSoliciting, [id('no_soliciting')]);
  assert.deepStrictEqual(boxed.leftOut.unplaced.sort(), [id('not_home_far_pin'), id('unknocked_placeholder_pin')].sort(), 'flagged, unvouched pins — the confirmed one cuts');
  assert.deepStrictEqual(boxed.leftOut.other, []);
  assert.strictEqual(boxed.doorCount + boxed.leftOut.restricted.length + boxed.leftOut.noSoliciting.length + boxed.leftOut.unplaced.length, ctx.drawn.length);
  assert.strictEqual(boxed.unplacedCount, 2, 'the pin toggle\'s own count');
  assert.ok(!boxed.set.has(id('surveyed_A1_desk_restricted_A2')), 'a mark made in the OLD walk list\'s round 2 still keeps the door out after the move');
  assert.ok(!boxed.set.has(id('desk_restricted_then_not_home')), 'and so does a mark the crew knocked through');

  // The dead end: Restricted ticked while the restricted box is on → 0 doors, all named.
  const dead = await preview(PAGE_FILTER(['restricted']), BOXES_ON);
  assert.strictEqual(dead.doorCount, 0);
  assert.strictEqual(dead.leftOut.restricted.length, 5);
});

test('4. a survey-answer target on an override walk list matches that survey (it matched nothing before)', { skip }, async () => {
  const filter = PAGE_FILTER([], { answerFilters: [{ questionKey: 'support', values: ['opt_yes'] }] });
  const r = await preview(filter, BOXES_OFF);
  assert.deepStrictEqual([...r.set], [id('surveyed')], 'the Yes door, under the client survey the walk list uses');
  // The saved-search builder has no walk list to ask, so it still scopes to the campaign default.
  const builder = await resolveWalkList(ctx.camp, filter);
  assert.strictEqual(builder.householdCount, 0);
  // And the campaign-wide builder path reads the same targeting ladder as the cut page.
  const refused = await resolveWalkList(ctx.camp, PAGE_FILTER(['refused']));
  assert.deepStrictEqual(refused.householdIds.map(String).sort(), [id('refused'), id('not_home_then_refused'), id('refused_then_not_home')].sort());
});

test('5. preview == cut: generateTurf books exactly the doors the preview keeps', { skip }, async () => {
  const targetFilter = PAGE_FILTER(['unknocked', 'not_home']);
  const p = await preview(targetFilter, BOXES_ON);
  await generateTurf({
    campaignId: ctx.camp._id, passId: ctx.passB1._id, mode: 'geometric',
    params: { maxDoors: 65, targetFilter, ...BOXES_ON },
  });
  const books = await Turf.find({ passId: ctx.passB1._id, status: 'draft' }, { householdIds: 1 }).lean();
  const booked = books.flatMap((t) => t.householdIds.map(String)).sort();
  assert.deepStrictEqual(booked, [...p.set].sort());
  assert.ok(!booked.includes(id('not_home_far_pin')) && booked.includes(id('not_home_far_pin_confirmed')));
  assert.ok(!booked.includes(id('desk_restricted_then_not_home')), 'the cut itself honors the ladder-based box');
  // The pass rollup's "not in any book" slices read the same ladder as the boxes.
  const g = await call('GET', `/turfs?passId=${ctx.passB1._id}&slim=1`);
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.json.supplementalRestrictedCount, 0, 'restricted doors are not in the target, so none are bookless-and-wanted');
  const pass = await Pass.findById(ctx.passB1._id).lean();
  assert.deepStrictEqual(pass.targetFilter.priorPassStatuses, ['unknocked', 'not_home']);
});

test('6. a door Exclude doors removed that a box would also drop is still named as the Exclude panel\'s', { skip }, async () => {
  // Every status ticked, Restricted excluded, restricted box ON: the three restricted doors leave in
  // the resolver (Exclude doors) before the box ever sees them. They are drawn, so the page must be
  // able to label them — "removed by Exclude doors", never a status that IS ticked.
  const r = await preview(PAGE_FILTER(ALL_STATUSES, { exclude: { priorPassStatuses: ['restricted'], answerFilters: [] } }), BOXES_ON);
  const restricted = RESTRICTED().sort();
  assert.deepStrictEqual(r.excludedHouseholdIds.sort(), restricted, 'the drawn excluded doors, box or no box');
  assert.strictEqual(r.excludedDoorCount, 0, 'M still counts only doors the cut would otherwise have walked');
  assert.deepStrictEqual(r.leftOut.restricted, [], 'the box never saw them');
  for (const x of restricted) assert.ok(!r.set.has(x));
});

test('7. the way back: Unmark (the route) removes a desk mark, Unknock (the service) removes any entry, and the door returns', { skip }, async () => {
  // Restricted wins every time, so these are the ONLY ways a marked home re-enters a cut.
  const before = await preview(PAGE_FILTER(['unknocked']), BOXES_ON);
  assert.ok(!before.set.has(id('restricted_desk')));
  // Unmark — POST /turfs/unrestrict-doors, what the pop-up's Unmark restricted calls. The mark
  // was made on A's round, which the move left behind; the route resolves the door's round itself.
  const u = await call('POST', '/turfs/unrestrict-doors', { householdIds: [id('restricted_desk')], passId: String(ctx.passA1._id) });
  assert.strictEqual(u.status, 200, JSON.stringify(u.json));
  assert.strictEqual(u.json.unmarked, 1);
  const afterUnmark = await preview(PAGE_FILTER(['unknocked']), BOXES_ON);
  assert.ok(afterUnmark.set.has(id('restricted_desk')), 'no entry left, so it reads Unknocked and the box lets it through');
  // Unmark never touches a canvasser's own Restricted; Unknock (Door Outcomes) does.
  const field = await preview(PAGE_FILTER(['unknocked']), BOXES_ON);
  assert.ok(!field.set.has(id('restricted_field')));
  const u2 = await call('POST', '/turfs/unrestrict-doors', { householdIds: [id('restricted_field')], passId: String(ctx.passA1._id) });
  assert.strictEqual(u2.json.unmarked, 0, 'a field row is not a desk mark');
  const row = await CanvassActivity.findOne({ householdId: doors.restricted_field._id, actionType: 'restricted' }).lean();
  await runUnknock({ campaign: ctx.camp, rows: [row], byUserId: ctx.admin._id, byIds: true });
  const afterUnknock = await preview(PAGE_FILTER(['unknocked']), BOXES_ON);
  assert.ok(afterUnknock.set.has(id('restricted_field')), 'the entry is gone, so the door is back');
  assert.strictEqual(afterUnknock.counts.kept, afterUnknock.doorCount, 'counts.kept is the cut\'s own number');
  assert.strictEqual(
    afterUnknock.counts.drawable,
    afterUnknock.counts.kept + afterUnknock.counts.excluded + afterUnknock.counts.restricted + afterUnknock.counts.noSoliciting + afterUnknock.counts.unplaced + afterUnknock.counts.other + afterUnknock.counts.status,
    'the count line\'s parts add up to everything the map can draw'
  );
  const g = await call('GET', `/turfs?passId=${ctx.passB1._id}&slim=1`);
  assert.strictEqual(g.json.restrictedDoorCount, 3, 'two marks gone, three remain');
});

test('8. the ladder in the database agrees with the ladder in JS, door for door, for every status', { skip }, async () => {
  const all = (await Household.find({ campaignId: ctx.camp._id, effortId: ctx.effortB._id }, { _id: 1 }).lean()).map((h) => h._id);
  const map = await getTargetingStatusMap(ctx.camp._id, all, 'survey');
  for (const status of ALL_STATUSES) {
    const fromJs = all.map(String).filter((id) => (map.get(id)?.status || 'unknocked') === status).sort();
    const fromDb = [...(await targetingIdsMatching(ctx.camp._id, all, 'survey', [status]))].sort();
    assert.deepStrictEqual(fromDb, fromJs, status);
  }
  // Several statuses at once, with and without the no-rows complement.
  const some = [...(await targetingIdsMatching(ctx.camp._id, all, 'survey', ['refused', 'surveyed']))].sort();
  assert.deepStrictEqual(some, all.map(String).filter((id) => ['refused', 'surveyed'].includes(map.get(id)?.status)).sort());
  const withUnknocked = [...(await targetingIdsMatching(ctx.camp._id, all, 'survey', ['unknocked', 'not_home']))].sort();
  assert.deepStrictEqual(withUnknocked, all.map(String).filter((id) => ['unknocked', 'not_home'].includes(map.get(id)?.status || 'unknocked')).sort());
  assert.strictEqual((await targetingIdsMatching(ctx.camp._id, all, 'survey', [])).size, 0);
});
