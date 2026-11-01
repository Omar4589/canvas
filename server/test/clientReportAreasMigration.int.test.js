import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// npm run migrate:client-report-areas — every existing report to areas (privacy record item 52), against
// the REAL app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crareas node --test test/clientReportAreasMigration.int.test.js
//
// Published house-level maps (shown, taken down, and one from before snapshots) switch to small areas
// through the same remap Switch to areas makes — without the client's "Edited" — while a confirmed
// house-level map, a report with new numbers waiting for review and one with a build in flight are left
// and listed — rows, addresses and all. Drafts and map-off reports get the setting. The dry run writes
// nothing; a second run changes nothing.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-areas';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ClientReportAreaCell } = await import('../src/models/ClientReportAreaCell.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const builds = await import('../src/services/reports/clientReportBuilds.js');
const { runClientReportAreas } = await import('../src/migrations/clientReportAreas.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
const RANGE_START = new Date('2026-07-06T05:00:00Z');
const RANGE_END = new Date('2026-07-13T05:00:00Z');
const inPeriod = (h = 0) => new Date(RANGE_START.getTime() + (24 + h) * 3600 * 1000);
const ADDRESS = { addressLine1: '4417 Magnolia Crescent', city: 'Wexford Springs', state: 'TX' };

const call = async (method, path, { token, orgId, body, headers = {} } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const asAdmin = (body) => ({ ...ctx.admin, ...(body ? { body } : {}) });

const runBuild = async (reportId) => {
  const r = await ClientReport.findById(reportId).lean();
  let jobId = r.build?.jobId;
  if (!jobId || r.build.status === 'failed') {
    jobId = new ObjectId().toHexString();
    await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date(), 'build.error': null } });
  }
  const out = await builds.processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, JSON.stringify(out));
};
const createReport = async () => {
  const res = await call('POST', '/admin/client-reports', asAdmin({ campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', allowDuplicate: true }));
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const publishNow = async (id) => {
  const r = await ClientReport.findById(id).lean();
  const res = await call('POST', `/admin/client-reports/${id}/publish`, asAdmin({ snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
};
// A house-level report as the deploy finds one: built and published before area was the default.
// `confirmed`: one whose house-level map someone confirmed under the new rule (kept as it is).
const houseLevelReport = async ({ confirmed = false, publish = true } = {}) => {
  const r = await createReport();
  if (confirmed) {
    const ok = await call('PATCH', `/admin/client-reports/${r._id}`, asAdmin({ visibility: { mapMode: 'pins' }, confirmHouseLevel: true }));
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  } else {
    await ClientReport.updateOne({ _id: r._id }, { $set: { 'visibility.mapMode': 'pins' } });
  }
  const rec = await call('POST', `/admin/client-reports/${r._id}/recompute`, asAdmin());
  assert.strictEqual(rec.status, 202, JSON.stringify(rec.json));
  await runBuild(r._id);
  if (publish) await publishNow(r._id);
  return ClientReport.findById(r._id).lean();
};

// Everything the migration could touch, as JSON: reports, map rows, cells and History.
const dbState = async () =>
  JSON.stringify(
    await Promise.all([
      ClientReport.collection.find({}).sort({ _id: 1 }).toArray(),
      ClientReportMapPoint.collection.find({}).sort({ _id: 1 }).toArray(),
      ClientReportAreaCell.collection.find({}).sort({ _id: 1 }).toArray(),
      CampaignChange.collection.find({}).sort({ _id: 1 }).toArray(),
    ])
  );

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([ClientReportSeries.syncIndexes(), ClientReportAreaCell.syncIndexes(), ClientReportMapPoint.syncIndexes()]);
  const org = await Organization.create({ name: 'Acme', slug: 'acme-areas', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@areas.test', passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true,
    questions: [{ key: 'support', label: 'Support Smith?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }, { id: 'n', text: 'No', order: 1 }] }],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall', type: 'survey', state: 'TX', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago' });
  Object.assign(ctx, { org, camp, template, adminUser: admin, admin: { token: signUserToken(admin), orgId: org._id } });
  for (let i = 0; i < 6; i += 1) {
    const hh = await Household.create({
      organizationId: org._id, campaignId: camp._id, isActive: true,
      addressLine1: `${4417 + 2 * i} Magnolia Crescent`, city: 'Wexford Springs', state: 'TX', zipCode: '75093',
      normalizedAddress: `${4417 + 2 * i} MAGNOLIA CRES|WEXFORD SPRINGS|TX|75093`,
      location: { type: 'Point', coordinates: [-96.8123 + i * 0.00001, 32.9871 + i * 0.00001] },
    });
    await CanvassActivity.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: admin._id, actionType: 'survey_submitted', timestamp: inPeriod(i), location: { lat: 32.98, lng: -96.81 } });
    const voter = await Voter.create({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `TX${8000 + i}`, firstName: 'Vera', lastName: `R${i}`, fullName: `Vera R${i}` });
    await SurveyResponse.create({
      organizationId: org._id, campaignId: camp._id, householdId: hh._id, voterId: voter._id, userId: admin._id,
      surveyTemplateId: template._id, surveyTemplateVersion: 1, location: { lat: 32.98, lng: -96.81 }, submittedAt: inPeriod(i),
      answers: [{ questionKey: 'support', questionLabel: 'Support Smith?', optionIds: ['y'], answer: 'Yes' }],
    });
  }
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // ── The reports the deploy finds ──────────────────────────────────────────────────────────────
  ctx.shown = await houseLevelReport();
  const down = await houseLevelReport();
  assert.strictEqual((await call('POST', `/admin/client-reports/${down._id}/take-down`, asAdmin())).status, 200);
  ctx.down = await ClientReport.findById(down._id).lean();
  assert.ok(ctx.down.takenDownAt);
  ctx.confirmed = await houseLevelReport({ confirmed: true });
  ctx.review = await houseLevelReport();
  await ClientReport.updateOne(
    { _id: ctx.review._id },
    { $set: { build: { kind: 'refresh', status: 'ready', jobId: 'ready-job', snapshotId: new ObjectId(), snapshotKey: 'k-ready', inputs: ctx.review.snapshotInputs, result: { stats: ctx.review.stats, mapPointCount: 6 } } } }
  );
  ctx.running = await houseLevelReport();
  await ClientReport.updateOne(
    { _id: ctx.running._id },
    { $set: { build: { kind: 'refresh', status: 'running', jobId: 'running-job', snapshotId: new ObjectId(), beatAt: new Date(), startedAt: new Date(), inputs: ctx.running.snapshotInputs } } }
  );
  // Published before snapshots: no snapshot of its own, its rows carrying none, its map forced to pins.
  const legacy = await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, weekStart: '2026-06-29', weekEnd: '2026-07-05', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-06-29T05:00:00Z'), rangeEndUtc: RANGE_START, status: 'published', publishedAt: new Date('2026-07-06T15:00:00Z'),
    visibility: { visibleQuestionKeys: ['support'], mapAnswerKeys: ['support'], showMap: true },
    stats: { cumulative: { totals: { doorsKnocked: 3 }, surveyBreakdowns: [{ questionKey: 'support', questionLabel: 'Support Smith?', type: 'single_choice', options: [{ option: 'Yes', count: 3 }] }] }, period: { totals: { doorsKnocked: 3 } } },
    mapPointCount: 3,
  });
  await ClientReport.collection.updateOne({ _id: legacy._id }, { $unset: { 'visibility.mapMode': '', 'visibility.areaSize': '', snapshotId: '' } });
  await ClientReportMapPoint.collection.insertMany(
    [0, 1, 2].map((i) => ({
      clientReportId: legacy._id, organizationId: org._id, campaignId: camp._id, householdId: new ObjectId(),
      lng: -96.8123 + i * 0.00001, lat: 32.9871 + i * 0.00001, status: 'surveyed', answers: [{ questionKey: 'support', answer: 'Yes' }], ...ADDRESS,
    }))
  );
  ctx.legacy = await ClientReport.findById(legacy._id).lean();
  // Drafts: one set to house-level before the deploy, one from before the field, one confirmed since.
  ctx.draftPins = await createReport();
  await ClientReport.updateOne({ _id: ctx.draftPins._id }, { $set: { 'visibility.mapMode': 'pins' } });
  ctx.draftOld = await createReport();
  await ClientReport.collection.updateOne({ _id: new ObjectId(ctx.draftOld._id) }, { $unset: { 'visibility.mapMode': '' } });
  ctx.draftConfirmed = await createReport();
  assert.strictEqual((await call('PATCH', `/admin/client-reports/${ctx.draftConfirmed._id}`, asAdmin({ visibility: { mapMode: 'pins' }, confirmHouseLevel: true }))).status, 200);
  // A published report whose map is off, its setting still house-level.
  ctx.mapOff = await houseLevelReport();
  assert.strictEqual((await call('PATCH', `/admin/client-reports/${ctx.mapOff._id}`, asAdmin({ visibility: { showMap: false }, ifStatus: 'published' }))).status, 200);
  await ClientReport.updateOne({ _id: ctx.mapOff._id }, { $set: { 'visibility.mapMode': 'pins' } });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the dry run plans every step and writes nothing', { skip }, async () => {
  const beforeState = await dbState();
  const lines = [];
  const out = await runClientReportAreas({ apply: false, log: (l) => lines.push(l) });
  assert.strictEqual(await dbState(), beforeState, 'nothing written');
  assert.deepStrictEqual(out.toRemap.map((p) => p.id).sort(), [ctx.shown, ctx.down, ctx.legacy].map((r) => String(r._id)).sort());
  assert.strictEqual(out.legacy, 1, 'one from before snapshots');
  assert.deepStrictEqual(out.kept.map((k) => k.id), [String(ctx.confirmed._id)]);
  assert.deepStrictEqual(out.skipped.map((s) => s.id).sort(), [ctx.review, ctx.running].map((r) => String(r._id)).sort());
  assert.deepStrictEqual(out.settings, { drafts: 2, mapOff: 1 });
  const log = lines.join('\n');
  assert.match(log, /DRY RUN/);
  assert.match(log, new RegExp(`SKIPPED ${ctx.review._id} .*waiting for review`));
  assert.match(log, new RegExp(`SKIPPED ${ctx.running._id} .*build is running`));
  assert.match(log, new RegExp(`kept ${ctx.confirmed._id} .*confirmed`));
  assert.match(log, /Dry run — nothing written/);
});

test('apply: house-level maps become small areas without "Edited", and drafts and map-off reports get the setting', { skip }, async () => {
  const out = await runClientReportAreas({ apply: true, log: () => {} });
  assert.deepStrictEqual(out.remapped.map((p) => p.id).sort(), [ctx.shown, ctx.down, ctx.legacy].map((r) => String(r._id)).sort());
  assert.deepStrictEqual(out.failed, []);

  for (const [name, was] of [['shown', ctx.shown], ['taken down', ctx.down]]) {
    const r = await ClientReport.findById(was._id).lean();
    assert.strictEqual(r.snapshotInputs.mapMode, 'area', `${name}: its live snapshot is areas`);
    assert.strictEqual(r.snapshotInputs.areaSize, 'small');
    assert.strictEqual(r.visibility.mapMode, 'area');
    assert.strictEqual(r.visibility.areaSize, 'small');
    assert.strictEqual(r.mapPointCount, 0);
    assert.ok(r.areaCellCount >= 1);
    assert.strictEqual(r.contentEditedAt, null, `${name}: no "Edited" for the client`);
    assert.deepStrictEqual(r.stats, was.stats, `${name}: the numbers don't change`);
    assert.strictEqual(r.editVersion, (was.editVersion ?? 0) + 1, `${name}: an open builder merges onto it`);
    assert.strictEqual(r.build.status, 'idle');
    assert.strictEqual(String(r.takenDownAt ?? null), String(was.takenDownAt ?? null), `${name}: shown or taken down as it was`);
    assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: was._id }), 0, `${name}: its house-level rows are gone`);
    const rows = await CampaignChange.find({ clientReportId: was._id, field: { $in: ['clientReport.areasPrivacyUpdate', 'clientReport.remapped'] } }).lean();
    assert.deepStrictEqual(rows.map((x) => [x.field, x.byUserId ?? null, x.toValue?.kind]), [['clientReport.areasPrivacyUpdate', null, 'remap']], `${name}: one History row, by Doorline`);
  }
  // From before snapshots: the remap read its legacy rows, and it now has a snapshot of its own.
  const legacy = await ClientReport.findById(ctx.legacy._id).lean();
  assert.ok(legacy.snapshotId && legacy.snapshotKey);
  assert.strictEqual(legacy.snapshotInputs.mapMode, 'area');
  assert.strictEqual(legacy.areaCellCount, 1);
  assert.strictEqual(legacy.contentEditedAt ?? null, null);
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: legacy._id }), 0);

  // The client reads the areas, with no "Edited".
  const bcrypt = (await import('bcryptjs')).default;
  await ReportShareLink.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'areas-shown', reportId: ctx.shown._id, passwordHash: await bcrypt.hash('correct-horse-battery', 4), expiresAt: new Date(Date.now() + 86400000), isActive: true });
  const unlock = await call('POST', '/share/areas-shown/unlock', { body: { password: 'correct-horse-battery' } });
  const headers = { 'X-Share-Token': unlock.json.accessToken };
  const one = await call('GET', `/share/areas-shown/reports/${ctx.shown._id}`, { headers });
  assert.strictEqual(one.json.report.editedOn, null);
  assert.strictEqual(one.json.report.visibility.mapMode, 'area');
  assert.strictEqual((await call('GET', `/share/areas-shown/reports/${ctx.shown._id}/areas`, { headers })).status, 200);
  assert.strictEqual((await call('GET', `/share/areas-shown/reports/${ctx.shown._id}/map`, { headers })).json.code, 'MAP_UPDATED');

  // Left as they are: the confirmed one, the review waiting, the build in flight — rows, addresses and all.
  for (const was of [ctx.confirmed, ctx.review, ctx.running]) {
    const r = await ClientReport.findById(was._id).lean();
    assert.strictEqual(r.snapshotInputs.mapMode, 'pins');
    assert.strictEqual(String(r.snapshotId), String(was.snapshotId));
    const rows = await ClientReportMapPoint.find({ clientReportId: was._id }).lean();
    assert.strictEqual(rows.length, 6, 'its rows stay');
    assert.ok(rows.every((p) => p.addressLine1.endsWith('Magnolia Crescent')), 'with the addresses a house-level map needs');
  }
  assert.strictEqual((await ClientReport.findById(ctx.review._id).lean()).build.status, 'ready', 'the review is still there');

  // The setting: drafts and the map-off report; the confirmed draft is left.
  for (const was of [ctx.draftPins, ctx.draftOld, ctx.mapOff]) {
    const r = await ClientReport.findById(was._id).lean();
    assert.strictEqual(r.visibility.mapMode, 'area');
    assert.strictEqual(r.visibility.areaSize, 'small');
    const row = await CampaignChange.findOne({ clientReportId: was._id, field: 'clientReport.areasPrivacyUpdate' }).lean();
    assert.deepStrictEqual(row?.toValue, { kind: 'setting', mapMode: 'area', areaSize: 'small' });
  }
  assert.strictEqual((await ClientReport.findById(ctx.draftPins._id).lean()).editVersion, (ctx.draftPins.editVersion ?? 0) + 1, 'an open builder merges onto it');
  assert.strictEqual((await ClientReport.findById(ctx.draftConfirmed._id).lean()).visibility.mapMode, 'pins', 'a confirmed draft is left');
});

test('a second run changes nothing', { skip }, async () => {
  const beforeState = await dbState();
  const lines = [];
  const out = await runClientReportAreas({ apply: true, log: (l) => lines.push(l) });
  assert.strictEqual(await dbState(), beforeState, 'nothing written');
  assert.deepStrictEqual(out.remapped, []);
  assert.deepStrictEqual(out.settings, { drafts: 0, mapOff: 0 });
  // Still listed, for the owner to come back to.
  assert.deepStrictEqual(out.skipped.map((s) => s.id).sort(), [ctx.review, ctx.running].map((r) => String(r._id)).sort());
  assert.match(lines.join('\n'), /run this again once they are done/);
});
