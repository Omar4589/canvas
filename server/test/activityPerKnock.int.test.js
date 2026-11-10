import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// One row per knock on the Canvassing activity export (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md):
//   npm --prefix server run test:int -- test/activityPerKnock.int.test.js
// The promise under test: with params.onePerKnock the file's knock rows ARE the dashboard's Knocks —
// one per door per round, the door's knock result (the client report's rule, exact ties included) —
// the survey rows follow the knock rows with coverage taken from the rows actually written, and the
// estimate equals the build for rows, the withheld figure and the survey rows.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-perknock';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');
const { loadDncVoterIdSet } = await import('../src/services/export/exportScope.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const {
  buildCanvassActivity,
  activityFileNames,
  knockRowsAggregate,
} = await import('../src/services/export/exportBuilders.js');
const { buildKnocksByPassData } = await import('../src/services/reports/knocksByPass.js');
const { KNOCK_ACTIONS } = await import('../src/services/reports/aggregations.js');
const { resolveStatus } = await import('../src/utils/statusPrecedence.js');
const { zonedDayRange } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/Chicago';
const T = (s) => new Date(`2026-07-${s}Z`);
const f = {}; // fixture handles

const TYPE = EXPORT_TYPES['canvass-activity'];

// The builder's ctx, as exportProcessor.js builds it, with counters we can read back.
const makeCtx = async (campaign, rawParams) => {
  const params = await TYPE.validateParams(rawParams, { organizationId: f.org._id, campaignId: campaign._id });
  const counters = { excludedDnc: 0, orphaned: 0 };
  return {
    organizationId: f.org._id,
    campaignId: campaign._id,
    campaign: await Campaign.findById(campaign._id).lean(),
    org: await Organization.findById(f.org._id).lean(),
    params,
    anchorTz: TZ,
    dnc: await loadDncVoterIdSet(f.org._id),
    subjects: { add() {}, result: () => ({}) },
    counters,
    countDnc: (n) => { counters.excludedDnc += n; },
    countOrphaned: (n) => { counters.orphaned += n; },
    setTotalEstimate: (n) => { counters.total = n; },
    progress: () => {},
  };
};

// An in-memory sink with the csvWriter interface the builder uses.
const memSink = (hooks = {}) => {
  const out = { name: null, headers: null, rows: [] };
  return {
    out,
    sink: {
      async file(name, headers) {
        out.name = name;
        out.headers = headers;
        return {
          async writeRow(cells) {
            out.rows.push(cells);
            if (hooks.afterRow) await hooks.afterRow(out.rows.length, cells);
          },
          get rowsWritten() { return out.rows.length; },
        };
      },
      async raw() { throw new Error('no raw entries in a CSV'); },
    },
  };
};

const build = async (campaign, params, hooks) => {
  const ctx = await makeCtx(campaign, params);
  const { out, sink } = memSink(hooks);
  const result = await buildCanvassActivity(ctx, sink);
  const col = (name) => out.headers.indexOf(name);
  const rows = out.rows.map((cells) => Object.fromEntries(out.headers.map((h, i) => [h, cells[i]])));
  return { ctx, out, rows, result, col };
};

const estimate = async (campaign, params) => {
  const ctx = await makeCtx(campaign, params);
  return TYPE.estimate(ctx);
};

const knockRowsOf = (rows) => rows.filter((r) => (r['Row source'] ?? 'knock') === 'knock');
const surveyRowsOf = (rows) => rows.filter((r) => r['Row source'] === 'survey');
const byHome = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = r['Household DB id'];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  // The indexes in place before any fixture, as in production (the 77fb703 lesson) — and the per-knock
  // rows HINT {campaignId: 1}, which fails outright if that index is missing.
  await Promise.all([CanvassActivity.createIndexes(), SurveyResponse.createIndexes(), Voter.createIndexes(), Household.createIndexes()]);

  f.org = await Organization.create({ name: 'Per Knock Org', slug: 'per-knock-org', isActive: true });
  const mkUser = (first) => User.create({ firstName: first, lastName: 'Canvasser', email: `${first.toLowerCase()}@pk.test`, passwordHash: 'h', isActive: true });
  f.ada = await mkUser('Ada');
  f.ben = await mkUser('Ben');
  f.desk = await mkUser('Desk');

  f.camp = await Campaign.create({ organizationId: f.org._id, name: 'Survey Ward', type: 'survey', state: 'TX', timeZone: TZ });
  f.lit = await Campaign.create({ organizationId: f.org._id, name: 'Lit Ward', type: 'lit_drop', state: 'TX', timeZone: TZ });
  f.e1 = await Effort.create({ organizationId: f.org._id, campaignId: f.camp._id, name: 'North' });
  f.e2 = await Effort.create({ organizationId: f.org._id, campaignId: f.camp._id, name: 'South' });
  f.p1 = await Pass.create({ organizationId: f.org._id, campaignId: f.camp._id, effortId: f.e1._id, roundNumber: 1, name: 'First', status: 'archived', activatedAt: T('01T00:00:00'), archivedAt: T('10T00:00:00'), archivedFrom: 'active', archivedVia: 'next-pass' });
  f.p2 = await Pass.create({ organizationId: f.org._id, campaignId: f.camp._id, effortId: f.e1._id, roundNumber: 2, name: 'Second', status: 'active', activatedAt: T('10T00:00:00') });
  f.p3 = await Pass.create({ organizationId: f.org._id, campaignId: f.camp._id, effortId: f.e2._id, roundNumber: 1, name: 'South first', status: 'active', activatedAt: T('01T00:00:00') });
  f.litEffort = await Effort.create({ organizationId: f.org._id, campaignId: f.lit._id, name: 'Lit list' });
  f.litPass = await Pass.create({ organizationId: f.org._id, campaignId: f.lit._id, effortId: f.litEffort._id, roundNumber: 1, name: 'Lit 1', status: 'active', activatedAt: T('01T00:00:00') });

  let n = 0;
  const mkHome = (key, campaign = f.camp, effort = f.e1) => {
    n += 1;
    return Household.create({
      organizationId: f.org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${n} ${key} St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${n} ${key.toLowerCase()} st|austin|tx|78701`, isActive: true,
      location: { type: 'Point', coordinates: [-97.74 + n / 1000, 30.27] },
    });
  };
  const mkVoter = (home, sv, extra = {}) =>
    Voter.create({ organizationId: f.org._id, campaignId: home.campaignId, householdId: home._id, stateVoterId: sv, firstName: sv, lastName: 'Voter', fullName: `${sv} Voter`, party: 'IND', ...extra });
  const act = (home, pass, user, actionType, ts, extra = {}) =>
    CanvassActivity.create({
      organizationId: f.org._id, campaignId: home.campaignId, householdId: home._id,
      userId: user._id, actionType, timestamp: ts, passId: pass ? pass._id : null, effortId: home.effortId,
      location: { lat: 30.27, lng: -97.74, accuracy: 5 }, ...extra,
    });

  f.template = await SurveyTemplate.create({
    organizationId: f.org._id, name: 'Door Survey', version: 1,
    questions: [{ key: 'support', label: 'Do you support?', type: 'single_choice', order: 0, options: [{ id: 'o-yes', text: 'Yes', order: 0 }, { id: 'o-no', text: 'No', order: 1 }] }],
  });
  const resp = (voter, home, pass, user, ts, answer = 'Yes') =>
    SurveyResponse.create({
      organizationId: f.org._id, campaignId: home.campaignId, voterId: voter._id, householdId: home._id,
      userId: user._id, surveyTemplateId: f.template._id, surveyTemplateVersion: 1, submittedAt: ts,
      passId: pass ? pass._id : null, effortId: home.effortId, location: { lat: 30.27, lng: -97.74, accuracy: 5 },
      answers: [{ questionKey: 'support', questionLabel: 'Do you support?', answer, optionIds: [answer === 'Yes' ? 'o-yes' : 'o-no'] }],
    });

  // --- every pair kind (round P1 unless noted) -------------------------------------------------
  f.hNN = await mkHome('NN'); // two canvassers, both Not home → the later
  await act(f.hNN, f.p1, f.ada, 'not_home', T('02T15:00:00'));
  f.hNN_keep = await act(f.hNN, f.p1, f.ben, 'not_home', T('02T15:00:20'));
  await act(f.hNN, f.p2, f.ada, 'not_home', T('11T15:00:00')); // a second ROUND: a second knock

  f.hRR = await mkHome('RR');
  await act(f.hRR, f.p1, f.ada, 'refused', T('02T16:00:00'));
  f.hRR_keep = await act(f.hRR, f.p1, f.ben, 'refused', T('02T16:00:30'));

  f.hNS = await mkHome('NS'); // Not home, then a partner surveyed → Surveyed
  f.vNS = await mkVoter(f.hNS, 'VNS');
  await act(f.hNS, f.p1, f.ada, 'not_home', T('02T17:00:00'));
  f.hNS_keep = await act(f.hNS, f.p1, f.ben, 'survey_submitted', T('02T17:00:20'), { voterId: f.vNS._id });
  await resp(f.vNS, f.hNS, f.p1, f.ben, T('02T17:00:20'));

  f.hSN = await mkHome('SN'); // Surveyed, then a partner's later Not home → still Surveyed (sticky)
  f.vSN = await mkVoter(f.hSN, 'VSN');
  f.hSN_keep = await act(f.hSN, f.p1, f.ada, 'survey_submitted', T('02T18:00:00'), { voterId: f.vSN._id });
  await resp(f.vSN, f.hSN, f.p1, f.ada, T('02T18:00:00'));
  await act(f.hSN, f.p1, f.ben, 'not_home', T('02T19:00:00'));

  f.hNR = await mkHome('NR'); // Not home then Refused → Refused (latest)
  await act(f.hNR, f.p1, f.ada, 'not_home', T('03T15:00:00'));
  f.hNR_keep = await act(f.hNR, f.p1, f.ben, 'refused', T('03T15:00:12'));

  f.hSSsame = await mkHome('SSsame'); // both surveyed the SAME person → the later entry, one response
  f.vSame = await mkVoter(f.hSSsame, 'VSAME');
  await act(f.hSSsame, f.p1, f.ada, 'survey_submitted', T('03T16:00:00'), { voterId: f.vSame._id });
  f.hSSsame_keep = await act(f.hSSsame, f.p1, f.ben, 'survey_submitted', T('03T16:00:30'), { voterId: f.vSame._id });
  await resp(f.vSame, f.hSSsame, f.p1, f.ben, T('03T16:00:30'));

  f.hSSdiff = await mkHome('SSdiff'); // DIFFERENT people → the dropped entry's survey becomes a survey row
  f.vDiffA = await mkVoter(f.hSSdiff, 'VDIFFA');
  f.vDiffB = await mkVoter(f.hSSdiff, 'VDIFFB');
  await act(f.hSSdiff, f.p1, f.ada, 'survey_submitted', T('03T17:00:00'), { voterId: f.vDiffA._id });
  f.hSSdiff_keep = await act(f.hSSdiff, f.p1, f.ben, 'survey_submitted', T('03T17:00:40'), { voterId: f.vDiffB._id });
  await resp(f.vDiffA, f.hSSdiff, f.p1, f.ada, T('03T17:00:00'));
  await resp(f.vDiffB, f.hSSdiff, f.p1, f.ben, T('03T17:00:40'));

  f.hSSdnc = await mkHome('SSdnc'); // different people, the DROPPED one asked not to be contacted → withheld
  f.vDnc = await mkVoter(f.hSSdnc, 'VDNC', { doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' } });
  f.vDncSib = await mkVoter(f.hSSdnc, 'VDNCSIB');
  await act(f.hSSdnc, f.p1, f.ada, 'survey_submitted', T('04T15:00:00'), { voterId: f.vDnc._id });
  f.hSSdnc_keep = await act(f.hSSdnc, f.p1, f.ben, 'survey_submitted', T('04T15:01:00'), { voterId: f.vDncSib._id });
  await resp(f.vDnc, f.hSSdnc, f.p1, f.ada, T('04T15:00:00'));
  await resp(f.vDncSib, f.hSSdnc, f.p1, f.ben, T('04T15:01:00'));

  f.hTie = await mkHome('Tie'); // two different results at the SAME millisecond → the lower _id (the report's rule)
  f.hTie_keep = await act(f.hTie, f.p1, f.ada, 'not_home', T('04T16:00:00'));
  await act(f.hTie, f.p1, f.ben, 'refused', T('04T16:00:00'));

  f.hRestr = await mkHome('Restr'); // a field Restricted mark and a knock → in, by its knock
  await act(f.hRestr, f.p1, f.ada, 'restricted', T('04T17:00:00'));
  f.hRestr_keep = await act(f.hRestr, f.p1, f.ben, 'not_home', T('04T16:30:00'));

  f.hDeskOnly = await mkHome('DeskOnly'); // a desk restriction only → not a knock, absent
  await act(f.hDeskOnly, f.p1, f.desk, 'restricted', T('04T18:00:00'), { via: 'bulk' });

  f.hNoteOnly = await mkHome('NoteOnly'); // a note only → absent
  await act(f.hNoteOnly, f.p1, f.ada, 'note_added', T('05T15:00:00'), { note: 'dog' });

  f.hBulkKnock = await mkHome('BulkKnock'); // a desk-authored KNOCK entry → in at campaign scope, out per canvasser
  f.hBulkKnock_keep = await act(f.hBulkKnock, f.p1, f.desk, 'not_home', T('05T16:00:00'), { via: 'bulk' });

  f.hFlagKept = await mkHome('FlagKept'); // the kept row names a flagged voter → blanked, counted once
  f.vFlag = await mkVoter(f.hFlagKept, 'VFLAG', { doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' } });
  f.hFlagKept_keep = await act(f.hFlagKept, f.p1, f.ada, 'survey_submitted', T('05T17:00:00'), { voterId: f.vFlag._id });
  await resp(f.vFlag, f.hFlagKept, f.p1, f.ada, T('05T17:00:00'));

  f.hMulti = await mkHome('Multi'); // ONE canvasser surveyed two people: one entry (the latest person), two responses
  f.vMultiA = await mkVoter(f.hMulti, 'VMULTIA');
  f.vMultiB = await mkVoter(f.hMulti, 'VMULTIB');
  f.hMulti_keep = await act(f.hMulti, f.p1, f.ada, 'survey_submitted', T('05T18:01:00'), { voterId: f.vMultiB._id });
  await resp(f.vMultiA, f.hMulti, f.p1, f.ada, T('05T18:00:00'));
  await resp(f.vMultiB, f.hMulti, f.p1, f.ada, T('05T18:01:00'));

  f.hSouth = await mkHome('South', f.camp, f.e2); // another walk list
  f.hSouth_keep = await act(f.hSouth, f.p3, f.ada, 'no_soliciting', T('06T15:00:00'));

  // --- legacy (no round) ------------------------------------------------------------------------
  f.hLegacy = await mkHome('Legacy'); // two null-round knocks → one per house
  await act(f.hLegacy, null, f.ada, 'not_home', T('01T12:00:00'));
  f.hLegacy_keep = await act(f.hLegacy, null, f.ben, 'not_home', T('01T13:00:00'));
  // One null and one with NO passId field → two knocks, exactly as knocksPipeline groups them.
  f.hLegacyMixed = await mkHome('LegacyMixed');
  await act(f.hLegacyMixed, null, f.ada, 'not_home', T('01T14:00:00'));
  await CanvassActivity.collection.insertOne({
    organizationId: f.org._id, campaignId: f.camp._id, householdId: f.hLegacyMixed._id, userId: f.ben._id,
    actionType: 'not_home', timestamp: T('01T15:00:00'), effortId: f.e1._id, createdAt: new Date(), updatedAt: new Date(),
  });
  // A survey entry with NO passId field beside its response with passId null: covered, estimate == build.
  f.hLegacySurvey = await mkHome('LegacySurvey');
  f.vLegacy = await mkVoter(f.hLegacySurvey, 'VLEGACY');
  await CanvassActivity.collection.insertOne({
    organizationId: f.org._id, campaignId: f.camp._id, householdId: f.hLegacySurvey._id, userId: f.ada._id,
    actionType: 'survey_submitted', voterId: f.vLegacy._id, timestamp: T('01T16:00:00'), effortId: f.e1._id,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await resp(f.vLegacy, f.hLegacySurvey, null, f.ada, T('01T16:00:00'));

  // --- lit-drop campaign: Lit dropped is sticky ---------------------------------------------------
  f.hLit = await mkHome('Lit', f.lit, f.litEffort);
  f.hLit_keep = await act(f.hLit, f.litPass, f.ada, 'lit_dropped', T('02T15:00:00'));
  await act(f.hLit, f.litPass, f.ben, 'not_home', T('02T16:00:00'));
});

after(async () => {
  await mongoose.disconnect();
});

// -------------------------------------------------------------------------------------------------

test('each pair kind yields one row: the door’s knock result, under that entry’s canvasser', { skip }, async () => {
  const { rows } = await build(f.camp, { onePerKnock: true });
  const homes = byHome(rows);
  const keptId = (h) => homes.get(String(h._id))?.map((r) => r['Activity DB id']);
  // One row per door per round; hNN has two rounds.
  assert.strictEqual(homes.get(String(f.hNN._id)).length, 2, 'hNN: one row per round');
  assert.ok(keptId(f.hNN).includes(String(f.hNN_keep._id)), 'Not home + Not home keeps the later');
  for (const [h, keep] of [
    [f.hRR, f.hRR_keep], [f.hNS, f.hNS_keep], [f.hSN, f.hSN_keep], [f.hNR, f.hNR_keep],
    [f.hSSsame, f.hSSsame_keep], [f.hSSdiff, f.hSSdiff_keep], [f.hSSdnc, f.hSSdnc_keep], [f.hTie, f.hTie_keep],
    [f.hRestr, f.hRestr_keep], [f.hBulkKnock, f.hBulkKnock_keep], [f.hFlagKept, f.hFlagKept_keep], [f.hMulti, f.hMulti_keep],
    [f.hSouth, f.hSouth_keep], [f.hLegacy, f.hLegacy_keep],
  ]) {
    assert.deepStrictEqual(keptId(h), [String(keep._id)], `${h.addressLine1}: kept the expected entry`);
  }
  assert.strictEqual(homes.get(String(f.hLegacyMixed._id)).length, 2, 'a missing and a null round stay apart, as in knocksPipeline');
  assert.ok(!homes.has(String(f.hDeskOnly._id)), 'a desk Restricted mark alone is not a knock');
  assert.ok(!homes.has(String(f.hNoteOnly._id)), 'a note alone is not a knock');
  assert.ok(rows.every((r) => KNOCK_ACTIONS.includes(r.Action)), 'Restricted and Note added never appear');
  // The kept row is one entry whole: the Not home → Surveyed door carries the surveyor's name.
  const ns = homes.get(String(f.hNS._id))[0];
  assert.strictEqual(ns['Canvasser first name'], 'Ben');
  assert.strictEqual(ns.Action, 'survey_submitted');
});

test('the knock rows equal the dashboard’s Knocks in every scope (buildKnocksByPassData)', { skip }, async () => {
  const scopes = [
    { params: {}, knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id })).totals.knocks },
    {
      params: { from: '2026-07-02', to: '2026-07-03' },
      knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id, timestampRange: zonedDayRange('2026-07-02', '2026-07-03', TZ) })).totals.knocks,
    },
    {
      params: { to: '2026-07-04' },
      knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id, timestampRange: zonedDayRange(null, '2026-07-04', TZ) })).totals.knocks,
    },
    { params: { effortId: String(f.e2._id) }, knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id, effortId: f.e2._id })).totals.knocks },
    {
      params: { passId: String(f.p2._id) },
      knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id })).rounds.find((r) => String(r.passId) === String(f.p2._id)).knocks,
    },
    {
      params: { passId: 'legacy' },
      knocks: async () => (await buildKnocksByPassData({ organizationId: f.org._id, campaignId: f.camp._id })).rounds.find((r) => r.passId == null).knocks,
    },
  ];
  for (const s of scopes) {
    const { rows } = await build(f.camp, { onePerKnock: true, ...s.params });
    assert.strictEqual(rows.length, await s.knocks(), `scope ${JSON.stringify(s.params)}: knock rows === Knocks`);
  }
});

test('the kept outcome equals the client report’s for every door-round, exact ties included', { skip }, async () => {
  const { rows } = await build(f.camp, { onePerKnock: true });
  const all = await CanvassActivity.find({ campaignId: f.camp._id, actionType: { $in: KNOCK_ACTIONS } }).sort({ timestamp: 1, _id: 1 }).lean();
  const groups = new Map();
  for (const a of all) {
    const k = `${a.householdId}|${String(a.passId)}`; // buildReportSnapshot's grouping
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const STATUS_OF = { not_home: 'not_home', refused: 'refused', survey_submitted: 'surveyed', no_soliciting: 'no_soliciting', not_target: 'not_target', wrong_address: 'wrong_address', lit_dropped: 'lit_dropped' };
  const keptStatuses = rows.map((r) => STATUS_OF[r.Action]).sort();
  const reportStatuses = [...groups.values()].map((acts) => resolveStatus('survey', acts)).sort();
  assert.deepStrictEqual(keptStatuses, reportStatuses, 'one outcome per door-round, the report’s');
  // The same-millisecond pair keeps the LOWER _id, as resolveStatus's strict `>` keeps the earlier row.
  const tie = rows.find((r) => r['Household DB id'] === String(f.hTie._id));
  assert.strictEqual(tie['Activity DB id'], String(f.hTie_keep._id));
});

test('the outcome boxes pick door results; Restricted and Note added are refused with the option', { skip }, async () => {
  const { rows } = await build(f.camp, { onePerKnock: true, actionTypes: ['not_home'] });
  const homes = byHome(rows);
  assert.ok(!homes.has(String(f.hNS._id)), 'a door one canvasser marked Not home and another surveyed is a Surveyed door');
  assert.ok(!homes.has(String(f.hNR._id)), 'a Refused door is not a Not home door');
  assert.ok(homes.has(String(f.hNN._id)));
  assert.ok(rows.every((r) => r.Action === 'not_home'));
  for (const chip of ['restricted', 'note_added']) {
    await assert.rejects(
      TYPE.validateParams({ onePerKnock: true, actionTypes: ['not_home', chip] }, { organizationId: f.org._id, campaignId: f.camp._id }),
      /One row per knock lists knocks only/
    );
  }
});

test('Lit dropped is sticky on a lit-drop campaign', { skip }, async () => {
  const { rows } = await build(f.lit, { onePerKnock: true });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['Activity DB id'], String(f.hLit_keep._id));
  assert.strictEqual(rows[0].Action, 'lit_dropped');
});

test('a canvasser filter yields that canvasser’s own knocks, desk entries excluded', { skip }, async () => {
  for (const u of [f.ada, f.ben, f.desk]) {
    const { rows } = await build(f.camp, { onePerKnock: true, userId: String(u._id) });
    const own = await CanvassActivity.countDocuments({ campaignId: f.camp._id, userId: u._id, actionType: { $in: KNOCK_ACTIONS }, via: { $ne: 'bulk' } });
    assert.strictEqual(rows.length, own, `${u.firstName}: one row per own entry`);
    assert.ok(rows.every((r) => r['Canvasser first name'] === u.firstName));
  }
});

test('survey answers: the survey rows follow the knock rows, coverage from the rows written; do-not-contact withheld', { skip }, async () => {
  const { rows, ctx, result } = await build(f.camp, { onePerKnock: true, includeSurveyAnswers: true });
  const firstSurvey = rows.findIndex((r) => r['Row source'] === 'survey');
  assert.ok(firstSurvey > 0 && rows.slice(firstSurvey).every((r) => r['Row source'] === 'survey'), 'every survey row comes after every knock row');
  const surveys = surveyRowsOf(rows);
  const surveyVoters = surveys.map((r) => r['Voter DB id']).sort();
  // hSSdiff's dropped person and hMulti's first person; NOT hSSsame (same person), NOT hSSdnc's flagged one.
  assert.deepStrictEqual(surveyVoters, [String(f.vDiffA._id), String(f.vMultiA._id)].sort());
  assert.strictEqual(result.surveyRows, 2);
  // Every response is in the file exactly once: on its knock row or as a survey row (DNC aside).
  const knockResponseIds = knockRowsOf(rows).map((r) => r['Response DB id']).filter(Boolean);
  const surveyResponseIds = surveys.map((r) => r['Response DB id']);
  const ids = [...knockResponseIds, ...surveyResponseIds];
  assert.strictEqual(new Set(ids).size, ids.length, 'no survey printed twice');
  // Withheld: the kept row naming a flagged voter (blanked, counted once) + the dropped flagged survey.
  assert.strictEqual(ctx.counters.excludedDnc, 2);
  const flagRow = rows.find((r) => r['Household DB id'] === String(f.hFlagKept._id));
  assert.strictEqual(flagRow['Voter DB id'], '', 'blanked');
  assert.strictEqual(flagRow['Response DB id'], '', 'no answers on a blanked row');
});

test('estimate == build: rows, withheld and survey rows, across chips, fan, answers and canvasser', { skip }, async () => {
  const combos = [];
  for (const chips of [[], ['not_home'], ['survey_submitted', 'refused']]) {
    for (const perVoterRows of [false, true]) {
      for (const includeSurveyAnswers of [false, true]) {
        for (const userId of [null, String(f.ben._id)]) {
          combos.push({ onePerKnock: true, ...(chips.length ? { actionTypes: chips } : {}), ...(perVoterRows ? { perVoterRows } : {}), ...(includeSurveyAnswers ? { includeSurveyAnswers } : {}), ...(userId ? { userId } : {}) });
        }
      }
    }
  }
  combos.push({ onePerKnock: true, includeSurveyAnswers: true, passId: 'legacy' }, { onePerKnock: true, includeSurveyAnswers: true, from: '2026-07-03', to: '2026-07-05' });
  for (const params of combos) {
    const est = await estimate(f.camp, params);
    const { out, ctx, result } = await build(f.camp, params);
    const label = JSON.stringify(params);
    assert.strictEqual(est.rows, out.rows.length, `${label}: rows`);
    assert.strictEqual(est.dncWithheld, ctx.counters.excludedDnc, `${label}: withheld`);
    assert.strictEqual(est.surveyRows, result.surveyRows, `${label}: survey rows`);
    assert.strictEqual(ctx.counters.total, out.rows.length, `${label}: progress denominator`);
  }
});

test('the coverage key fix: a legacy survey with no passId field is covered, option on and off', { skip }, async () => {
  for (const params of [{ includeSurveyAnswers: true, passId: 'legacy' }, { onePerKnock: true, includeSurveyAnswers: true, passId: 'legacy' }]) {
    const est = await estimate(f.camp, params);
    const { rows } = await build(f.camp, params);
    assert.strictEqual(est.rows, rows.length, `${JSON.stringify(params)}: estimate == build`);
    assert.ok(!surveyRowsOf(rows).some((r) => r['Voter DB id'] === String(f.vLegacy._id)), 'its knock row covers it');
  }
});

test('a timed-out count answers rowsUnavailable, with no number', { skip }, async () => {
  const realCa = CanvassActivity.aggregate;
  const realSr = SurveyResponse.aggregate;
  const boom = () => Object.assign(new Error('operation exceeded time limit'), { codeName: 'MaxTimeMSExpired', code: 50 });
  try {
    // Fail only the per-knock count passes (they end in $facet); anything else runs for real.
    CanvassActivity.aggregate = function (pipeline, ...rest) {
      if (pipeline.some((s) => s.$facet)) throw boom();
      return realCa.call(this, pipeline, ...rest);
    };
    let est = await estimate(f.camp, { onePerKnock: true });
    assert.deepStrictEqual({ rows: est.rows, rowsUnavailable: est.rowsUnavailable }, { rows: null, rowsUnavailable: true });
    CanvassActivity.aggregate = realCa;
    SurveyResponse.aggregate = function (pipeline, ...rest) {
      if (pipeline.some((s) => s.$facet)) throw boom();
      return realSr.call(this, pipeline, ...rest);
    };
    est = await estimate(f.camp, { onePerKnock: true, includeSurveyAnswers: true });
    assert.strictEqual(est.rowsUnavailable, true, 'the survey pass timing out too');
  } finally {
    CanvassActivity.aggregate = realCa;
    SurveyResponse.aggregate = realSr;
  }
});

test('writes during a build leave the file consistent; surveys saved after the start are fenced out', { skip }, async () => {
  const fixtureIds = [];
  const doneHooks = { done: false };
  const before = await build(f.camp, { onePerKnock: true, includeSurveyAnswers: true });
  const { rows } = await build(f.camp, { onePerKnock: true, includeSurveyAnswers: true }, {
    // After the first knock row, the knock aggregation has read the whole ledger: change things.
    afterRow: async (n) => {
      if (n !== 1 || doneHooks.done) return;
      doneHooks.done = true;
      // A re-tap of hNR's kept entry by the same canvasser (delete-then-create, as the route does).
      await CanvassActivity.deleteOne({ _id: f.hNR_keep._id });
      const retap = await CanvassActivity.create({ organizationId: f.org._id, campaignId: f.camp._id, householdId: f.hNR._id, userId: f.ben._id, actionType: 'not_home', timestamp: new Date('2026-07-03T15:30:00Z'), passId: f.p1._id, effortId: f.e1._id, location: { lat: 30.27, lng: -97.74, accuracy: 5 } });
      fixtureIds.push(retap._id);
      // A conversion in place (same _id) of hNN's kept entry, with a desk response.
      await CanvassActivity.updateOne({ _id: f.hNN_keep._id }, { $set: { actionType: 'survey_submitted', voterId: f.vNS._id } });
      // A brand-new door surveyed mid-build: its response must not become a survey row.
      const home = await Household.create({ organizationId: f.org._id, campaignId: f.camp._id, effortId: f.e1._id, addressLine1: '999 New St', city: 'Austin', state: 'TX', zipCode: '78701', normalizedAddress: '999 new st|austin|tx|78701', isActive: true });
      const voter = await Voter.create({ organizationId: f.org._id, campaignId: f.camp._id, householdId: home._id, stateVoterId: 'VNEW', firstName: 'New', lastName: 'Voter', fullName: 'New Voter' });
      const a = await CanvassActivity.create({ organizationId: f.org._id, campaignId: f.camp._id, householdId: home._id, userId: f.ada._id, actionType: 'survey_submitted', voterId: voter._id, timestamp: new Date('2026-07-06T12:00:00Z'), passId: f.p1._id, effortId: f.e1._id, location: { lat: 30.27, lng: -97.74, accuracy: 5 } });
      const r = await SurveyResponse.create({ organizationId: f.org._id, campaignId: f.camp._id, voterId: voter._id, householdId: home._id, userId: f.ada._id, surveyTemplateId: f.template._id, surveyTemplateVersion: 1, submittedAt: new Date('2026-07-06T12:00:00Z'), passId: f.p1._id, effortId: f.e1._id, location: { lat: 30.27, lng: -97.74, accuracy: 5 }, answers: [] });
      fixtureIds.push(a._id);
      f.midBuild = { home, voter, a, r };
    },
  });
  try {
    // The knock rows are the snapshot the aggregation read: the same doors, each once, old entries.
    const ids = (rs) => knockRowsOf(rs).map((r) => r['Activity DB id']).sort();
    assert.deepStrictEqual(ids(rows), ids(before.rows), 'the knock rows are the ones gathered before the writes');
    const nr = rows.find((r) => r['Household DB id'] === String(f.hNR._id));
    assert.strictEqual(nr.Action, 'refused', 'the re-tapped door shows its earlier entry, once');
    const nn = rows.filter((r) => r['Household DB id'] === String(f.hNN._id) && String(r.Pass) === '1');
    assert.strictEqual(nn.length, 1);
    assert.strictEqual(nn[0].Action, 'not_home', 'a conversion after the gathering pass is not in this file');
    assert.ok(!rows.some((r) => r['Household DB id'] === String(f.midBuild.home._id)), 'a door first surveyed mid-build is not in this file, as a knock or a survey row');
    const respIds = rows.map((r) => r['Response DB id']).filter(Boolean);
    assert.strictEqual(new Set(respIds).size, respIds.length, 'no survey printed twice');
  } finally {
    // Put the fixture back for the remaining tests.
    await CanvassActivity.deleteMany({ _id: { $in: fixtureIds } });
    await CanvassActivity.collection.insertOne({ ...f.hNR_keep.toObject() });
    await CanvassActivity.updateOne({ _id: f.hNN_keep._id }, { $set: { actionType: 'not_home' }, $unset: { voterId: '' } });
    await SurveyResponse.deleteOne({ _id: f.midBuild.r._id });
    await Voter.deleteOne({ _id: f.midBuild.voter._id });
    await Household.deleteOne({ _id: f.midBuild.home._id });
  }
});

test('the knock rows scan {campaignId: 1}, in saved order', { skip }, async () => {
  const ctx = await makeCtx(f.camp, { onePerKnock: true, from: '2026-07-02', to: '2026-07-03' });
  const plan = JSON.stringify(await knockRowsAggregate(ctx).explain());
  assert.match(plan, /campaignId_1(?!_)/, 'the hint picks the single-field campaign index');
});

test('the eight file names are distinct, and the download slug follows', { skip }, () => {
  const names = new Set();
  for (const onePerKnock of [false, true]) {
    for (const perVoterRows of [false, true]) {
      for (const includeSurveyAnswers of [false, true]) {
        const n = activityFileNames({ onePerKnock, perVoterRows, includeSurveyAnswers });
        names.add(n.file);
        assert.strictEqual(n.slug, n.file.replace('activity-log', 'canvass-activity'));
        assert.strictEqual(TYPE.fileSlug({ onePerKnock, perVoterRows, includeSurveyAnswers }), n.slug);
      }
    }
  }
  assert.strictEqual(names.size, 8);
  assert.ok(names.has('activity-log-per-knock-with-surveys'));
});

test('the job record: surveyRowCount for per-knock files only, zeroed on a retry', { skip }, async () => {
  const run = async (params, preset = {}) => {
    const job = await ExportJob.create({ organizationId: f.org._id, campaignId: f.camp._id, type: 'canvass-activity', params: { ...params, anchorTz: TZ }, requestedBy: f.ada._id, ...preset });
    await processExportJob({ data: { exportJobId: String(job._id) }, id: `t-${job._id}`, attemptsMade: 1, opts: { attempts: 3 } });
    return ExportJob.findById(job._id).lean();
  };
  const perKnock = await run({ onePerKnock: true, includeSurveyAnswers: true });
  assert.strictEqual(perKnock.status, 'completed', perKnock.error);
  assert.strictEqual(perKnock.surveyRowCount, 2);
  assert.match(perKnock.artifact.filename, /-canvass-activity-per-knock-with-surveys-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.deepStrictEqual(Object.keys(perKnock.files[0]).sort(), ['name', 'rows'], 'files[] keeps its shape');
  const plain = await run({ includeSurveyAnswers: true });
  assert.strictEqual(plain.surveyRowCount, 0, 'a plain file’s rows are entries, not knocks: no split');
  const retried = await run({ onePerKnock: true }, { surveyRowCount: 99 });
  assert.strictEqual(retried.surveyRowCount, 0, 'the reset zeroes it; no survey rows without answers');
});

test('a missing {campaignId: 1} index fails ONCE, with the reason (not three generic retries)', { skip }, async () => {
  await CanvassActivity.collection.dropIndex('campaignId_1');
  try {
    const job = await ExportJob.create({ organizationId: f.org._id, campaignId: f.camp._id, type: 'canvass-activity', params: { onePerKnock: true, anchorTz: TZ }, requestedBy: f.ada._id });
    let thrown = null;
    try {
      await processExportJob({ data: { exportJobId: String(job._id) }, id: `t-${job._id}`, attemptsMade: 1, opts: { attempts: 3 } });
    } catch (err) {
      thrown = err;
    }
    assert.strictEqual(thrown?.name, 'UnrecoverableError', 'no retry cycle for a missing index');
    const doc = await ExportJob.findById(job._id).lean();
    assert.strictEqual(doc.status, 'failed');
    assert.match(doc.error, /index it needs is missing/);
    // The plain file never names the index: it still builds.
    const plain = await ExportJob.create({ organizationId: f.org._id, campaignId: f.camp._id, type: 'canvass-activity', params: { anchorTz: TZ }, requestedBy: f.ada._id });
    await processExportJob({ data: { exportJobId: String(plain._id) }, id: `t-${plain._id}`, attemptsMade: 1, opts: { attempts: 3 } });
    assert.strictEqual((await ExportJob.findById(plain._id).lean()).status, 'completed');
  } finally {
    await CanvassActivity.createIndexes();
  }
});

test('the model declares the {campaignId: 1} index the per-knock rows hint', { skip }, () => {
  // The release's build-indexes dry run lists only DECLARED indexes, and `--sync` drops undeclared ones;
  // the index is a prefix of three compound campaignId indexes, exactly what a cleanup would remove.
  assert.ok(CanvassActivity.schema.indexes().some(([k]) => JSON.stringify(k) === '{"campaignId":1}'));
});
