import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Export Center builder correctness on one seeded fixture:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/exportbuilders_test node --test test/exportBuilders.int.test.js
// The heart of the suite is REGISTRY-DRIVEN: the DNC/price sweep iterates EXPORT_TYPES, so
// a new export type is under the "flagged voter appears in NO artifact" guarantee the day
// it is added — DNC exclusion is inherited, not remembered. Also pinned here: anchor-tz
// date columns, the door-unit blank-not-drop rule, bulk labeling, deleted-user identity
// (name yes, tombstone email never), vendor-header reconstruction with the duplicate-header
// collapse, hand-edit show-through, voters-filtered === resolveWalkList, survey wide/long
// units incl. the twice-surveyed voter, orphaned-row honesty, Σ rounds === totals, the
// formula-injection guard end to end, and pricePerCampaignCents never reaching any artifact.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-exportbuilders';
// Level 0 = stored blocks: ZIP artifact bytes stay greppable, so the sweep can assert on
// the full-backup without a zip-reader dependency.
process.env.EXPORT_ZIP_LEVEL = '0';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const { openArtifactDownloadStream } = await import('../src/services/export/exportArtifactStore.js');
const { resolveWalkList } = await import('../src/services/walklist/resolveWalkList.js');
const { buildKnocksByPassData } = await import('../src/services/reports/knocksByPass.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};
const TZ = 'America/Chicago';
const PRICE = 987654; // distinctive select:false value that must never reach an artifact

const fakeQueueJob = (id) => ({ data: { exportJobId: String(id) }, id: `t-${id}`, attemptsMade: 1, opts: { attempts: 3 } });

const readArtifact = (jobId) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const s = openArtifactDownloadStream(jobId);
    s.on('data', (c) => chunks.push(c));
    s.on('error', reject);
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

// Create → process → return { doc, text }.
async function runExport(type, params = {}, { campaignId = 'default' } = {}) {
  const job = await ExportJob.create({
    organizationId: ctx.org._id,
    campaignId: campaignId === 'default' ? ctx.camp._id : campaignId,
    type,
    params: { ...params, anchorTz: TZ },
    requestedBy: ctx.uAda._id,
  });
  await processExportJob(fakeQueueJob(job._id));
  const doc = await ExportJob.findById(job._id).lean();
  assert.strictEqual(doc.status, 'completed', `${type} export completed (error: ${doc.error})`);
  const text = await readArtifact(job._id);
  return { doc, text };
}

const csvLines = (text) => text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  ctx.org = await Organization.create({ name: 'Builder Org', slug: 'builder-org', isActive: true });
  ctx.uAda = await User.create({ firstName: 'Ada', lastName: 'Knocks', email: 'ada@b.test', passwordHash: 'h', isActive: true });
  ctx.uCoord = await User.create({ firstName: 'Cora', lastName: 'Coord', email: 'cora@b.test', passwordHash: 'h', isActive: true });
  // A deleted canvasser: scrubbed User + name snapshot. hydrateCanvassers must render the
  // snapshot name and NEVER the tombstone email.
  ctx.uDel = await User.create({
    firstName: 'Deleted', lastName: 'user', email: 'del-tomb@deleted.doorline.invalid',
    passwordHash: 'h', isActive: false, deletedAt: new Date(),
  });
  await DeletedUserRecord.create({
    userId: ctx.uDel._id, firstName: 'Del', lastName: 'Eted',
    organizationIds: [ctx.org._id], deletedAt: new Date(),
    retentionUntil: new Date(Date.now() + 180 * 86400000),
  });
  for (const u of [ctx.uAda, ctx.uCoord]) {
    await Membership.create({ userId: u._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  }

  ctx.camp = await Campaign.create({
    organizationId: ctx.org._id, name: 'Ward 4', type: 'survey', state: 'TX',
    timeZone: TZ, pricePerCampaignCents: PRICE,
  });

  ctx.e1 = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'North Side' });
  ctx.e2 = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'South Side' });
  ctx.p1 = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.e1._id, roundNumber: 1, name: 'First knock', status: 'active', activatedAt: new Date('2026-06-20T00:00:00Z') });
  ctx.p2 = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.e1._id, roundNumber: 2, name: 'Re-knock', status: 'active', activatedAt: new Date('2026-07-05T00:00:00Z') });
  ctx.p3 = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.e2._id, roundNumber: 1, name: 'South first', status: 'active', activatedAt: new Date('2026-06-25T00:00:00Z') });

  const mkHome = (n, effortId, extra = {}) =>
    Household.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId,
      addressLine1: `${n} Oak St`, city: 'Austin', state: 'TX', zipCode: '78701', county: 'Travis',
      normalizedAddress: `${n} oak st austin tx 78701`, precinctValue: 'P-7',
      location: { type: 'Point', coordinates: [-97.74 + n / 1000, 30.27] },
      ...extra,
    });
  ctx.h1 = await mkHome(1, ctx.e1._id);
  ctx.h2 = await mkHome(2, ctx.e1._id);
  ctx.h3 = await mkHome(3, ctx.e1._id);
  ctx.h4 = await mkHome(4, ctx.e2._id);
  ctx.h5 = await mkHome(5, ctx.e1._id, { fullyDnc: true });

  const mkVoter = (home, sv, first, last, party, extra = {}) =>
    Voter.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: home._id,
      stateVoterId: sv, firstName: first, lastName: last, fullName: `${first} ${last}`, party,
      ...extra,
    });
  ctx.alice = await mkVoter(ctx.h1, 'SV1', 'Alice', 'Able', 'DEM');
  ctx.donna = await mkVoter(ctx.h1, 'SVDNC1', 'Donna', 'Dncerson', 'REP', {
    doNotContact: { flagged: true, at: new Date(), reason: 'asked at door', source: 'admin' },
  });
  ctx.frank = await mkVoter(ctx.h2, 'SV2', '=HYPERLINK("http://evil","x")', 'Formula', 'DEM');
  ctx.carol = await mkVoter(ctx.h3, 'SV3', 'Carol', 'Errorson', 'REP'); // not in insertedVoterIds — the "error row"
  ctx.dave = await mkVoter(ctx.h4, 'SV4', 'Dave', 'Doorman', 'DEM');
  ctx.edna = await mkVoter(ctx.h5, 'SVDNC2', 'Edna', 'Dncerson', 'REP', {
    doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'upload' },
  });

  const loc = { lat: 30.27, lng: -97.74, accuracy: 5 };
  const mkAct = (home, pass, user, actionType, ts, extra = {}) =>
    CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: home._id,
      userId: user._id, actionType, timestamp: new Date(ts), location: loc,
      passId: pass ? pass._id : null, effortId: home.effortId, turfId: null,
      ...extra,
    });
  // P1: Alice surveyed (team Cora), Frank's door not-home by the DELETED canvasser,
  // h5 bulk-restricted from the desk. P2: h1 re-knocked; Donna (DNC) refused — the row
  // must survive with voter identity blanked. P3: Dave surveyed. Legacy: pre-turf not_home.
  await mkAct(ctx.h1, ctx.p1, ctx.uAda, 'survey_submitted', '2026-07-01T15:00:00Z', { voterId: ctx.alice._id, coordinatorId: ctx.uCoord._id });
  await mkAct(ctx.h2, ctx.p1, ctx.uDel, 'not_home', '2026-07-02T16:30:00Z');
  await mkAct(ctx.h5, ctx.p1, ctx.uAda, 'restricted', '2026-07-02T17:00:00Z', { via: 'bulk' });
  await mkAct(ctx.h1, ctx.p2, ctx.uAda, 'not_home', '2026-07-10T15:00:00Z');
  await mkAct(ctx.h1, ctx.p2, ctx.uAda, 'refused', '2026-07-11T15:00:00Z', { voterId: ctx.donna._id });
  await mkAct(ctx.h4, ctx.p3, ctx.uAda, 'survey_submitted', '2026-07-03T18:00:00Z', { voterId: ctx.dave._id });
  await mkAct(ctx.h3, null, ctx.uAda, 'not_home', '2026-06-01T12:00:00Z');

  ctx.template = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'Door Survey', version: 1,
    questions: [
      {
        key: 'support', label: 'Do you support?', type: 'single_choice', order: 0,
        options: [{ id: 'o-yes', text: 'Yes', order: 0 }, { id: 'o-no', text: 'No', order: 1, retired: true }],
      },
      { key: 'notes2', label: 'Anything else?', type: 'text', order: 1, options: [] },
    ],
  });
  const mkResp = (voter, home, pass, ts, answers) =>
    SurveyResponse.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id,
      voterId: voter._id ?? voter, householdId: home._id, userId: ctx.uAda._id,
      surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1,
      submittedAt: new Date(ts), location: loc,
      passId: pass._id, effortId: home.effortId,
      answers,
    });
  await mkResp(ctx.alice, ctx.h1, ctx.p1, '2026-07-01T15:05:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
    { questionKey: 'notes2', questionLabel: 'Anything else?', answer: 'love it', optionIds: [] },
  ]);
  await mkResp(ctx.alice, ctx.h1, ctx.p2, '2026-07-10T15:05:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'No', optionIds: ['o-no'] },
  ]);
  await mkResp(ctx.donna, ctx.h1, ctx.p1, '2026-07-01T15:10:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
  ]);
  await mkResp(ctx.dave, ctx.h4, ctx.p3, '2026-07-03T18:05:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
  ]);
  // Orphan: the voter row was removed by an import undo — dropped AND counted.
  await mkResp(new mongoose.Types.ObjectId(), ctx.h1, ctx.p1, '2026-07-01T15:20:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
  ]);

  ctx.importJob = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, filename: 'vendor.csv',
    kind: 'apply', status: 'completed', totalRows: 5,
    // Includes the real duplicate: registeredState AND state both map to 'Registered State'.
    fieldMapping: {
      stateVoterId: 'State Voter ID', firstName: 'First Name', lastName: 'Last Name',
      party: 'Party', registeredState: 'Registered State',
      addressLine1: 'Address', city: 'City', state: 'Registered State', zipCode: 'Zip Code',
    },
    insertedVoterIds: [ctx.alice._id, ctx.donna._id, ctx.frank._id, ctx.dave._id], // Carol errored out
  });

  ctx.savedSearch = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Dems',
    filter: { parties: ['DEM'] }, source: 'filter', householdIds: [], voterIds: [],
  });

  await VoterNote.create({ organizationId: ctx.org._id, voterId: ctx.alice._id, authorId: ctx.uAda._id, body: 'Great convo about parks' });
  await VoterNote.create({ organizationId: ctx.org._id, voterId: ctx.donna._id, authorId: ctx.uAda._id, body: 'asked us not to come back' });

  // Post-"import" hand edit: the reconstruction shows current data, not the uploaded value.
  await Voter.updateOne({ _id: ctx.alice._id }, { $set: { party: 'IND', locallyEditedFields: ['party'] } });
});

after(async () => {
  await mongoose.disconnect();
});

// ---- the registry-driven sweep ---------------------------------------------------------

test('EVERY export type: no DNC voter identity, no select:false price, in any artifact', { skip }, async () => {
  const paramsFor = async (type) => {
    if (type === 'voters-filtered') {
      return EXPORT_TYPES[type].validateParams(
        { savedSearchId: String(ctx.savedSearch._id) },
        { organizationId: ctx.org._id, campaignId: ctx.camp._id }
      );
    }
    return {};
  };
  ctx.artifacts = {};
  for (const type of Object.keys(EXPORT_TYPES)) {
    const { doc, text } = await runExport(type, await paramsFor(type));
    ctx.artifacts[type] = { doc, text };
    for (const leak of ['Donna', 'Dncerson', 'SVDNC1', 'Edna', 'SVDNC2']) {
      assert.ok(!text.includes(leak), `${type}: DNC identity "${leak}" must not appear`);
    }
    assert.ok(!text.includes(String(PRICE)), `${type}: pricePerCampaignCents must never reach an artifact`);
    assert.ok(!text.includes('del-tomb'), `${type}: a deleted user's tombstone email must never leak`);
  }
  // Control: the sweep can actually SEE content (level-0 ZIP included). voters-filtered's
  // control is Dave — Alice's hand-edit (party DEM→IND in the fixture) correctly drops her
  // from the DEM saved search.
  for (const type of ['canvass-activity', 'survey-results', 'survey-answers', 'voter-file', 'full-backup']) {
    assert.ok(ctx.artifacts[type].text.includes('Able'), `${type}: control voter visible`);
  }
  assert.ok(ctx.artifacts['voters-filtered'].text.includes('Doorman'), 'voters-filtered: control voter visible');
  assert.ok(ctx.artifacts['full-backup'].text.includes('manifest.json'), 'backup carries its manifest');
  assert.ok(ctx.artifacts['full-backup'].text.includes('README.txt'), 'backup carries its README');
});

// ---- canvass-activity ------------------------------------------------------------------

test('canvass-activity: anchor-tz columns, DNC row blanked not dropped, bulk labeled, deleted-user name', { skip }, async () => {
  const { doc, text } = ctx.artifacts['canvass-activity'];
  const lines = csvLines(text);
  assert.strictEqual(doc.rowCount, 7, 'all 7 ledger rows — including the blanked DNC row');
  assert.strictEqual(doc.excludedDncCount, 1, 'one identity withheld');
  assert.strictEqual(lines.length, 8, 'header + 7 rows');

  // 2026-07-01T15:00:00Z in America/Chicago (CDT) = 10:00:00 on the same day.
  const aliceRow = lines.find((l) => l.includes('2026-07-01T15:00:00.000Z'));
  assert.match(aliceRow, /2026-07-01,10:00:00/, 'Date/Time render in the campaign anchor tz');
  assert.match(aliceRow, /Cora Coord/, 'frozen coordinator renders as the Team');

  const donnaRow = lines.find((l) => l.includes('refused'));
  assert.ok(donnaRow, 'the DNC voter’s refused knock stays in the ledger');
  assert.ok(!donnaRow.includes('Donna') && !donnaRow.includes('SVDNC1'), 'with identity blanked');

  const bulkRow = lines.find((l) => l.includes('restricted'));
  assert.match(bulkRow, /,bulk,/, 'desk-authored rows carry Via=bulk');

  const delRow = lines.find((l) => l.includes('2026-07-02T16:30:00.000Z'));
  assert.match(delRow, /Del,Eted,deleted/, 'deleted canvasser resolves to the snapshot name + standing');

  const legacyRow = lines.find((l) => l.includes('2026-06-01T12:00:00.000Z'));
  assert.match(legacyRow, /Legacy \/ no pass/, 'pre-turf rows land in the legacy bucket');
});

// ---- doors-by-round + Σ invariant ------------------------------------------------------

test('doors-by-round reconciles to knocks-by-pass; Σ rounds === totals', { skip }, async () => {
  const { text } = ctx.artifacts['doors-by-round'];
  const lines = csvLines(text);
  const header = lines[0].split(',');
  const statusIdx = header.indexOf('Round status');
  const passIdx = header.indexOf('Pass');
  const walkIdx = header.indexOf('Walk list');
  assert.ok(statusIdx > 0 && passIdx > 0, 'columns present');

  const built = await buildKnocksByPassData({ organizationId: ctx.org._id, campaignId: ctx.camp._id });
  assert.strictEqual(
    built.rounds.reduce((s, r) => s + r.knocks, 0),
    built.totals.knocks,
    'Σ rounds === totals (knocksPipeline both sides)'
  );

  // Per-pass reconciliation: file rows with a knocked status === that round's knocks.
  for (const round of built.rounds.filter((r) => r.passId)) {
    const fileKnocked = lines.slice(1).filter((l) => {
      const cells = l.split(',');
      return cells[walkIdx] === round.effortName &&
        String(cells[passIdx]) === String(round.roundNumber) &&
        !['unknocked', 'restricted'].includes(cells[statusIdx]);
    }).length;
    assert.strictEqual(fileKnocked, round.knocks, `pass ${round.roundLabel} reconciles`);
  }
});

// ---- surveys ---------------------------------------------------------------------------

test('survey-results (wide): one row per response, current option text, orphans counted', { skip }, async () => {
  const { doc, text } = ctx.artifacts['survey-results'];
  const lines = csvLines(text);
  assert.strictEqual(doc.rowCount, 3, 'r-alice-p1, r-alice-p2, r-dave — DNC and orphan dropped');
  assert.strictEqual(doc.excludedDncCount, 1);
  assert.strictEqual(doc.orphanedRows, 1, 'import-undo orphan dropped AND counted');
  assert.strictEqual(lines.filter((l) => l.includes('Able')).length, 2, 'the twice-surveyed voter is two rows ("Surveys taken")');
  assert.match(lines[0], /Do you support\?/, 'question label is a column');
  const round2 = lines.find((l) => l.includes('2026-07-10'));
  assert.match(round2, /,No,|,No$/, 'retired option id still resolves to its current text');
});

test('survey-answers (long): one row per answer entry, snapshot text', { skip }, async () => {
  const { doc, text } = ctx.artifacts['survey-answers'];
  assert.strictEqual(doc.rowCount, 4, '2 answers (r1) + 1 (r2) + 1 (dave); DNC + orphan dropped');
  assert.match(csvLines(text)[0], /Question key,Answer,Option ids/, 'snapshot columns present');
  assert.ok(text.includes('love it'), 'free-text snapshot preserved');
  assert.ok(text.includes('o-yes'), 'stable option ids exported for joins');
});

// ---- voter files -----------------------------------------------------------------------

test('voter-file (current roster): DNC absent, formula guard applied end to end', { skip }, async () => {
  const { doc, text } = ctx.artifacts['voter-file'];
  assert.strictEqual(doc.rowCount, 4, 'alice, frank, carol, dave — both DNC voters absent');
  assert.strictEqual(doc.excludedDncCount, 2);
  assert.ok(text.includes(`"'=HYPERLINK`), 'hostile voter name is neutralized, not executable');
});

test('voter-file (per-import): vendor headers deduped, error row absent, hand-edit shows through', { skip }, async () => {
  const { doc, text } = await runExport('voter-file', { importJobId: String(ctx.importJob._id) });
  const lines = csvLines(text);
  assert.strictEqual(
    lines[0],
    'State Voter ID,First Name,Last Name,Party,Registered State,Address,City,Zip Code,Household DB id,Voter DB id',
    'the vendor’s own headers, in canonical order, duplicate collapsed first-wins'
  );
  assert.strictEqual(doc.rowCount, 3, 'insertedVoterIds minus the DNC voter');
  assert.ok(!text.includes('Carol'), 'the error row never became a voter — honestly absent');
  const aliceLine = lines.find((l) => l.includes('SV1'));
  assert.match(aliceLine, /,IND,/, 'a post-import hand edit shows through (reconstruction, not the original file)');
});

test('voters-filtered: row set equals resolveWalkList’s live resolution', { skip }, async () => {
  const { doc } = ctx.artifacts['voters-filtered'];
  const resolved = await resolveWalkList(await Campaign.findById(ctx.camp._id).lean(), { parties: ['DEM'] }, {});
  assert.strictEqual(doc.rowCount, resolved.voterIds.length, 'no double-exclusion drift vs resolveWalkList');
  assert.strictEqual(doc.rowCount, 2, 'frank + dave — Alice’s hand-edit (DEM→IND) drops her from the DEM search');
});

// ---- notes -----------------------------------------------------------------------------

test('voter-notes: DNC voters’ notes dropped entirely', { skip }, async () => {
  const { doc, text } = ctx.artifacts['voter-notes'];
  assert.strictEqual(doc.rowCount, 1);
  assert.ok(text.includes('Great convo about parks'));
  assert.ok(!text.includes('asked us not to come back'), 'the opt-out note itself must not ship');
});
