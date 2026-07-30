import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The target-filter EXCLUDE branch (resolveWalkList's NOT side), over the real app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/exclusion node --test test/targetExclusion.int.test.js
//
// The contract this file pins: `filter.exclude` resolves through the same predicate
// machinery as the include side, its sets are UNIONED (excludes always OR), and the
// union is SUBTRACTED unconditionally — `combine` never touches it, and nothing can
// bring an excluded door back. Exclusion is door-level with ANY semantics (one voter
// with a matching answer removes the whole door). Three traps are pinned hard:
//   1. a degenerate exclude (requested but no predicate could run) excludes NOTHING
//      and is flagged, never "excludes everything" (the empty-predicate-set inversion);
//   2. the no-include-predicates branch copies baseSet, so the in-place subtraction
//      can never mutate it (run-twice assertion);
//   3. isActiveTargetFilter: `{ exclude: {} }` never flips a cut into targeted mode,
//      while an exclude-ONLY filter is targeted and honored.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-exclusion';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { Turf } = await import('../src/models/Turf.js');
const { resolveWalkList, isActiveTargetFilter } = await import('../src/services/walklist/resolveWalkList.js');
const { generateTurf, addSupplementalBooks } = await import('../src/services/turf/generateTurf.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'X-Org-Id': String(ctx.org._id),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// The HD54-shaped filter every "core semantics" case uses: include unknocked/not-home
// OR Support/Likely/Undecided, exclude "Yard Sign Delivered".
const HD54 = () => ({
  priorPassStatuses: ['unknocked', 'not_home'],
  answerFilters: [{ questionKey: 'support', values: ['opt_support', 'opt_likely', 'opt_und'] }],
  combine: 'or',
  exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['opt_delivered'] }] },
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Effort, Pass,
    Household, Voter, SurveyResponse, SurveyTemplate, SavedSearch, Turf]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Exclusion Org', slug: 'exclusion', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Exa', lastName: 'Admin', email: 'ex-admin@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Voter ID & yard signs',
    version: 1,
    questions: [
      {
        key: 'support',
        label: 'Can we count on your support?',
        type: 'single_choice',
        order: 0,
        options: [
          { id: 'opt_support', text: 'Support', order: 0 },
          { id: 'opt_likely', text: 'Likely Support', order: 1 },
          { id: 'opt_und', text: 'Undecided', order: 2 },
          { id: 'opt_opp', text: 'Opposed', order: 3 },
        ],
      },
      {
        key: 'yard_sign',
        label: 'Could you help us by taking a yard sign?',
        type: 'single_choice',
        order: 1,
        options: [
          { id: 'opt_delivered', text: 'Yard Sign Delivered', order: 0 },
          { id: 'opt_follow', text: 'Candidate Follow-Up', order: 1 },
          { id: 'opt_no', text: 'No', order: 2 },
        ],
      },
    ],
  });
  // A SECOND template with the SAME question key — the cross-template collision the
  // answer predicate's template scoping exists to close.
  const template2 = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Old survey',
    version: 1,
    questions: [
      {
        key: 'yard_sign',
        label: 'Yard sign?',
        type: 'single_choice',
        order: 0,
        options: [{ id: 'opt_delivered', text: 'Yard Sign Delivered', order: 0 }],
      },
    ],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'HD54', type: 'survey', state: 'FL',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'District' });
  const p1 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Pass 1', status: 'archived',
  });
  const p2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 2, name: 'Pass 2', status: 'active',
  });

  // Twelve doors, each one edge of the contract (statuses are set directly — the
  // resolver reads Household.status; no report endpoint here needs the ledger).
  //   H1  unknocked                      → include via status
  //   H2  not_home                       → include via status
  //   H3  Support, no sign answer        → include via answer, kept
  //   H4  Support + sign IN PASS 1       → excluded across rounds (one yard, one sign)
  //   H5  Support + Candidate Follow-Up  → sibling option, kept
  //   H6  A Undecided + B sign           → door-level ANY: B's sign removes A's door
  //   H7  Opposed                        → never included
  //   H8  Opposed + sign                 → exclusion population but NOT in the include
  //                                        set → must not appear in excludedHouseholdIds
  //   H9  DEM + REP voters               → the vq-leak pair (with H10)
  //   H10 DEM voter only
  //   H11 sign under the OLD template    → template scoping keeps it
  //   H12 Support + sign + excludedFromTurf → resolver excludes it; the route's M
  //                                        (cuttable-only) must not count it
  const mk = (n, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Exclusion Ave`, city: 'Spring Hill', state: 'FL', zipCode: '34606',
    normalizedAddress: `${n} EXCLUSION AVE|SPRING HILL|FL|34606`,
    location: { type: 'Point', coordinates: [-82.5 + n * 0.001, 28.47] },
    ...extra,
  });
  const [h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12] = await Household.insertMany([
    mk(1),
    mk(2, { status: 'not_home' }),
    mk(3, { status: 'surveyed' }),
    mk(4, { status: 'surveyed' }),
    mk(5, { status: 'surveyed' }),
    mk(6, { status: 'surveyed' }),
    mk(7, { status: 'surveyed' }),
    mk(8, { status: 'surveyed' }),
    mk(9),
    mk(10),
    mk(11),
    mk(12, { status: 'surveyed', excludedFromTurf: true }),
  ]);

  let seq = 0;
  const voter = (home, extra = {}) => Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: home._id,
    stateVoterId: `EX${++seq}`, firstName: `V${seq}`, lastName: 'Test', fullName: `V${seq} Test`,
    ...extra,
  });
  const v3 = await voter(h3);
  const v4 = await voter(h4);
  const v5 = await voter(h5);
  const v6a = await voter(h6);
  const v6b = await voter(h6);
  const v7 = await voter(h7);
  const v8 = await voter(h8);
  await voter(h9, { party: 'DEM' });
  await voter(h9, { party: 'REP' });
  const v10 = await voter(h10, { party: 'DEM' });
  const v11 = await voter(h11);
  const v12 = await voter(h12);
  await voter(h1);
  await voter(h2);

  const respond = (v, home, pass, answers, tpl = template) => SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, passId: pass._id,
    householdId: home._id, voterId: v._id, userId: admin._id,
    surveyTemplateId: tpl._id, surveyTemplateVersion: 1,
    location: { lat: 28.47, lng: -82.5 }, submittedAt: new Date('2026-07-01T14:00:00Z'),
    answers,
  });
  const supportAns = (optId, text) => ({
    questionKey: 'support', questionLabel: 'Can we count on your support?', answer: text, optionIds: [optId],
  });
  const signAns = (optId, text) => ({
    questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', answer: text, optionIds: [optId],
  });

  await respond(v3, h3, p2, [supportAns('opt_support', 'Support')]);
  // H4's sign was delivered in the EARLIER round — the exclusion must reach it anyway.
  await respond(v4, h4, p1, [supportAns('opt_support', 'Support'), signAns('opt_delivered', 'Yard Sign Delivered')]);
  await respond(v5, h5, p2, [supportAns('opt_support', 'Support'), signAns('opt_follow', 'Candidate Follow-Up')]);
  await respond(v6a, h6, p2, [supportAns('opt_und', 'Undecided')]);
  await respond(v6b, h6, p2, [signAns('opt_delivered', 'Yard Sign Delivered')]);
  await respond(v7, h7, p2, [supportAns('opt_opp', 'Opposed')]);
  await respond(v8, h8, p2, [supportAns('opt_opp', 'Opposed'), signAns('opt_delivered', 'Yard Sign Delivered')]);
  await respond(v11, h11, p2, [signAns('opt_delivered', 'Yard Sign Delivered')], template2);
  await respond(v12, h12, p2, [supportAns('opt_support', 'Support'), signAns('opt_delivered', 'Yard Sign Delivered')]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, campaign, effort, p1, p2, template, template2,
    h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12,
    v3, v5, v6a, v10,
    token: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const idSet = (ids) => new Set(ids.map(String));

test('1. the HD54 cut: include unknocked/not-home OR S/L/U, exclude delivered signs', { skip }, async () => {
  const { campaign, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12, v5, v6a } = ctx;
  const r = await resolveWalkList(campaign, HD54());

  const got = idSet(r.householdIds);
  const want = idSet([h1, h2, h3, h5, h9, h10, h11].map((h) => h._id));
  assert.deepEqual(got, want, 'exactly the 7 surviving doors');
  assert.equal(r.householdCount, 7);

  // The individual edges, named:
  assert.ok(!got.has(String(h4._id)), 'H4 dropped — its sign is in PASS 1, exclusion is all-rounds');
  assert.ok(got.has(String(h5._id)), 'H5 kept — Candidate Follow-Up is a sibling option, not a sign');
  assert.ok(!got.has(String(h6._id)), 'H6 dropped — ANY voter with a sign removes the whole door');
  assert.ok(!got.has(String(h7._id)) && !got.has(String(h8._id)), 'Opposed doors were never included');
  assert.ok(got.has(String(h11._id)), 'H11 kept — its sign lives under a DIFFERENT template (scoping)');

  // M is the intersection with the include result, not the raw exclusion population.
  const excluded = idSet(r.excludedHouseholdIds);
  assert.deepEqual(excluded, idSet([h4, h6, h12].map((h) => h._id)),
    'excluded = doors actually removed; H8 (never included) is not among them');
  assert.equal(r.excludedDoorCount, 3);
  assert.equal(r.excludeDegenerate, false);

  // Door-level ANY reaches the voter list too: the excluded door's Undecided voter is gone.
  const voters = idSet(r.voterIds);
  assert.ok(!voters.has(String(v6a._id)), "H6's Undecided voter left with their door");
  assert.ok(voters.has(String(v5._id)), "H5's voter walks");
});

test('2. degenerate exclude: requested but nothing could run → excludes NOTHING, flagged', { skip }, async () => {
  const { campaign } = ctx;

  // Every exclude entry invalid (no values picked).
  const r1 = await resolveWalkList(campaign, { exclude: { answerFilters: [{ questionKey: 'yard_sign' }] } });
  assert.equal(r1.householdCount, 12, 'the naive-reuse bug would return 0 here — full base instead');
  assert.equal(r1.excludeDegenerate, true);
  assert.ok(r1.warnings.length > 0, 'and it says why');
  assert.equal(r1.excludedDoorCount, 0);

  // Tag filters with no template to resolve them against (the L120-style short-circuit).
  const bare = { _id: campaign._id, organizationId: campaign.organizationId, type: campaign.type, surveyTemplateId: null };
  const r2 = await resolveWalkList(bare, { exclude: { answerTagFilters: [{ tag: 'Supporter' }] } });
  assert.equal(r2.householdCount, 12);
  assert.equal(r2.excludeDegenerate, true);
  assert.ok(r2.warnings.some((w) => w.includes('template')));
});

test('3. generateTurf refuses a degenerate exclude; a valid zero-match exclude cuts fine', { skip }, async () => {
  const { campaign, p2 } = ctx;

  await assert.rejects(
    generateTurf({
      campaignId: campaign._id, passId: p2._id, mode: 'geometric',
      params: { maxDoors: 65, targetFilter: { exclude: { answerFilters: [{ questionKey: 'yard_sign', values: [] }] } } },
    }),
    /exclusion filter has no valid conditions/,
    'cutting anyway would silently walk the doors the admin removed'
  );
  assert.equal(await Turf.countDocuments({ passId: p2._id }), 0, 'the refused cut wrote no books');

  // Counter-case: a VALID exclusion that matches zero doors (nobody answered "No") is
  // not degenerate — an empty set was pushed, which is different from no set at all.
  const r = await resolveWalkList(campaign, { exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['opt_no'] }] } });
  assert.equal(r.excludeDegenerate, false);
  assert.equal(r.excludedDoorCount, 0);
  assert.equal(r.householdCount, 12, 'nothing excluded, nothing lost');
});

test('4. exclude-only filter: base minus the union, and baseSet is never mutated', { skip }, async () => {
  const { campaign, h4, h6, h8, h12 } = ctx;
  const filter = { exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['opt_delivered'] }] } };

  const r1 = await resolveWalkList(campaign, filter);
  assert.equal(r1.householdCount, 8, '12 doors minus the 4 with a delivered sign');
  assert.deepEqual(idSet(r1.excludedHouseholdIds), idSet([h4, h6, h8, h12].map((h) => h._id)),
    'with no include side, every sign door (H8 too) is in the include set and gets removed');
  assert.equal(r1.householdCount + r1.excludedDoorCount, 12,
    'partition invariant: kept + excluded === base');

  // Run twice: an aliasing bug (finalSet = baseSet + in-place delete) would make the
  // second resolution start from an already-shrunken base.
  const r2 = await resolveWalkList(campaign, filter);
  assert.equal(r2.householdCount, r1.householdCount, 'identical on re-run');
  assert.equal(r2.excludedDoorCount, r1.excludedDoorCount);
});

test('5. isActiveTargetFilter: {exclude:{}} is inactive; a real exclude-only filter is targeted', { skip }, async () => {
  const { campaign, p2 } = ctx;

  // Pure classification.
  assert.equal(isActiveTargetFilter({}), false);
  assert.equal(isActiveTargetFilter({ combine: 'or' }), false);
  assert.equal(isActiveTargetFilter({ priorPassId: String(p2._id) }), false, 'a modifier alone is not a predicate');
  assert.equal(isActiveTargetFilter({ exclude: {} }), false);
  assert.equal(isActiveTargetFilter({ exclude: { answerFilters: [] } }), false);
  assert.equal(isActiveTargetFilter({ exclude: { combine: 'or' } }), false);
  assert.equal(isActiveTargetFilter({ exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['x'] }] } }), true);
  assert.equal(isActiveTargetFilter({ priorPassStatuses: ['unknocked'] }), true);

  // Through the cut: an empty exclude is NOT a targeted round — full universe, and no
  // junk targetFilter persisted on the Pass.
  await generateTurf({
    campaignId: campaign._id, passId: p2._id, mode: 'geometric',
    params: { maxDoors: 65, targetFilter: { exclude: {} } },
  });
  let books = await Turf.find({ passId: p2._id }).lean();
  let doors = books.reduce((n, t) => n + t.doorCount, 0);
  assert.equal(doors, 11, 'all knockable doors (12 minus H12 excludedFromTurf) — untargeted');
  let pass = await Pass.findById(p2._id).lean();
  assert.equal(pass.targetFilter, null, 'no junk filter recorded');

  // A legitimate exclude-ONLY filter IS targeted, cuts base-minus-excluded, and the
  // filter survives on the Pass intact (Mixed field).
  const exOnly = { exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['opt_delivered'] }] } };
  await generateTurf({
    campaignId: campaign._id, passId: p2._id, mode: 'geometric',
    params: { maxDoors: 65, targetFilter: exOnly },
  });
  books = await Turf.find({ passId: p2._id }).lean();
  doors = books.reduce((n, t) => n + t.doorCount, 0);
  assert.equal(doors, 8, '12 minus the 4 sign doors (H12 falls out both ways)');
  pass = await Pass.findById(p2._id).lean();
  assert.deepEqual(pass.targetFilter?.exclude?.answerFilters?.[0]?.values, ['opt_delivered'],
    'the exclude branch is recorded for reproducibility');

  // Leave the pass clean for later tests: an untargeted re-cut clears drafts + filter.
  await generateTurf({ campaignId: campaign._id, passId: p2._id, mode: 'geometric', params: { maxDoors: 65 } });
});

test('6. the exclude side\'s demographics never leak into the include voter query', { skip }, async () => {
  const { campaign, h9, h10, v10 } = ctx;
  const r = await resolveWalkList(campaign, { parties: ['DEM'], exclude: { parties: ['REP'] } });

  const got = idSet(r.householdIds);
  assert.ok(!got.has(String(h9._id)), 'H9 removed — it houses a REP');
  assert.ok(got.has(String(h10._id)), 'H10 kept — DEM only');
  // If exc.vq leaked, the final voter query would demand party REP and find nobody at H10.
  assert.equal(r.voterCount, 1, "exactly H10's DEM voter");
  assert.equal(String(r.voterIds[0]), String(v10._id));
});

test('7. /target-preview: M counts only doors the CUT would have walked; preview == cut', { skip }, async () => {
  const { campaign, p2, h3, v3 } = ctx;
  const path = `/admin/campaigns/${campaign._id}/turfs/target-preview`;

  const r = await call(path, { method: 'POST', body: { passId: String(p2._id), filter: HD54() } });
  assert.equal(r.status, 200);
  assert.equal(r.json.doorCount, 7);
  assert.equal(r.json.excludedDoorCount, 2,
    'H4 + H6 only — H12 is not cuttable (excludedFromTurf) so its exclusion changed nothing');
  assert.equal(r.json.excludeDegenerate, false);

  // ...while the resolver itself reports all 3 — the route deliberately narrows M to
  // the cuttable universe (the number the admin would actually have walked).
  const svc = await resolveWalkList(campaign, HD54());
  assert.equal(svc.excludedDoorCount, 3);

  // DNC voters no longer inflate the preview's voter count. (The doc's doNotContact is
  // null until first flagged, so set the whole subdocument, not a dot path.)
  const beforeCount = r.json.voterCount;
  await Voter.updateOne({ _id: v3._id }, { $set: { doNotContact: { flagged: true } } });
  const rDnc = await call(path, { method: 'POST', body: { passId: String(p2._id), filter: HD54() } });
  assert.equal(rDnc.json.voterCount, beforeCount - 1, 'the flagged voter dropped out');
  await Voter.updateOne({ _id: v3._id }, { $set: { doNotContact: null } });

  // excludeRestricted now reaches the preview, so its count matches the cut.
  await Household.updateOne({ _id: h3._id }, { $set: { status: 'restricted' } });
  const rOn = await call(path, {
    method: 'POST', body: { passId: String(p2._id), filter: HD54(), excludeRestricted: true },
  });
  const rOff = await call(path, { method: 'POST', body: { passId: String(p2._id), filter: HD54() } });
  assert.equal(rOn.json.doorCount, rOff.json.doorCount - 1, 'the restricted door is previewed out');
  // Restore rather than reorder — later tests must not depend on this one.
  await Household.updateOne({ _id: h3._id }, { $set: { status: 'surveyed' } });
});

test('8. SavedSearch round-trip: filter.exclude (and texts) survive the strict schema', { skip }, async () => {
  const { campaign, h4, h6 } = ctx;
  const filter = {
    ...HD54(),
    exclude: { answerFilters: [{ questionKey: 'yard_sign', values: ['opt_delivered'], texts: ['Yard Sign Delivered'] }] },
  };

  const preview = await call(`/admin/campaigns/${campaign._id}/walklists/preview`, {
    method: 'POST', body: { filter },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.excludedDoorCount, 3, 'the saved-search preview reports M too');

  const saved = await call(`/admin/campaigns/${campaign._id}/walklists`, {
    method: 'POST', body: { name: 'Pass 3 sign-drop', filter },
  });
  assert.equal(saved.status, 201);

  const doc = await SavedSearch.findById(saved.json.walkList._id).lean();
  const ex = doc.filter?.exclude?.answerFilters?.[0];
  assert.ok(ex, 'the exclude branch persisted (undeclared keys are silently stripped — this one is declared)');
  assert.deepEqual(ex.values, ['opt_delivered']);
  assert.deepEqual(ex.texts, ['Yard Sign Delivered'], 'texts too — the pre-existing silent drop is fixed');

  // And the FROZEN ids are post-exclusion: the sign doors never made it into the list.
  const frozen = idSet(doc.householdIds);
  assert.equal(doc.householdCount, 7);
  assert.ok(!frozen.has(String(h4._id)) && !frozen.has(String(h6._id)));
});

test('9. backward compatibility: no exclude key → identical behavior, quiet new fields', { skip }, async () => {
  const { campaign } = ctx;

  const empty = await resolveWalkList(campaign, {});
  assert.equal(empty.householdCount, 12, 'empty filter still resolves the full base');
  assert.equal(empty.excludedDoorCount, 0);
  assert.equal(empty.excludeDegenerate, false);
  assert.deepEqual(empty.warnings, []);

  // A legacy include-only filter selects exactly what it always did — the union,
  // nothing subtracted.
  const legacy = { ...HD54() };
  delete legacy.exclude;
  const r = await resolveWalkList(campaign, legacy);
  assert.equal(r.householdCount, 10, 'the 7 survivors plus the 3 the exclude would have removed');
  assert.equal(r.excludedDoorCount, 0);
});

test('10. supplemental books respect the pass\'s target: excluded doors are never re-introduced', { skip }, async () => {
  const { campaign, effort, org, p2, h4, h6 } = ctx;

  // Cut the round with the HD54 filter — books over the 7 surviving doors, and the
  // filter (exclude branch included) recorded on the Pass.
  await generateTurf({
    campaignId: campaign._id, passId: p2._id, mode: 'geometric',
    params: { maxDoors: 65, targetFilter: HD54() },
  });
  const booked = await Turf.find({ passId: p2._id }).lean();
  assert.equal(booked.reduce((n, t) => n + t.doorCount, 0), 7);

  // The exact bug from the field: the excluded doors (H4, H6) and the never-included
  // doors (H7, H8) are all bookless — but they are bookless ON PURPOSE, so the
  // supplemental count must be 0 and the supplemental cut must add nothing.
  const rollup = await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p2._id}`);
  assert.equal(rollup.status, 200);
  assert.equal(rollup.json.supplementalDoorCount, 0,
    'the "N doors not in any book" nag has nothing to nag about');
  const none = await addSupplementalBooks({ campaignId: campaign._id, passId: p2._id });
  assert.equal(none.added, 0, 'no book of deliberately-removed doors');

  // A genuinely NEW door (post-cut import: unknocked, no answers) matches the target's
  // unknocked branch, can't match the answer exclusion, and flows in — alone.
  const fresh = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '99 Newcomer Way', city: 'Spring Hill', state: 'FL', zipCode: '34606',
    normalizedAddress: '99 NEWCOMER WAY|SPRING HILL|FL|34606',
    location: { type: 'Point', coordinates: [-82.49, 28.475] },
  });
  const rollup2 = await call(`/admin/campaigns/${campaign._id}/turfs?passId=${p2._id}`);
  assert.equal(rollup2.json.supplementalDoorCount, 1, 'exactly the newcomer');
  const added = await addSupplementalBooks({ campaignId: campaign._id, passId: p2._id });
  assert.equal(added.added, 1);
  const supp = await Turf.find({ passId: p2._id, 'params.supplemental': true }).lean();
  assert.equal(supp.length, 1);
  assert.deepEqual(supp[0].householdIds.map(String), [String(fresh._id)],
    'the supplemental book holds the newcomer and nothing else — not H4, not H6');
  const stillLoose = await Household.find({ _id: { $in: [h4._id, h6._id] } }, { turfId: 1 }).lean();
  assert.ok(stillLoose.every((h) => !h.turfId), 'the excluded doors stay out of every book');
});
