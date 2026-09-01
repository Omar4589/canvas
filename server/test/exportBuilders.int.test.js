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
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');
const { loadDncVoterIdSet } = await import('../src/services/export/exportScope.js');
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
  // h6 has NO voters: the zero-roster control for the per-voter fan (perVoterRows). Its knock must
  // come out as exactly one blank row, byte-identical to h5's (every voter flagged) — or the
  // presence/absence of rows becomes the do-not-contact marker the door-unit rule forbids.
  ctx.h6 = await mkHome(6, ctx.e1._id);

  const mkVoter = (home, sv, first, last, party, extra = {}) =>
    Voter.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: home._id,
      stateVoterId: sv, firstName: first, lastName: last, fullName: `${first} ${last}`, party,
      ...extra,
    });
  // uid = the vendor's import UID; the flagged voters get one too so the registry-driven
  // sweep below proves the UID column is under the same no-leak guarantee as the name.
  // Alice carries the full contact/demographic set: she is the control for the opt-in
  // detail block on the two survey exports (includeVoterDetail).
  ctx.alice = await mkVoter(ctx.h1, 'SV1', 'Alice', 'Able', 'DEM', {
    uid: 'UAL1',
    phone: '512-555-0101', phoneType: 'Landline', cellPhone: '512-555-0199',
    gender: 'F', dateOfBirth: new Date('1979-03-04T00:00:00Z'),
    precinct: 'PCT-7', congressionalDistrict: 'TX-35',
    stateSenateDistrict: 'SD-14', stateHouseDistrict: 'HD-49',
  });
  // The flagged voters carry sentinel contact data for the same reason they carry a uid: the
  // registry-driven sweep below proves a do-not-contact person's PHONE and DATE OF BIRTH are
  // under the same "appears in NO artifact" guarantee as their name.
  ctx.donna = await mkVoter(ctx.h1, 'SVDNC1', 'Donna', 'Dncerson', 'REP', {
    uid: 'UIDDNC1',
    phone: '555-DNCPHONE-1', cellPhone: '555-DNCCELL-1', dateOfBirth: new Date('1911-11-11T00:00:00Z'),
    doNotContact: { flagged: true, at: new Date(), reason: 'asked at door', source: 'admin' },
  });
  ctx.frank = await mkVoter(ctx.h2, 'SV2', '=HYPERLINK("http://evil","x")', 'Formula', 'DEM');
  // Bea shares Frank's door: h2 is the one door with TWO kept voters, which is what makes the
  // per-voter fan distinguishable from a no-op — every other door fans to at most one row.
  ctx.bea = await mkVoter(ctx.h2, 'SV5', 'Bea', 'Beeson', 'IND', { uid: 'UBEA1' });
  ctx.carol = await mkVoter(ctx.h3, 'SV3', 'Carol', 'Errorson', 'REP'); // not in insertedVoterIds — the "error row"
  ctx.dave = await mkVoter(ctx.h4, 'SV4', 'Dave', 'Doorman', 'DEM', { uid: 'UDAV1' });
  ctx.edna = await mkVoter(ctx.h5, 'SVDNC2', 'Edna', 'Dncerson', 'REP', {
    uid: 'UIDDNC2',
    phone: '555-DNCPHONE-2', cellPhone: '555-DNCCELL-2', dateOfBirth: new Date('1911-11-11T00:00:00Z'),
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
  // h5 bulk-restricted from the desk, plus a survey whose voter row is GONE (dangling
  // voterId — row kept with blank identity, counted as orphaned). P2: h1 re-knocked;
  // Donna (DNC) refused — the row must survive with voter identity blanked. P3: Dave
  // surveyed. Legacy: pre-turf not_home.
  await mkAct(ctx.h1, ctx.p1, ctx.uAda, 'survey_submitted', '2026-07-01T15:00:00Z', { voterId: ctx.alice._id, coordinatorId: ctx.uCoord._id });
  await mkAct(ctx.h2, ctx.p1, ctx.uDel, 'not_home', '2026-07-02T16:30:00Z');
  await mkAct(ctx.h2, ctx.p1, ctx.uAda, 'survey_submitted', '2026-07-02T18:00:00Z', { voterId: new mongoose.Types.ObjectId() });
  await mkAct(ctx.h5, ctx.p1, ctx.uAda, 'restricted', '2026-07-02T17:00:00Z', { via: 'bulk', note: 'gate code changed' });
  await mkAct(ctx.h1, ctx.p2, ctx.uAda, 'not_home', '2026-07-10T15:00:00Z', { note: 'dogs in yard, come back PM' });
  await mkAct(ctx.h1, ctx.p2, ctx.uAda, 'refused', '2026-07-11T15:00:00Z', { voterId: ctx.donna._id, note: 'DOORNOTE-ON-FLAGGED-ROW' });
  await mkAct(ctx.h4, ctx.p3, ctx.uAda, 'survey_submitted', '2026-07-03T18:00:00Z', { voterId: ctx.dave._id });
  await mkAct(ctx.h3, null, ctx.uAda, 'not_home', '2026-06-01T12:00:00Z');
  // Per-voter fan controls: h6 is a knock at a door with nobody registered, and the second h1
  // not_home (P1, an hour before Alice's survey) proves the fan repeats per ACTIVITY, not per
  // door — h1 now carries two voter-less knocks that must each fan to Alice alone.
  await mkAct(ctx.h6, ctx.p1, ctx.uAda, 'not_home', '2026-07-04T16:00:00Z');
  await mkAct(ctx.h1, ctx.p1, ctx.uAda, 'not_home', '2026-07-01T14:00:00Z');

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
  // A PRESERVED (overwritten) response with sentinel content: the archive collection must be
  // structurally invisible to every export type — the sweep below asserts the sentinels never
  // reach any artifact, putting SurveyResponseArchive under the same never-leaks guarantee as
  // DNC identity.
  await SurveyResponseArchive.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    voterId: ctx.alice._id, householdId: ctx.h1._id, userId: ctx.uAda._id,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1,
    submittedAt: new Date('2026-07-01T14:00:00Z'), location: loc,
    passId: ctx.p1._id, effortId: ctx.h1.effortId,
    answers: [{ questionKey: 'support', questionLabel: 'Do you support?', answer: 'ARCHIVED-ANSWER-SENTINEL', optionIds: [] }],
    note: 'ARCHIVED-NOTE-SENTINEL',
    overwrittenBy: ctx.uAda._id, overwrittenVia: 'submit', overwrittenAt: new Date('2026-07-01T15:05:00Z'),
  });
  await mkResp(ctx.alice, ctx.h1, ctx.p2, '2026-07-10T15:05:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'No', optionIds: ['o-no'] },
  ]);
  await mkResp(ctx.donna, ctx.h1, ctx.p1, '2026-07-01T15:10:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
  ]);
  await mkResp(ctx.dave, ctx.h4, ctx.p3, '2026-07-03T18:05:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
  ]);
  // Orphan: the voter row was removed by an import undo — dropped AND counted. TWO answers
  // on purpose: orphanedRows is per-RESPONSE in the wide file but per-ANSWER in the long
  // file, and a single-answer orphan would let the two units pass for each other.
  await mkResp(new mongoose.Types.ObjectId(), ctx.h1, ctx.p1, '2026-07-01T15:20:00Z', [
    { questionKey: 'support', questionLabel: 'Do you support?', answer: 'Yes', optionIds: ['o-yes'] },
    { questionKey: 'notes2', questionLabel: 'Anything else?', answer: 'orphaned text', optionIds: [] },
  ]);

  // Notes on the fixture, so the `notes` export is exercised by the registry-driven sweep at all
  // (a builder whose sources are all empty passes every no-leak assertion vacuously):
  //  - h1 carries Alice (clean) AND Donna (flagged), so the opt-in door roster on h1's not_home
  //    note is the leak test for that column;
  //  - the refused row NAMES Donna, so it is the leak test for a door row's OWN identity columns;
  //  - h5 is fullyDnc with only Edna, so its note pins the empty-roster / count-0 case;
  //  - Donna's survey note is voter-unit and must vanish entirely, body and all.
  await SurveyResponse.updateOne(
    { voterId: ctx.donna._id },
    { $set: { note: 'DNCSURVEYNOTE-SENTINEL' } },
  );

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
    // The door roster is opt-in, so the sweep would never even render the column it most needs
    // to police. Turn it ON here: h1's note then has a flagged voter one seat away from the list.
    if (type === 'notes') return { includeDoorVoters: true };
    return {};
  };
  ctx.artifacts = {};
  // The per-voter fan is opt-in too, and it is the largest new linkage in the Center (a knock
  // repeated against every name at the door): sweep it as a SECOND keyed artifact, so the
  // canvass-activity assertions below keep reading the default file.
  const runs = Object.keys(EXPORT_TYPES).map((type) => [type, type]);
  runs.push(['canvass-activity', 'canvass-activity:fanned']);
  for (const [type, key] of runs) {
    const params = key === 'canvass-activity:fanned' ? { perVoterRows: true } : await paramsFor(type);
    const { doc, text } = await runExport(type, params);
    ctx.artifacts[key] = { doc, text };
    for (const leak of [
      'Donna', 'Dncerson', 'SVDNC1', 'Edna', 'SVDNC2', 'UIDDNC1', 'UIDDNC2',
      // contact/demographic cells are identity too — same guarantee as the name
      '555-DNCPHONE-1', '555-DNCPHONE-2', '555-DNCCELL-1', '555-DNCCELL-2', '1911-11-11',
    ]) {
      assert.ok(!text.includes(leak), `${key}: DNC identity "${leak}" must not appear`);
    }
    for (const leak of ['ARCHIVED-ANSWER-SENTINEL', 'ARCHIVED-NOTE-SENTINEL']) {
      assert.ok(!text.includes(leak), `${key}: a preserved (overwritten) response must never reach an artifact`);
    }
    assert.ok(!text.includes(String(PRICE)), `${key}: pricePerCampaignCents must never reach an artifact`);
    assert.ok(!text.includes('del-tomb'), `${key}: a deleted user's tombstone email must never leak`);
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
  assert.strictEqual(doc.rowCount, 10, 'all 10 ledger rows — including the blanked DNC row and the dangling-voter row');
  assert.strictEqual(doc.excludedDncCount, 1, 'one identity withheld');
  assert.strictEqual(doc.orphanedRows, 1, 'the dangling voterId is counted, not silently blank');
  assert.strictEqual(lines.length, 11, 'header + 10 rows');
  assert.strictEqual(doc.files[0].name, 'activity-log', 'the default grain keeps the default file name');
  assert.match(doc.artifact.filename, /-canvass-activity-\d{4}-\d{2}-\d{2}\.csv$/, '…and the default download name');
  assert.match(lines[0], /State voter ID,UID,Voter first name/, 'identity columns: renamed state id + the import UID');

  // 2026-07-01T15:00:00Z in America/Chicago (CDT) = 10:00:00 on the same day.
  const aliceRow = lines.find((l) => l.includes('2026-07-01T15:00:00.000Z'));
  assert.match(aliceRow, /2026-07-01,10:00:00/, 'Date/Time render in the campaign anchor tz');
  assert.match(aliceRow, /SV1,UAL1,Alice/, 'a voter-attached row carries state id + UID');
  assert.match(aliceRow, /Cora Coord/, 'frozen coordinator renders as the Team');

  const danglingRow = lines.find((l) => l.includes('2026-07-02T18:00:00.000Z'));
  assert.ok(danglingRow, 'the dangling-voter survey row stays in the ledger');
  assert.ok(!danglingRow.includes('Able') && !danglingRow.includes('UAL1'), 'with voter identity blank');

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

// ---- canvass-activity: one row per voter at the door (perVoterRows) ---------------------

// The fixture arithmetic the assertions below lean on — voter-less rows and their KEPT rosters:
//   h2 not_home            → Frank, Bea   (2)
//   h1 not_home (P1)       → Alice        (1 — Donna is flagged and simply absent)
//   h1 not_home (P2)       → Alice        (1)
//   h3 not_home (legacy)   → Carol        (1)
//   h5 restricted (bulk)   → nobody kept (Edna flagged) → the ONE blank fallback row
//   h6 not_home            → nobody registered          → the ONE blank fallback row
// plus the 4 rows that already name a voter (two surveys, Donna's refused, the dangling survey),
// which are never fanned: 4 + 2 + 1 + 1 + 1 + 1 + 1 = 11.
const UNFANNED_ROWS = 10;
const FANNED_ROWS = 11;
// RFC-4180 cell split for the assertions that index into a row: the fixture's hostile voter name
// carries a comma inside a quoted cell, so a naive split(',') shifts every column after it.
const cellsOf = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

test('perVoterRows: voter-less knocks repeat per kept voter; empty rosters keep ONE blank row; named rows untouched', { skip }, async () => {
  const off = ctx.artifacts['canvass-activity'];
  const { doc, text } = ctx.artifacts['canvass-activity:fanned'];
  const lines = csvLines(text);
  const header = cellsOf(lines[0]);

  // The count. Discriminative: a no-op fan says 10, dropping empty rosters says 9, fanning the
  // named rows too says 13, fanning per DOOR instead of per activity says 10.
  assert.strictEqual(doc.rowCount, FANNED_ROWS);
  assert.strictEqual(lines.length, FANNED_ROWS + 1, 'header + fanned rows');
  // Identical header on and off: the NAME carries the grain, never a column — the DNC argument
  // rests on there being no per-door voter count anywhere in the file.
  assert.strictEqual(lines[0], csvLines(off.text)[0], 'header is byte-identical with the option on');
  assert.strictEqual(header.length, 34);
  // The file AND the download say so — renaming the sink entry alone is invisible (csvSink drops it).
  assert.strictEqual(doc.files[0].name, 'activity-log-by-voter');
  assert.match(doc.artifact.filename, /-canvass-activity-by-voter-\d{4}-\d{2}-\d{2}\.csv$/);

  const idx = (h) => header.indexOf(h);
  const actId = idx('Activity DB id');
  const voterId = idx('Voter DB id');
  const identity = ['State voter ID', 'UID', 'Voter first name', 'Voter last name', 'Party', 'Voter DB id'].map(idx);
  const blank = (line) => identity.every((i) => cellsOf(line)[i] === '');

  // h2's not_home is TWO rows sharing the Activity DB id and differing ONLY in identity.
  const h2Rows = lines.filter((l) => l.includes('2026-07-02T16:30:00.000Z'));
  assert.strictEqual(h2Rows.length, 2, 'Frank + Bea');
  assert.strictEqual(new Set(h2Rows.map((l) => cellsOf(l)[actId])).size, 1, 'one activity');
  assert.deepStrictEqual(
    new Set(h2Rows.map((l) => cellsOf(l)[voterId])),
    new Set([String(ctx.frank._id), String(ctx.bea._id)]),
    'two voters',
  );
  const shared = header.map((_, i) => i).filter((i) => !identity.includes(i));
  assert.deepStrictEqual(
    shared.map((i) => cellsOf(h2Rows[0])[i]),
    shared.map((i) => cellsOf(h2Rows[1])[i]),
    'every non-identity cell (time, action, note, GPS, canvasser, door and activity ids) repeats verbatim',
  );
  assert.ok(h2Rows.some((l) => l.includes('Beeson')) && h2Rows.some((l) => l.includes('UBEA1')), 'the roster carries state id, UID, name, party');

  // The no-marker proof: h5 (everyone flagged) and h6 (nobody registered) each come out as
  // exactly ONE row with every identity cell blank, and the two are indistinguishable.
  const h5Rows = lines.filter((l) => l.includes('restricted'));
  const h6Rows = lines.filter((l) => l.includes('2026-07-04T16:00:00.000Z'));
  assert.strictEqual(h5Rows.length, 1, 'all-flagged door: one row, not zero');
  assert.strictEqual(h6Rows.length, 1, 'empty door: one row');
  assert.ok(blank(h5Rows[0]) && blank(h6Rows[0]), 'both fallbacks are identity-blank');
  assert.strictEqual(
    h5Rows[0],
    csvLines(off.text).find((l) => l.includes('restricted')),
    'the all-flagged row is character-for-character its option-off form',
  );

  // A door with one kept + one flagged voter fans to the kept one alone, and the flagged voter's
  // OWN refused row is still exactly one blank row — it names a voter, so it is never fanned
  // (fan-on-rendered-blank would have put Alice on Donna's refusal).
  const h1p2 = lines.filter((l) => l.includes('2026-07-10T15:00:00.000Z'));
  assert.strictEqual(h1p2.length, 1);
  assert.strictEqual(cellsOf(h1p2[0])[voterId], String(ctx.alice._id));
  const refused = lines.filter((l) => l.includes('refused'));
  assert.strictEqual(refused.length, 1);
  assert.ok(blank(refused[0]));
  // …and per ACTIVITY: h1's second voter-less knock (P1) also fans to Alice alone.
  const h1p1 = lines.filter((l) => l.includes('2026-07-01T14:00:00.000Z'));
  assert.strictEqual(h1p1.length, 1);
  assert.strictEqual(cellsOf(h1p1[0])[voterId], String(ctx.alice._id));

  // The dangling-voterId survey is not fanned either: voterId is non-null, the Voter is just gone.
  // As always, its five identity cells are blank while Voter DB id keeps the dead id (the row is
  // kept under the door-unit rule, and the id is what makes the orphan traceable).
  const dangling = lines.filter((l) => l.includes('2026-07-02T18:00:00.000Z'));
  assert.strictEqual(dangling.length, 1);
  assert.ok(identity.slice(0, 5).every((i) => cellsOf(dangling[0])[i] === ''), 'identity blank');
  assert.notStrictEqual(cellsOf(dangling[0])[voterId], '', 'the dangling id stays, exactly as with the option off');
  assert.strictEqual(doc.orphanedRows, 1, 'orphan accounting is untouched by the fan');

  // excludedDncCount is IDENTICAL on and off: roster omissions are never counted.
  assert.strictEqual(doc.excludedDncCount, off.doc.excludedDncCount);
  assert.strictEqual(doc.excludedDncCount, 1);

  // The record-level audit names every voter that shipped, and neither flagged one.
  const subjects = new Set((doc.audit?.subjectIds || []).map(String));
  for (const v of [ctx.frank, ctx.bea, ctx.alice, ctx.carol, ctx.dave]) {
    assert.ok(subjects.has(String(v._id)), `${v.firstName} is an audit subject`);
  }
  for (const v of [ctx.donna, ctx.edna]) {
    assert.ok(!subjects.has(String(v._id)), `${v.firstName} (flagged) never enters the subject set`);
  }
});

test('outcome filter: leaving Restricted and Wrong address unticked drops them, fanned or not', { skip }, async () => {
  const keep = ['not_home', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting'];
  for (const perVoterRows of [false, true]) {
    const params = perVoterRows ? { actionTypes: keep, perVoterRows: true } : { actionTypes: keep };
    const { doc, text } = await runExport('canvass-activity', params);
    assert.ok(!csvLines(text).slice(1).some((l) => cellsOf(l)[3] === 'restricted'), 'no restricted row');
    // h5's restricted is the only excluded fixture row: it is one row un-fanned AND one row
    // fanned (the empty-roster fallback), so both counts drop by exactly one.
    assert.strictEqual(doc.rowCount, (perVoterRows ? FANNED_ROWS : UNFANNED_ROWS) - 1);
    const est = await estimateFor('canvass-activity', params);
    assert.strictEqual(est.rows, doc.rowCount, 'the estimate follows the outcome filter');
  }
});

test('perVoterRows: the full backup stays un-fanned by construction', { skip }, async () => {
  const { text } = ctx.artifacts['full-backup'];
  // Entry and manifest names, not the whole text: the README's notes MENTION the fanned file by
  // name to say the bundle never contains it.
  assert.ok(text.includes('/activity-log.csv'), 'the bundle carries the default entry');
  assert.ok(!text.includes('/activity-log-by-voter'), 'and never the fanned one (params: {} in buildFullBackup)');
  assert.ok(!text.includes('activity-log-by-voter.csv'));
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
  assert.match(lines[0], /State voter ID,UID,Voter first name/, 'identity columns: renamed state id + the import UID');
  assert.match(lines.find((l) => l.includes('Able')), /SV1,UAL1,Alice/, 'survey rows carry state id + UID');
  assert.match(lines[0], /Do you support\?/, 'question label is a column');
  const round2 = lines.find((l) => l.includes('2026-07-10'));
  assert.match(round2, /,No,|,No$/, 'retired option id still resolves to its current text');
});

test('survey-answers (long): one row per answer entry, snapshot text', { skip }, async () => {
  const { doc, text } = ctx.artifacts['survey-answers'];
  assert.strictEqual(doc.rowCount, 4, '2 answers (r1) + 1 (r2) + 1 (dave); DNC + orphan dropped');
  assert.strictEqual(doc.orphanedRows, 2, 'orphan counted in THIS file’s unit: its 2 answer entries, not 1 response');
  assert.match(csvLines(text)[0], /State voter ID,UID,Voter first name/, 'identity columns present');
  assert.match(csvLines(text)[0], /Question key,Answer,Option ids/, 'snapshot columns present');
  assert.ok(text.includes('love it'), 'free-text snapshot preserved');
  assert.ok(text.includes('o-yes'), 'stable option ids exported for joins');
});

test('survey exports: contact/demographic columns are OPT-IN, and DNC-guarded when opted in', { skip }, async () => {
  const DETAIL_HEADERS = [
    'Gender', 'Date of birth', 'Phone', 'Phone type', 'Cell phone',
    'County', 'Latitude', 'Longitude',
    'Precinct', 'Congressional district', 'State senate district', 'State house district',
  ];
  // Alice's values, one per added column. Coordinates are READ BACK from her household
  // rather than written out here — the fixture builds them by arithmetic (-97.74 + n/1000),
  // so a literal would pin a float-formatting accident instead of the contract.
  const [lng, lat] = ctx.h1.location.coordinates;
  const ALICE_DETAIL = [
    'F', '1979-03-04', '512-555-0101', 'Landline', '512-555-0199',
    'Travis', String(lat), String(lng), 'PCT-7', 'TX-35', 'SD-14', 'HD-49',
  ];

  for (const type of ['survey-results', 'survey-answers']) {
    // OFF (the default the whole fixture already exercised): not a single cell of it.
    const off = csvLines(ctx.artifacts[type].text);
    for (const h of DETAIL_HEADERS) {
      assert.ok(!off[0].split(',').includes(h), `${type} default: "${h}" column must not exist`);
    }
    for (const v of ['512-555-0101', '1979-03-04', 'TX-35', 'HD-49']) {
      assert.ok(!ctx.artifacts[type].text.includes(v), `${type} default: "${v}" must not appear`);
    }

    // ON.
    const { doc, text } = await runExport(type, { includeVoterDetail: true });
    const lines = csvLines(text);
    const header = lines[0].split(',');
    for (const h of DETAIL_HEADERS) {
      assert.ok(header.includes(h), `${type} with detail: "${h}" column present`);
    }
    const aliceRow = lines.find((l) => l.includes('Able'));
    for (const v of ALICE_DETAIL) {
      assert.ok(aliceRow.includes(v), `${type} with detail: Alice's "${v}" present`);
    }
    // Row COUNT is unchanged — this is a column option, never a filter (what makes the
    // estimate correct without knowing about it).
    assert.strictEqual(doc.rowCount, ctx.artifacts[type].doc.rowCount, `${type}: detail changes columns, not rows`);
    assert.strictEqual(doc.excludedDncCount, ctx.artifacts[type].doc.excludedDncCount, `${type}: same DNC drops`);
    // The whole point of routing every cell through the DNC-guarded voter object.
    for (const leak of ['555-DNCPHONE-1', '555-DNCPHONE-2', '555-DNCCELL-1', '555-DNCCELL-2', '1911-11-11', 'Dncerson']) {
      assert.ok(!text.includes(leak), `${type} with detail: DNC "${leak}" must still not appear`);
    }
  }
});

// ---- voter files -----------------------------------------------------------------------

test('voter-file (current roster): DNC absent, formula guard applied end to end', { skip }, async () => {
  const { doc, text } = ctx.artifacts['voter-file'];
  assert.strictEqual(doc.rowCount, 5, 'alice, frank, bea, carol, dave — both DNC voters absent');
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
  assert.match(csvLines(text)[0], /State voter ID,UID,Voter first name/, 'identity columns present');
  assert.ok(text.includes('Great convo about parks'));
  assert.ok(!text.includes('asked us not to come back'), 'the opt-out note itself must not ship');
});

// ---- estimates (estimate==build) -------------------------------------------------------

// The same read-only ctx slice the estimate route hands each registry estimate.
async function estimateFor(type, params = {}) {
  const def = EXPORT_TYPES[type];
  const validated = await def.validateParams(params, { organizationId: ctx.org._id, campaignId: ctx.camp._id });
  return def.estimate({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    campaign: await Campaign.findById(ctx.camp._id).lean(),
    params: validated,
    anchorTz: TZ,
    dnc: await loadDncVoterIdSet(ctx.org._id),
  });
}

test('estimates: every campaign type has one; estimate==build on the whole fixture', { skip }, async () => {
  for (const [type, def] of Object.entries(EXPORT_TYPES)) {
    if (!def.requiresCampaign) continue; // full-backup is the one previewless type
    assert.strictEqual(typeof def.estimate, 'function', `${type}: a campaign type cannot silently skip preview`);
  }
  for (const [type, def] of Object.entries(EXPORT_TYPES)) {
    if (!def.estimate) continue;
    const params = type === 'voters-filtered' ? { savedSearchId: String(ctx.savedSearch._id) } : {};
    const est = await estimateFor(type, params);
    const { doc } = ctx.artifacts[type];
    assert.strictEqual(est.dncWithheld, doc.excludedDncCount, `${type}: dncWithheld predicts excludedDncCount`);
    // approx types (surveys) also drop orphaned rows the count cannot see.
    assert.strictEqual(
      est.rows,
      doc.rowCount + (est.approx ? doc.orphanedRows : 0),
      `${type}: rows predicts rowCount`
    );
  }
});

test('estimates match filtered builds (estimate==build under params)', { skip }, async () => {
  const cases = [
    ['canvass-activity', { actionTypes: ['not_home'] }],
    ['canvass-activity', { from: '2026-07-01', to: '2026-07-02' }],
    ['doors-by-round', { roundStatuses: ['not_home'] }],
    ['doors-by-round', { passId: 'legacy' }],
    ['survey-results', { surveyTemplateId: String(ctx.template._id) }],
    // The detail toggle rides the SAME params to /estimate (the mobile sheet sends it), and
    // the estimate deliberately knows nothing about it — these two cases are what makes
    // "columns, not rows" a pinned contract rather than a claim in a comment.
    ['survey-results', { includeVoterDetail: true }],
    ['survey-answers', { includeVoterDetail: true }],
    // The per-voter fan is the Center's first ROW option, so unlike the detail toggle the estimate
    // MUST know about it. The filtered cases catch a fan $match that dropped a filter, and the
    // oid() casting trap (a string campaignId in the $unionWith sub-match reads every door as
    // empty, and the estimate quietly equals the un-fanned count).
    ['canvass-activity', { perVoterRows: true }],
    ['canvass-activity', { perVoterRows: true, actionTypes: ['not_home'] }],
    ['canvass-activity', { perVoterRows: true, from: '2026-07-01', to: '2026-07-02' }],
    ['canvass-activity', { perVoterRows: true, userId: String(ctx.uDel._id) }],
    ['canvass-activity', { perVoterRows: true, passId: 'legacy' }],
    // The `outcome` chips' everyday use: everything except Restricted and Wrong address.
    ['canvass-activity', { actionTypes: ['not_home', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting'] }],
  ];
  for (const [type, params] of cases) {
    const validated = await EXPORT_TYPES[type].validateParams(params, { organizationId: ctx.org._id, campaignId: ctx.camp._id });
    const { doc } = await runExport(type, validated);
    const est = await estimateFor(type, params);
    const label = `${type} ${JSON.stringify(params)}`;
    assert.strictEqual(est.rows, doc.rowCount + (est.approx ? doc.orphanedRows : 0), `${label}: rows reconcile`);
    assert.strictEqual(est.dncWithheld, doc.excludedDncCount, `${label}: dncWithheld reconciles`);
  }
});

test('perVoterRows estimate: exact, never approx, zero on an empty scope', { skip }, async () => {
  const est = await estimateFor('canvass-activity', { perVoterRows: true });
  assert.strictEqual(est.rows, FANNED_ROWS);
  assert.strictEqual(est.approx, false, 'a fan drops nothing, so approx keeps its one meaning');
  assert.ok(!est.rowsAreFloor, 'the exact count came back inside the cap');
  assert.strictEqual(est.dncWithheld, 1, 'identical to the un-fanned figure — roster omissions are never counted');
  const empty = await estimateFor('canvass-activity', { perVoterRows: true, from: '2030-01-01' });
  assert.strictEqual(empty.rows, 0);
  const { doc } = await runExport('canvass-activity', { perVoterRows: true, from: '2030-01-01' });
  assert.strictEqual(doc.rowCount, 0, 'an empty scope builds an empty file, no crash on the empty $in');
});

test('perVoterRows estimate: a timed-out fan pipeline answers with the FLOOR, never with approx', { skip }, async () => {
  // Stand in for Mongo's MaxTimeMSExpired on the aggregate (a real 1ms cap is not reliably
  // reached on a ten-row fixture). The thenable mirrors what countCanvassActivityRows touches.
  const expired = Object.assign(new Error('operation exceeded time limit'), { codeName: 'MaxTimeMSExpired', code: 50 });
  const fake = { allowDiskUse: () => fake, option: () => fake, then: (res, rej) => Promise.reject(expired).then(res, rej) };
  const own = Object.prototype.hasOwnProperty.call(CanvassActivity, 'aggregate');
  const orig = CanvassActivity.aggregate;
  CanvassActivity.aggregate = () => fake;
  try {
    const est = await estimateFor('canvass-activity', { perVoterRows: true });
    assert.strictEqual(est.rowsAreFloor, true);
    assert.strictEqual(est.approx, false, 'a floor is not an approximation');
    assert.strictEqual(est.rows, UNFANNED_ROWS, 'the floor is one row per knock — the un-fanned count');
    assert.ok(est.rows <= FANNED_ROWS, 'and it never lies upward');
    assert.strictEqual(est.dncWithheld, 1);
  } finally {
    if (own) CanvassActivity.aggregate = orig;
    else delete CanvassActivity.aggregate;
  }
  // Any other failure of the pipeline is NOT swallowed into a floor.
  const boom = new Error('unrelated');
  CanvassActivity.aggregate = () => ({ allowDiskUse() { return this; }, option() { return this; }, then: (res, rej) => Promise.reject(boom).then(res, rej) });
  try {
    await assert.rejects(estimateFor('canvass-activity', { perVoterRows: true }), /unrelated/);
  } finally {
    if (own) CanvassActivity.aggregate = orig;
    else delete CanvassActivity.aggregate;
  }
});

test('survey-answers estimate counts answer entries, not responses', { skip }, async () => {
  const est = await estimateFor('survey-answers');
  // 2 (alice r1) + 1 (alice r2) + 1 (dave) + 2 (orphan, invisible to the count) = 6;
  // reusing the response count here would say 4 — the $size aggregation is load-bearing.
  assert.strictEqual(est.rows, 6);
  assert.strictEqual(est.dncWithheld, 1, 'Donna’s dropped RESPONSE, the builder’s countDnc unit');
});

test('doors-by-round passId:legacy exports ONLY the null-pass bucket', { skip }, async () => {
  const { doc, text } = await runExport('doors-by-round', { passId: 'legacy' });
  const lines = csvLines(text);
  assert.strictEqual(doc.rowCount, 1, 'the one pre-turf door (h3) — real rounds are skipped, not merely un-filtered');
  assert.match(lines[1], /Legacy \/ no pass/, 'the emitted row is the legacy pseudo-round');
  assert.ok(!text.includes('First knock') && !text.includes('Re-knock'), 'no real-round rows leak in');
});
