import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The `notes` export type, end to end over a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/notes_test node --test test/notesExport.int.test.js
//
// What lives HERE rather than in exportBuilders.int.test.js: the assertions that suite
// structurally cannot make. Its registry-driven sweep is a string grep for identity leaks, so it
// can prove a flagged NAME is absent but never that a COUNT column agrees with the list beside it
// — and a count that disagreed would itself be the do-not-contact marker the door-unit rule
// forbids. The converted-door matrix needs its own fixture too (a reclassified row plus the
// SurveyResponse its run created), which would perturb the shared fixture's row counts.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-notes-export';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const { openArtifactDownloadStream } = await import('../src/services/export/exportArtifactStore.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');
const { EXPORT_ESTIMATES } = await import('../src/services/export/exportEstimates.js');
const { loadDncVoterIdSet } = await import('../src/services/export/exportScope.js');
const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Membership } = await import('../src/models/Membership.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const TZ = 'America/Chicago';
const ctx = {};

const readArtifact = (id) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    openArtifactDownloadStream(id)
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject);
  });

async function runNotes(params = {}) {
  const job = await ExportJob.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    type: 'notes',
    params: { ...params, anchorTz: TZ },
    requestedBy: ctx.admin._id,
  });
  await processExportJob({ data: { exportJobId: String(job._id) }, id: `t-${job._id}`, attemptsMade: 1, opts: { attempts: 3 } });
  const doc = await ExportJob.findById(job._id).lean();
  assert.strictEqual(doc.status, 'completed', `notes export completed (error: ${doc.error})`);
  return { doc, text: await readArtifact(job._id) };
}

// A minimal RFC4180-ish reader: enough for quoted cells containing commas, which the roster
// column always has when a door holds more than one voter.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
};

const asObjects = (text) => {
  const [head, ...rest] = parseCsv(text);
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};
const byNote = (rows, needle) => rows.filter((r) => (r.Note || '').includes(needle));

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  ctx.org = await Organization.create({ name: 'Notes Org', slug: 'notes-org', isActive: true });
  ctx.admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@n.test', passwordHash: 'h', isActive: true });
  ctx.deskAdmin = await User.create({ firstName: 'Desi', lastName: 'Desk', email: 'desi@n.test', passwordHash: 'h', isActive: true });
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Ward 9', type: 'survey', state: 'TX', timeZone: TZ });
  ctx.other = await Campaign.create({ organizationId: ctx.org._id, name: 'Other Ward', type: 'survey', state: 'TX', timeZone: TZ });
  ctx.eff = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'North' });
  ctx.pass = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.eff._id, roundNumber: 1, name: 'First', status: 'active' });

  const mkHome = (n, extra = {}) =>
    Household.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.eff._id,
      addressLine1: `${n} Elm St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${n} elm st`, ...extra,
    });
  ctx.hMulti = await mkHome(10);   // THREE voters, one of them flagged — the count trap
  ctx.hConv = await mkHome(20);    // the desk-converted door
  ctx.hAllDnc = await mkHome(30, { fullyDnc: true });

  const mkVoter = (home, sv, first, last, campaignId, extra = {}) =>
    Voter.create({
      organizationId: ctx.org._id, campaignId: campaignId || ctx.camp._id, householdId: home._id,
      stateVoterId: sv, firstName: first, lastName: last, fullName: `${first} ${last}`, ...extra,
    });
  ctx.ann = await mkVoter(ctx.hMulti, 'SV-ANN', 'Ann', 'Clean');
  ctx.bob = await mkVoter(ctx.hMulti, 'SV-BOB', 'Bob', 'Clean');
  ctx.flag = await mkVoter(ctx.hMulti, 'SV-FLAG', 'Flagga', 'Optout', null, {
    doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' },
  });
  ctx.carl = await mkVoter(ctx.hConv, 'SV-CARL', 'Carl', 'Converted');
  ctx.ednaDnc = await mkVoter(ctx.hAllDnc, 'SV-EDNA', 'Edna', 'Alldnc', null, {
    doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' },
  });
  // Lives in ANOTHER campaign: an org-level VoterNote on them must be excluded by BOTH the
  // builder and the estimate, and counted as neither a row nor an orphan.
  ctx.elsewhere = await mkVoter(ctx.hMulti, 'SV-ELSE', 'Elle', 'Elsewhere', ctx.other._id);

  const loc = { lat: 30.27, lng: -97.74, accuracy: 5 };
  const mkAct = (home, actionType, ts, extra = {}) =>
    CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: home._id,
      userId: ctx.admin._id, actionType, timestamp: new Date(ts), location: loc,
      passId: ctx.pass._id, effortId: ctx.eff._id, ...extra,
    });

  await mkAct(ctx.hMulti, 'not_home', '2026-07-01T15:00:00Z', { note: 'DOORNOTE-MULTI' });
  await mkAct(ctx.hAllDnc, 'not_home', '2026-07-01T16:00:00Z', { note: 'DOORNOTE-ALLDNC' });

  // The desk-converted door: services/canvass/surveyConversion.js rewrites the row IN PLACE —
  // actionType becomes survey_submitted, reclassified.kind becomes 'to_survey' — and never
  // touches `note`, so the CANVASSER's original door note lives on a row that now reads as a
  // survey. The SurveyResponse the run creates carries the ADMIN's note instead. Two different
  // notes: a verbatim survey_submitted dedup would lose the canvasser's entirely.
  await mkAct(ctx.hConv, 'survey_submitted', '2026-07-02T15:00:00Z', {
    voterId: ctx.carl._id,
    note: 'DOORNOTE-CANVASSER-ON-CONVERTED',
    reclassified: {
      from: 'not_home', at: new Date('2026-07-05T00:00:00Z'),
      byUserId: ctx.deskAdmin._id, runId: new mongoose.Types.ObjectId(), kind: 'to_survey',
      voterIdWas: null,
    },
  });
  // A genuine FIELD survey writes the SAME note text to BOTH ledgers, which is the entire reason
  // the dedup exists — this pair proves it still holds.
  await mkAct(ctx.hMulti, 'survey_submitted', '2026-07-03T15:00:00Z', { voterId: ctx.ann._id, note: 'FIELDNOTE-BOTH-LEDGERS' });

  ctx.tpl = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'S', version: 1,
    questions: [{ key: 'q', label: 'Q', type: 'text', order: 0, options: [] }],
  });
  const mkResp = (voter, home, ts, note, extra = {}) =>
    SurveyResponse.create({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, voterId: voter._id ?? voter,
      householdId: home._id, userId: ctx.admin._id, surveyTemplateId: ctx.tpl._id,
      surveyTemplateVersion: 1, submittedAt: new Date(ts), location: loc, passId: ctx.pass._id,
      effortId: ctx.eff._id, answers: [], note, ...extra,
    });
  await mkResp(ctx.ann, ctx.hMulti, '2026-07-03T15:05:00Z', 'FIELDNOTE-BOTH-LEDGERS');
  await mkResp(ctx.carl, ctx.hConv, '2026-07-05T00:00:00Z', 'ADMINNOTE-ON-CONVERSION', {
    deskEntry: {
      runId: new mongoose.Types.ObjectId(), byUserId: ctx.deskAdmin._id,
      at: new Date('2026-07-05T00:00:00Z'), source: 'converted_outcome', fromOutcome: 'not_home',
    },
  });
  await mkResp(ctx.flag, ctx.hMulti, '2026-07-04T15:00:00Z', 'SURVEYNOTE-FLAGGED');
  // Orphan: the voter row is gone (import-undo). Voter-unit → dropped AND counted, which is what
  // keeps est.rows === rowCount + orphanedRows true for the survey source.
  await mkResp(new mongoose.Types.ObjectId(), ctx.hMulti, '2026-07-06T15:00:00Z', 'SURVEYNOTE-ORPHAN');

  await VoterNote.create({ organizationId: ctx.org._id, voterId: ctx.ann._id, authorId: ctx.admin._id, body: 'ADMINNOTE-ANN' });
  await VoterNote.create({ organizationId: ctx.org._id, voterId: ctx.flag._id, authorId: ctx.admin._id, body: 'ADMINNOTE-FLAGGED' });
  await VoterNote.create({ organizationId: ctx.org._id, voterId: ctx.elsewhere._id, authorId: ctx.admin._id, body: 'ADMINNOTE-OTHERCAMPAIGN' });
  await VoterNote.create({ organizationId: ctx.org._id, voterId: new mongoose.Types.ObjectId(), authorId: ctx.admin._id, body: 'ADMINNOTE-DELETEDVOTER' });

  // The Notes hub reads the SAME matchers through GET /admin/reports/notes, so a few endpoint
  // assertions ride along here rather than in a second fixture.
  await Membership.create({ userId: ctx.admin._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  ctx.token = signUserToken(ctx.admin);
  ctx.server = (await createApp()).listen(0);
  await new Promise((r) => ctx.server.once('listening', r));
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}/api`;
});

const getNotes = async (qs) => {
  const res = await fetch(`${ctx.base}/admin/reports/notes?campaignId=${ctx.camp._id}&from=2026-01-01&to=2026-12-31&${qs}`, {
    headers: { Authorization: `Bearer ${ctx.token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  return { status: res.status, json: await res.json() };
};

after(async () => {
  if (!URI) return;
  if (ctx.server) await new Promise((r) => ctx.server.close(r));
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('unions the three live sources, one row per note', { skip }, async () => {
  const { text } = await runNotes();
  const rows = asObjects(text);
  for (const needle of ['DOORNOTE-MULTI', 'FIELDNOTE-BOTH-LEDGERS', 'ADMINNOTE-ANN', 'DOORNOTE-CANVASSER-ON-CONVERTED']) {
    assert.strictEqual(byNote(rows, needle).length >= 1, true, `${needle} present`);
  }
  assert.deepStrictEqual(
    [...new Set(rows.map((r) => r.Source))].sort(),
    ['Admin', 'Door', 'Survey'],
    'all three sources emit',
  );
  // A door with three voters is still ONE row — the note is about the door, not the people.
  assert.strictEqual(byNote(rows, 'DOORNOTE-MULTI').length, 1);
});

test('the field-survey dedup holds: one row per note, not two', { skip }, async () => {
  const { text } = await runNotes();
  const hits = byNote(asObjects(text), 'FIELDNOTE-BOTH-LEDGERS');
  // The same text is on BOTH the CanvassActivity row and the SurveyResponse; only the survey
  // source may emit it. Dropping the $ne guard makes this 2.
  assert.strictEqual(hits.length, 1, 'a field survey note appears exactly once');
  assert.strictEqual(hits[0].Source, 'Survey');
});

test('a desk-converted door keeps the canvasser note, distinct from the admin conversion note', { skip }, async () => {
  const rows = asObjects((await runNotes()).text);
  const canv = byNote(rows, 'DOORNOTE-CANVASSER-ON-CONVERTED');
  const adminNote = byNote(rows, 'ADMINNOTE-ON-CONVERSION');
  assert.strictEqual(canv.length, 1, 'the canvasser door note survives conversion');
  assert.strictEqual(canv[0].Source, 'Door');
  assert.strictEqual(adminNote.length, 1, 'and the admin conversion note is its own row');
  assert.strictEqual(adminNote[0].Source, 'Survey');
  // The note was typed at the desk by Desi, while the row's userId is the field canvasser —
  // Author alone would name the wrong person in a file about who wrote each note.
  assert.strictEqual(adminNote[0]['Desk entered'], 'yes');
  assert.strictEqual(adminNote[0]['Desk entered by'], 'Desi Desk');
});

test('outcome filter: converted rows follow the outcome the door NOW shows', { skip }, async () => {
  const surveyed = asObjects((await runNotes({ actionTypes: ['survey_submitted'] })).text);
  assert.strictEqual(byNote(surveyed, 'DOORNOTE-CANVASSER-ON-CONVERTED').length, 1, 'reachable under Surveyed');
  assert.strictEqual(byNote(surveyed, 'ADMINNOTE-ON-CONVERSION').length, 1, 'alongside its survey note');
  assert.strictEqual(byNote(surveyed, 'DOORNOTE-MULTI').length, 0, 'a not_home note is not');

  // The leak an unconditional $or would ship: a converted row returned under EVERY outcome.
  const refused = asObjects((await runNotes({ actionTypes: ['refused'] })).text);
  assert.strictEqual(byNote(refused, 'DOORNOTE-CANVASSER-ON-CONVERTED').length, 0);
  assert.strictEqual(refused.length, 0, 'no note has the refused outcome in this fixture');

  const notHome = asObjects((await runNotes({ actionTypes: ['not_home'] })).text);
  assert.strictEqual(byNote(notHome, 'DOORNOTE-MULTI').length, 1);
  assert.strictEqual(byNote(notHome, 'ADMINNOTE-ANN').length, 0, 'admin notes have no outcome');
  assert.strictEqual(byNote(notHome, 'FIELDNOTE-BOTH-LEDGERS').length, 0, 'survey notes are not not_home');
});

test('DNC: voter-unit rows drop, door rows survive with identity blanked', { skip }, async () => {
  const { doc, text } = await runNotes();
  const rows = asObjects(text);
  assert.strictEqual(byNote(rows, 'SURVEYNOTE-FLAGGED').length, 0, 'a flagged survey note is gone');
  assert.strictEqual(byNote(rows, 'ADMINNOTE-FLAGGED').length, 0, 'a flagged profile note is gone');
  assert.ok(!text.includes('Flagga') && !text.includes('SV-FLAG'), 'the flagged identity appears nowhere');
  // The door note at the all-DNC house is a record of work performed: the ROW stays.
  assert.strictEqual(byNote(rows, 'DOORNOTE-ALLDNC').length, 1);
  assert.ok(doc.excludedDncCount >= 2, 'both dropped rows are counted');
});

test('the door roster never reveals a do-not-contact omission', { skip }, async () => {
  const rows = asObjects((await runNotes({ includeDoorVoters: true })).text);
  const multi = byNote(rows, 'DOORNOTE-MULTI')[0];
  const names = multi['Voters at this door'];
  assert.ok(names.includes('Ann Clean') && names.includes('Bob Clean'), 'clean voters listed');
  assert.ok(!names.includes('Flagga'), 'the flagged voter is omitted silently');
  assert.ok(!names.includes('Elle'), 'and another campaign’s voter is not at this door');
  // THE TRAP: the house holds three voters, but printing 3 beside two names is itself the
  // do-not-contact marker the door-unit rule forbids. The count counts LISTED names.
  assert.strictEqual(multi['Voter count at this door'], '2');

  const allDnc = byNote(rows, 'DOORNOTE-ALLDNC')[0];
  assert.strictEqual(allDnc['Voters at this door'], '', 'every voter flagged → empty list');
  assert.strictEqual(allDnc['Voter count at this door'], '', 'and no count to disagree with it');
});

test('the roster column is opt-in and absent by default', { skip }, async () => {
  const { text } = await runNotes();
  assert.ok(!text.includes('Voters at this door'), 'no roster column unless asked for');
  const params = await EXPORT_TYPES.notes.validateParams(
    { includeDoorVoters: true },
    { organizationId: ctx.org._id, campaignId: ctx.camp._id },
  );
  assert.strictEqual(params.includeDoorVoters, true, 'frozen into ExportJob.params as the audit record');
});

test('admin notes: out-of-campaign and deleted-voter notes are excluded, never counted as orphans', { skip }, async () => {
  const { doc, text } = await runNotes({ noteSources: ['voter'] });
  assert.ok(!text.includes('ADMINNOTE-OTHERCAMPAIGN'), 'another campaign’s note is not this campaign’s');
  assert.ok(!text.includes('ADMINNOTE-DELETEDVOTER'), 'a note whose voter is gone drops out');
  // Both are excluded by the estimate's campaign join too, so counting either as an orphan
  // would break est.rows === rowCount + orphanedRows by exactly one per note.
  assert.strictEqual(doc.orphanedRows, 0, 'the admin source contributes no orphans');
  assert.strictEqual(doc.rowCount, 1, 'only Ann’s note survives');
});

test('estimate == build, on the whole fixture and under every filter', { skip }, async () => {
  const cases = [
    {},
    { includeDoorVoters: true },
    { noteSources: ['door'] },
    { noteSources: ['survey'] },
    { noteSources: ['voter'] },
    { actionTypes: ['not_home'] },
    { actionTypes: ['survey_submitted'] },
    { actionTypes: ['not_home', 'survey_submitted'] },
    { passId: 'legacy' },
    { passId: String(ctx.pass._id) },
    { effortId: String(ctx.eff._id) },
    { userId: String(ctx.admin._id) },
    { q: 'DOORNOTE' },
    { from: '2026-07-01', to: '2026-07-02' },
  ];
  const dnc = await loadDncVoterIdSet(ctx.org._id);
  for (const raw of cases) {
    const params = await EXPORT_TYPES.notes.validateParams(raw, {
      organizationId: ctx.org._id, campaignId: ctx.camp._id,
    });
    const est = await EXPORT_ESTIMATES.notes({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, campaign: ctx.camp,
      params, anchorTz: TZ, dnc,
    });
    const { doc } = await runNotes(params);
    const label = JSON.stringify(raw);
    assert.strictEqual(est.dncWithheld, doc.excludedDncCount, `${label}: dncWithheld predicts excludedDncCount`);
    assert.strictEqual(
      est.rows,
      doc.rowCount + (est.approx ? doc.orphanedRows : 0),
      `${label}: rows predicts rowCount`,
    );
  }
});

test('passId legacy is a real bucket, not a crash and not "unfiltered"', { skip }, async () => {
  // normalizeCommon whitelists the string sentinel and the Exports page offers it for every type
  // carrying the `pass` token, so it reaches the scope as text. Casting it would throw a BSON
  // error and 500 the estimate.
  const params = await EXPORT_TYPES.notes.validateParams(
    { passId: 'legacy' },
    { organizationId: ctx.org._id, campaignId: ctx.camp._id },
  );
  assert.strictEqual(params.passId, 'legacy');
  const { doc } = await runNotes(params);
  // Every fixture door note carries a real pass, so the pre-turf bucket is empty — and empty is
  // the point: it must not fall back to returning everything.
  assert.strictEqual(doc.rowCount, 0);
});

test('search matches note bodies across sources', { skip }, async () => {
  const rows = asObjects((await runNotes({ q: 'ADMINNOTE-ANN' })).text);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].Source, 'Admin');
});

test('exports past the Notes page 500-per-source cap', { skip }, async () => {
  const bulk = [];
  for (let i = 0; i < 620; i += 1) {
    bulk.push({
      organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: ctx.hMulti._id,
      userId: ctx.admin._id, actionType: 'lit_dropped', timestamp: new Date(Date.UTC(2026, 7, 1, 0, i % 60)),
      location: { lat: 30.27, lng: -97.74, accuracy: 5 },
      passId: ctx.pass._id, effortId: ctx.eff._id, note: `BULKNOTE-${i}`,
    });
  }
  await CanvassActivity.insertMany(bulk);
  const { doc, text } = await runNotes({ actionTypes: ['lit_dropped'] });
  assert.strictEqual(doc.rowCount, 620, 'the whole set, not the hub’s 500-per-source cap');
  assert.ok(text.includes('BULKNOTE-619'));
  await CanvassActivity.deleteMany({ note: /^BULKNOTE-/ });
});

// ---- the Notes hub, sharing the same matchers -------------------------------------------

test('endpoint: the outcome filter selects the same rows the export does', { skip }, async () => {
  const notHome = await getNotes('actionType=not_home');
  assert.strictEqual(notHome.status, 200);
  const bodies = notHome.json.notes.map((n) => n.note);
  assert.ok(bodies.includes('DOORNOTE-MULTI'));
  assert.ok(!bodies.some((b) => b.startsWith('ADMINNOTE')), 'admin notes have no outcome');

  const surveyed = await getNotes('actionType=survey_submitted');
  const sb = surveyed.json.notes.map((n) => n.note);
  assert.ok(sb.includes('DOORNOTE-CANVASSER-ON-CONVERTED'), 'the converted door note is reachable here too');
  assert.strictEqual(sb.filter((b) => b === 'FIELDNOTE-BOTH-LEDGERS').length, 1, 'dedup holds on the hub');
});

test('endpoint: counts honor every filter EXCEPT the source picker', { skip }, async () => {
  // The chips must keep showing a source's real total while it is unticked — the documented
  // invariant that also makes `total` (not counts.total) the pageable number.
  const all = await getNotes('');
  const doorOnly = await getNotes('type=door');
  assert.deepStrictEqual(doorOnly.json.counts, all.json.counts, 'source picker does NOT move counts');
  assert.ok(doorOnly.json.total < all.json.total, 'but it does move the pageable total');

  // An outcome filter is structural, so it DOES move them.
  const notHome = await getNotes('actionType=not_home');
  assert.ok(notHome.json.counts.total < all.json.counts.total, 'outcome filter moves counts');
  assert.strictEqual(notHome.json.counts.voter, 0, 'admin notes cannot have an outcome');
});
