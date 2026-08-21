import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The map's campaign-wide counts, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/mapcounts_test node --test test/mapCounts.int.test.js
//
// GET /admin/households/map/counts answers the header + sidebar with three numbers built from
// the SAME scope helpers as /map, minus the viewport:
//   universe — every active geocoded door in the campaign (or the selected walk list); follows
//              campaignId + effortId ONLY. Pass / import / saved-search / date / canvasser /
//              answer / status / bbox never move it. Includes excluded-from-books + do-not-knock
//              doors (the map shows them), with those two sub-counts beside it.
//   matching — doors matching EVERY filter incl. status, campaign-wide (no bbox).
//   byStatus — doors per status under every filter EXCEPT status; Σ == matching with no status
//              filter, and matching == Σ over the selected statuses otherwise.
// Per-user / per-pass modes resolve status through the same oracle /map colors pins with, so
// the chips agree with the map. The last two tests pin (a) /map and /counts to the same door set
// for the same params and (b) the fix that an import / saved-search scope INTERSECTS with a date
// window instead of being overwritten by it ("View these homes on the map" used to show today's
// work, not the import).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-mapcounts';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { ImportJob } = await import('../src/models/ImportJob.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Campaign days are America/Chicago; every timestamp sits mid-day (15:00Z = 10:00 Chicago), so a
// from/to window keys cleanly.
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';
const DAY5 = '2026-06-14';

const ZERO = { unknocked: 0, not_home: 0, wrong_address: 0, refused: 0, lit_dropped: 0, surveyed: 0, restricted: 0, no_soliciting: 0 };
const counts = (partial) => ({ ...ZERO, ...partial });
const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function hh(orgId, campaignId, effortId, n, status = 'unknocked', extra = {}) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Count Ave`,
    city: 'Town',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} COUNT AVE|TOWN|TX|75701|${String(campaignId)}`,
    location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
    isActive: true,
    status,
    ...extra,
  };
}

function act(hhDoc, userId, actionType, passId, ts) {
  const [lng, lat] = hhDoc.location.coordinates;
  return {
    organizationId: hhDoc.organizationId,
    campaignId: hhDoc.campaignId,
    householdId: hhDoc._id,
    effortId: hhDoc.effortId,
    userId,
    actionType,
    location: { lat, lng, accuracy: 10 },
    distanceFromHouseMeters: 8,
    timestamp: ts,
    passId,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CampaignManager, Effort, Pass, Turf,
    Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, SavedSearch, ImportJob,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Counts Org', slug: 'counts-org', isActive: true, timeZone: 'America/Chicago' });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ca@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'cl@t.co', passwordHash: 'x', isActive: true });
  const ann = await User.create({ firstName: 'Ann', lastName: 'Canvasser', email: 'ann@t.co', passwordHash: 'x', isActive: true });
  const bob = await User.create({ firstName: 'Bob', lastName: 'Canvasser', email: 'bob@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: ann._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: bob._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const campA = await Campaign.create({
    organizationId: org._id, name: 'Counts A', type: 'survey', state: 'TX', isActive: true, timeZone: 'America/Chicago',
  });
  // A second campaign the lead does NOT manage — the gate + the org-wide `all=1` universe.
  const campB = await Campaign.create({
    organizationId: org._id, name: 'Counts B', type: 'survey', state: 'TX', isActive: true, timeZone: 'America/Chicago',
  });
  await CampaignManager.create({ campaignId: campA._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  const effortN = await Effort.create({ organizationId: org._id, campaignId: campA._id, name: 'North' });
  const effortS = await Effort.create({ organizationId: org._id, campaignId: campA._id, name: 'South' });

  // Effort N: N1..N6 (N5 excluded from books, N6 do-not-knock). Effort S: S1..S3 (S3 excluded).
  // I1 sits in Intake (no effort). X is inactive and U has no coordinates — neither is on any map.
  const [N1, N2, N3, N4, N5, N6, S1, S2, S3, I1] = await Household.insertMany([
    hh(org._id, campA._id, effortN._id, 1, 'surveyed'),
    hh(org._id, campA._id, effortN._id, 2, 'not_home'),
    hh(org._id, campA._id, effortN._id, 3, 'refused'),
    hh(org._id, campA._id, effortN._id, 4, 'unknocked'),
    hh(org._id, campA._id, effortN._id, 5, 'unknocked', { excludedFromTurf: true }),
    hh(org._id, campA._id, effortN._id, 6, 'unknocked', { doNotKnock: true }),
    hh(org._id, campA._id, effortS._id, 7, 'surveyed'),
    hh(org._id, campA._id, effortS._id, 8, 'not_home'),
    hh(org._id, campA._id, effortS._id, 9, 'unknocked', { excludedFromTurf: true }),
    hh(org._id, campA._id, null, 10, 'unknocked'),
  ]);
  await Household.insertMany([
    hh(org._id, campA._id, effortN._id, 11, 'unknocked', { isActive: false }),
    { ...hh(org._id, campA._id, effortN._id, 12, 'unknocked'), location: undefined },
  ]);
  const [B1] = await Household.insertMany([hh(org._id, campB._id, null, 1, 'unknocked')]);

  // Rounds. P1/P2 on North both book N1..N4; PS1 on South books S1,S2; P0 on North has NO books.
  const mkPass = (effortId, n, name) => Pass.create({
    organizationId: org._id, campaignId: campA._id, effortId, roundNumber: n, name,
    status: 'active', activatedAt: new Date('2026-06-09T12:00:00Z'),
  });
  const P1 = await mkPass(effortN._id, 1, 'Round 1');
  const P2 = await mkPass(effortN._id, 2, 'Round 2');
  const P0 = await mkPass(effortN._id, 3, 'Round 3');
  const PS1 = await mkPass(effortS._id, 1, 'South 1');
  const mkTurf = (passId, name, ids) => Turf.create({
    organizationId: org._id, campaignId: campA._id, passId, name, mode: 'geometric', status: 'published',
    householdIds: ids, doorCount: ids.length,
  });
  await mkTurf(P1._id, 'Book N1', [N1._id, N2._id, N3._id, N4._id]);
  await mkTurf(P2._id, 'Book N2', [N1._id, N2._id, N3._id, N4._id]);
  await mkTurf(PS1._id, 'Book S1', [S1._id, S2._id]);

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'T', createdBy: admin._id, version: 1 });
  const V1 = await Voter.create({
    organizationId: org._id, campaignId: campA._id, householdId: N1._id, stateVoterId: 'SV-N1',
    firstName: 'Vera', lastName: 'One', fullName: 'Vera One', surveyStatus: 'surveyed',
  });
  const V2 = await Voter.create({
    organizationId: org._id, campaignId: campA._id, householdId: S1._id, stateVoterId: 'SV-S1',
    firstName: 'Vic', lastName: 'Two', fullName: 'Vic Two', surveyStatus: 'surveyed',
  });

  // The ledger. N1 is the cross-canvasser door: Bob SURVEYED it on DAY1, Ann NOT-HOME'd it on
  // DAY2 — both in P1. N4's only knock is in P2 (so it reads unknocked under P1).
  await CanvassActivity.insertMany([
    act(N1, bob._id, 'survey_submitted', P1._id, new Date(`${DAY1}T15:00:00Z`)),
    act(N1, ann._id, 'not_home', P1._id, new Date(`${DAY2}T15:00:00Z`)),
    act(N2, ann._id, 'not_home', P1._id, new Date(`${DAY1}T16:00:00Z`)),
    act(N3, ann._id, 'refused', P1._id, new Date(`${DAY3}T15:00:00Z`)),
    act(N4, ann._id, 'not_home', P2._id, new Date(`${DAY5}T15:00:00Z`)),
    act(S1, bob._id, 'survey_submitted', PS1._id, new Date(`${DAY1}T15:30:00Z`)),
    act(S2, bob._id, 'not_home', PS1._id, new Date(`${DAY5}T16:00:00Z`)),
  ]);
  const sr = (hhDoc, voter, userId, passId, day) => ({
    organizationId: org._id, campaignId: campA._id, voterId: voter._id, householdId: hhDoc._id, userId,
    surveyTemplateId: template._id, surveyTemplateVersion: 1, answers: [],
    location: { lat: 32.35, lng: -95.299, accuracy: 10 }, distanceFromHouseMeters: 8,
    submittedAt: new Date(`${day}T15:00:00Z`), passId,
  });
  await SurveyResponse.insertMany([sr(N1, V1, bob._id, P1._id, DAY1), sr(S1, V2, bob._id, PS1._id, DAY1)]);

  // A saved search freezing N2 + N3, an empty one, and one that belongs to campaign B.
  const ss = await SavedSearch.create({
    organizationId: org._id, campaignId: campA._id, name: 'Two', householdIds: [N2._id, N3._id],
    householdCount: 2, voterCount: 0, source: 'filter', createdBy: admin._id,
  });
  const ssEmpty = await SavedSearch.create({
    organizationId: org._id, campaignId: campA._id, name: 'Empty', householdIds: [], householdCount: 0, voterCount: 0,
  });
  const ssForeign = await SavedSearch.create({
    organizationId: org._id, campaignId: campB._id, name: 'Foreign', householdIds: [B1._id], householdCount: 1, voterCount: 0,
  });
  // An import that inserted N1 + N5, and one that inserted nothing.
  const importJob = await ImportJob.create({
    organizationId: org._id, campaignId: campA._id, filename: 'a.csv', status: 'completed',
    insertedHouseholdIds: [N1._id, N5._id],
  });
  const importEmpty = await ImportJob.create({
    organizationId: org._id, campaignId: campA._id, filename: 'b.csv', status: 'completed', insertedHouseholdIds: [],
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, campA, campB, effortN, effortS, P0, P1, P2, PS1, admin, lead, ann, bob,
    N1, N2, N3, N4, N5, N6, S1, S2, S3, I1, B1, ss, ssEmpty, ssForeign, importJob, importEmpty,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function get(path, token = ctx.adminTok) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const countsFor = async (qs, token) => {
  const r = await get(`/admin/households/map/counts?campaignId=${ctx.campA._id}${qs ? `&${qs}` : ''}`, token);
  assert.strictEqual(r.status, 200, `counts 200 for "${qs}" — got ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const mapFor = async (qs, token) => {
  const r = await get(`/admin/households/map?campaignId=${ctx.campA._id}${qs ? `&${qs}` : ''}`, token);
  assert.strictEqual(r.status, 200, `map 200 for "${qs}"`);
  return r.json;
};

const UNIVERSE_A = { total: 10, excludedFromTurf: 2, doNotKnock: 1 };

test('universe: every active geocoded door in the campaign, identical under every filter', { skip }, async () => {
  const { ann, P1, ss } = ctx;
  const bare = await countsFor('');
  assert.deepStrictEqual(bare.universe, UNIVERSE_A, 'N1..N6 + S1..S3 + Intake I1; inactive X and no-coords U excluded');
  // bbox is a tiny box around N1 only; none of these may move the denominator.
  for (const qs of [
    `from=${DAY1}&to=${DAY1}`, 'status=surveyed', `userId=${ann._id}`, `passId=${P1._id}`,
    `savedSearchId=${ss._id}`, 'bbox=-95.2995,32.349,-95.2985,32.351', 'questionKey=q1&option=Yes',
  ]) {
    const r = await countsFor(qs);
    assert.deepStrictEqual(r.universe, UNIVERSE_A, `universe unchanged by "${qs}"`);
  }
});

test('universe follows effortId (the walk-list select) but not passId', { skip }, async () => {
  const { effortN, effortS, P1 } = ctx;
  assert.deepStrictEqual((await countsFor(`effortId=${effortN._id}`)).universe, { total: 6, excludedFromTurf: 1, doNotKnock: 1 });
  assert.deepStrictEqual((await countsFor(`effortId=${effortS._id}`)).universe, { total: 3, excludedFromTurf: 1, doNotKnock: 0 });
  assert.deepStrictEqual((await countsFor(`passId=${P1._id}`)).universe, UNIVERSE_A, 'a pass scope narrows matching, never the universe');
  assert.deepStrictEqual((await countsFor(`effortId=${effortN._id}&passId=${P1._id}`)).universe, { total: 6, excludedFromTurf: 1, doNotKnock: 1 });
});

test('global mode: byStatus mirrors the stored statuses and sums to matching', { skip }, async () => {
  const r = await countsFor('');
  assert.strictEqual(r.statusMode, 'global');
  assert.deepStrictEqual(r.byStatus, counts({ surveyed: 2, not_home: 2, refused: 1, unknocked: 5 }));
  assert.strictEqual(sumOf(r.byStatus), 10);
  assert.deepStrictEqual(r.matching, { total: 10, excludedFromTurf: 2, doNotKnock: 1 });
});

test('status filter narrows matching only — byStatus keeps answering "what if I clicked this"', { skip }, async () => {
  const base = await countsFor('');
  const two = await countsFor('status=surveyed,not_home');
  assert.strictEqual(two.matching.total, 4);
  assert.strictEqual(two.matching.total, two.byStatus.surveyed + two.byStatus.not_home);
  assert.deepStrictEqual(two.byStatus, base.byStatus, 'byStatus ignores the status selection');
  const unk = await countsFor('status=unknocked');
  assert.deepStrictEqual(unk.matching, { total: 5, excludedFromTurf: 2, doNotKnock: 1 }, 'the excluded + DNC doors are all unknocked');
  const sv = await countsFor('status=surveyed');
  assert.deepStrictEqual(sv.matching, { total: 2, excludedFromTurf: 0, doNotKnock: 0 });
  const bogus = await countsFor('status=bogus');
  assert.strictEqual(bogus.matching.total, 0, 'an unknown status matches nothing');
  assert.deepStrictEqual(bogus.byStatus, base.byStatus);
});

test('date window: matching narrows to doors with a knock or survey in the window', { skip }, async () => {
  const r = await countsFor(`from=${DAY1}&to=${DAY1}`);
  assert.strictEqual(r.matching.total, 3, 'N1 (Bob survey), N2 (Ann not-home), S1 (Bob survey) on DAY1');
  assert.deepStrictEqual(r.byStatus, counts({ surveyed: 2, not_home: 1 }));
  assert.deepStrictEqual(r.universe, UNIVERSE_A);
});

test('userId mode: the chips count each canvasser\'s OWN disposition, like the pins', { skip }, async () => {
  const { ann, bob } = ctx;
  const asAnn = await countsFor(`userId=${ann._id}`);
  assert.strictEqual(asAnn.statusMode, 'user');
  assert.deepStrictEqual(asAnn.byStatus, counts({ not_home: 3, refused: 1 }), 'N1 is not_home for Ann though globally surveyed; N2, N4 not_home; N3 refused');
  assert.strictEqual(asAnn.matching.total, 4);
  const asBob = await countsFor(`userId=${bob._id}`);
  assert.deepStrictEqual(asBob.byStatus, counts({ surveyed: 2, not_home: 1 }));
  assert.strictEqual((await countsFor(`userId=${ann._id}&status=surveyed`)).matching.total, 0);
  assert.strictEqual((await countsFor(`userId=${ann._id}&status=not_home`)).matching.total, 3);
});

test('passId mode: per-round status — completion is sticky, and a knock in another round reads unknocked', { skip }, async () => {
  const { P1, P2, ann } = ctx;
  const p1 = await countsFor(`passId=${P1._id}`);
  assert.strictEqual(p1.statusMode, 'pass');
  assert.deepStrictEqual(p1.byStatus, counts({ surveyed: 1, not_home: 1, refused: 1, unknocked: 1 }),
    "N1 surveyed (sticky over Ann's later not-home), N2 not_home, N3 refused, N4 unknocked (its knock is P2)");
  assert.strictEqual(p1.matching.total, 4);
  const p2 = await countsFor(`passId=${P2._id}`);
  assert.deepStrictEqual(p2.byStatus, counts({ not_home: 1, unknocked: 3 }));
  const p1Ann = await countsFor(`passId=${P1._id}&userId=${ann._id}`);
  assert.strictEqual(p1Ann.statusMode, 'user', 'userId wins, scoped to the round');
  assert.deepStrictEqual(p1Ann.byStatus, counts({ not_home: 2, refused: 1 }), 'N4 absent — Ann never touched it in P1');
});

test('early exits: a known-empty door set answers zeros but STILL a real universe', { skip }, async () => {
  const { P0, ssEmpty, ssForeign, importEmpty } = ctx;
  for (const qs of [`passId=${P0._id}`, `savedSearchId=${ssEmpty._id}`, `savedSearchId=${ssForeign._id}`, `importId=${importEmpty._id}`]) {
    const r = await countsFor(qs);
    assert.deepStrictEqual(r.matching, { total: 0, excludedFromTurf: 0, doNotKnock: 0 }, `zeros for "${qs}"`);
    assert.deepStrictEqual(r.byStatus, ZERO, `zero-filled byStatus for "${qs}"`);
    assert.deepStrictEqual(r.universe, UNIVERSE_A, `the denominator survives "${qs}"`);
  }
});

test('gating mirrors /map: lead scoped 200, unscoped / unmanaged 403; admin bare 400 on a 2-campaign org; all=1 is org-wide', { skip }, async () => {
  const { leadTok, adminTok, campA, campB } = ctx;
  assert.strictEqual((await get(`/admin/households/map/counts?campaignId=${campA._id}`, leadTok)).status, 200);
  assert.strictEqual((await get('/admin/households/map/counts', leadTok)).status, 403);
  assert.strictEqual((await get(`/admin/households/map/counts?campaignId=${campB._id}`, leadTok)).status, 403);
  assert.strictEqual((await get('/admin/households/map/counts', adminTok)).status, 400);
  const all = await get('/admin/households/map/counts?all=1', adminTok);
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.json.universe.total, 11, 'org-wide: campaign A\'s 10 + campaign B\'s 1');
  assert.strictEqual((await get('/admin/households/map?all=1', adminTok)).status, 200, '/map still honors all=1');
});

test('bbox is accepted and ignored — the counts are never viewport-bound', { skip }, async () => {
  const without = await countsFor('');
  const withBox = await countsFor('bbox=-95.2995,32.349,-95.2985,32.351');
  assert.deepStrictEqual(withBox, without);
});

test('AGREEMENT: /map and /map/counts resolve the same door set for the same params (no bbox)', { skip }, async () => {
  const { ann, P1, P2, effortS } = ctx;
  const combos = [
    '', 'status=not_home', `from=${DAY1}&to=${DAY1}`, `userId=${ann._id}`, `userId=${ann._id}&status=not_home`,
    `passId=${P1._id}`, `passId=${P2._id}&status=unknocked`, `effortId=${effortS._id}`,
  ];
  for (const qs of combos) {
    const [m, c] = await Promise.all([mapFor(qs), countsFor(qs)]);
    assert.strictEqual(m.households.length, c.matching.total, `door set size agrees for "${qs}"`);
    assert.strictEqual(m.truncated, false);
    assert.strictEqual(m.cap, 50000, 'the cap is shipped so clients can name it');
    if (!/status=/.test(qs)) {
      const hist = { ...ZERO };
      for (const h of m.households) hist[h.status] = (hist[h.status] || 0) + 1;
      assert.deepStrictEqual(hist, c.byStatus, `status histogram agrees for "${qs}"`);
    }
  }
});

test('an import / saved-search scope INTERSECTS with a date window — it is not overwritten by it', { skip }, async () => {
  const { importJob, ss, N1, N2 } = ctx;
  // Import inserted N1 + N5; only N1 was touched on DAY1. Before the fix this returned every
  // door touched on DAY1 (N1, N2, S1) — the import was silently dropped.
  const m = await mapFor(`importId=${importJob._id}&from=${DAY1}&to=${DAY1}`);
  assert.deepStrictEqual(m.households.map((h) => h.id), [String(N1._id)]);
  const c = await countsFor(`importId=${importJob._id}&from=${DAY1}&to=${DAY1}`);
  assert.strictEqual(c.matching.total, 1);
  // Same for a saved search (N2 + N3): only N2 was touched on DAY1.
  const m2 = await mapFor(`savedSearchId=${ss._id}&from=${DAY1}&to=${DAY1}`);
  assert.deepStrictEqual(m2.households.map((h) => h.id), [String(N2._id)]);
  assert.strictEqual((await countsFor(`savedSearchId=${ss._id}&from=${DAY1}&to=${DAY1}`)).matching.total, 1);
  // And with no window the import scope is the whole import, as before.
  assert.strictEqual((await mapFor(`importId=${importJob._id}`)).households.length, 2);
  assert.strictEqual((await countsFor(`importId=${importJob._id}`)).matching.total, 2);
});
