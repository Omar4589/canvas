import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Areas by default, house-level by explicit opt-in — privacy record item 52, against the REAL app and a
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/crnohh node --test test/clientReportShareNoHousehold.int.test.js
//
// A campaign with real-looking addresses and survey answers, one AREA report (the default for every new
// report) and one HOUSE-LEVEL report (opted in, confirmed), both published and read through real share
// links unlocked with their real password. Every share endpoint of the area report — the meta, the hub,
// the report, its areas, and the pins routes it doesn't serve — and every preview equivalent must return
// no address field, no household id, no household's answers, and none of the seeded street or city text.
// An area map's answer COUNTS are the one `answers` allowed: per area, at least five homes. The
// house-level report, opted in, works exactly as before: pins with their answers, and a tapped door's
// street address and answers (…/map/doors). Then the server's guards: a house-level map only with
// confirmHouseLevel (PATCH and Refresh, recorded on the report and in its History), a map turned back on
// in areas, and Next resetting to areas.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-client-report-no-household';
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
const { MIN_AREA_ANSWERS } = await import('../src/services/reports/areaCells.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};

// Jul 6 – Jul 12, 2026 in Chicago.
const RANGE_START = new Date('2026-07-06T05:00:00Z');
const inPeriod = (h = 0) => new Date(RANGE_START.getTime() + (24 + h) * 3600 * 1000);

// Real-looking households, every one of them in ONE small area (≈ a metre apart), so the area map has
// enough answers to show them (MIN_AREA_ANSWERS) and the test can see that it shows only counts.
const STREET = 'Magnolia Crescent';
const CITY = 'Wexford Springs';
const ZIP = '75093';
const SEEDED_TEXT = ['Magnolia', 'Crescent', 'Wexford', ZIP];
const FORBIDDEN_KEYS = new Set(['addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'householdId', 'answers', 'unit', 'voterId', 'normalizedAddress']);

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
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text };
};
const asAdmin = (body) => ({ ...ctx.admin, ...(body ? { body } : {}) });

/**
 * Every key of a response, walked: none may be a household field. `areaCells` names the one place an
 * `answers` key is allowed — an area payload's cells — and each entry there must be a count over at
 * least MIN_AREA_ANSWERS homes, never a household's answer.
 */
const assertNoHouseholdData = (label, res) => {
  for (const s of SEEDED_TEXT) assert.ok(!res.text.includes(s), `${label}: no seeded street or city text ("${s}")`);
  const walk = (node, path, inAreaCell) => {
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`, inAreaCell));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'answers' && inAreaCell) {
        assert.ok(Array.isArray(v), `${label}: ${path}.answers is a list of counts`);
        for (const a of v) {
          assert.deepStrictEqual(Object.keys(a).sort(), ['n', 'options', 'questionKey'], `${label}: ${path}.answers holds counts only`);
          assert.ok(a.n >= MIN_AREA_ANSWERS, `${label}: an area's answers cover at least ${MIN_AREA_ANSWERS} homes`);
          for (const o of a.options) assert.deepStrictEqual(Object.keys(o).sort(), ['count', 'option']);
        }
        continue;
      }
      assert.ok(!FORBIDDEN_KEYS.has(k), `${label}: no "${k}" at ${path}`);
      walk(v, `${path}.${k}`, false);
    }
  };
  // Area cells: walk them with the one exception on.
  const root = res.json;
  if (root && root.mode === 'area' && Array.isArray(root.cells)) {
    const { cells, ...rest } = root;
    walk(rest, '$', false);
    cells.forEach((c, i) => {
      for (const [k, v] of Object.entries(c)) {
        if (k === 'answers') walk({ answers: v }, `$.cells[${i}]`, true);
        else {
          assert.ok(!FORBIDDEN_KEYS.has(k), `${label}: no "${k}" at $.cells[${i}]`);
          walk(v, `$.cells[${i}].${k}`, false);
        }
      }
    });
  } else {
    walk(root, '$', false);
  }
};

const runBuild = async (reportId) => {
  const r = await ClientReport.findById(reportId).lean();
  let jobId = r.build?.jobId;
  if (!jobId || r.build.status === 'failed') {
    jobId = new ObjectId().toHexString();
    await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date(), 'build.error': null } });
  }
  return builds.processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
};
const createReport = async (body = {}) => {
  const res = await call('POST', '/admin/client-reports', asAdmin({ campaignId: String(ctx.camp._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', allowDuplicate: true, ...body }));
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const publishNow = async (id) => {
  const r = await ClientReport.findById(id).lean();
  const res = await call('POST', `/admin/client-reports/${id}/publish`, asAdmin({ snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 }));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.report;
};

const SHARE_PASSWORD = 'correct-horse-battery-staple';
const linkFor = async ({ reportId = null, token }) => {
  const bcrypt = (await import('bcryptjs')).default;
  await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token, ...(reportId ? { reportId } : {}),
    passwordHash: await bcrypt.hash(SHARE_PASSWORD, 4), expiresAt: new Date(Date.now() + 86400000), isActive: true,
  });
  const unlock = await call('POST', `/share/${token}/unlock`, { body: { password: SHARE_PASSWORD } });
  assert.strictEqual(unlock.status, 200, JSON.stringify(unlock.json));
  return { token, access: unlock.json.accessToken };
};
const shared = (link, path) => call('GET', `/share/${link.token}${path}`, { headers: { 'X-Share-Token': link.access } });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([ClientReportSeries.syncIndexes(), ClientReportAreaCell.syncIndexes(), ClientReportMapPoint.syncIndexes()]);

  const org = await Organization.create({ name: 'Acme', slug: 'acme-nohh', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, role) => {
    const u = await User.create({
      firstName: first, lastName: 'Tester', email: `${first.toLowerCase()}@nohh.test`,
      passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
    });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const admin = await mk('Ada', 'admin');
  const canvasser = await mk('Cal', 'canvasser');
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true,
    questions: [
      { key: 'support', label: 'Support Smith?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }, { id: 'n', text: 'No', order: 1 }] },
      { key: 'issues', label: 'Top issues', type: 'multiple_choice', order: 1, options: [{ id: 'a', text: 'Schools', order: 0 }, { id: 'b', text: 'Roads', order: 1 }] },
    ],
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall', type: 'survey', state: 'TX', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago' });
  Object.assign(ctx, { org, camp, template, adminUser: admin, admin: { token: signUserToken(admin), orgId: org._id } });

  // Eight doors on one street: six surveyed (with answers), two not home.
  for (let i = 0; i < 8; i += 1) {
    const hh = await Household.create({
      organizationId: org._id, campaignId: camp._id, isActive: true,
      addressLine1: `${4417 + 2 * i} ${STREET}`, city: CITY, state: 'TX', zipCode: ZIP,
      normalizedAddress: `${4417 + 2 * i} MAGNOLIA CRES|WEXFORD SPRINGS|TX|${ZIP}`,
      location: { type: 'Point', coordinates: [-96.8123 + i * 0.00001, 32.9871 + i * 0.00001] },
    });
    const surveyed = i < 6;
    await CanvassActivity.create({
      organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: canvasser._id,
      actionType: surveyed ? 'survey_submitted' : 'not_home', timestamp: inPeriod(i), location: { lat: 32.98, lng: -96.81 },
    });
    if (surveyed) {
      const voter = await Voter.create({
        organizationId: org._id, campaignId: camp._id, householdId: hh._id,
        stateVoterId: `TX${7000 + i}`, firstName: 'Vera', lastName: `Resident${i}`, fullName: `Vera Resident${i}`,
      });
      await SurveyResponse.create({
        organizationId: org._id, campaignId: camp._id, householdId: hh._id, voterId: voter._id, userId: canvasser._id,
        surveyTemplateId: template._id, surveyTemplateVersion: 1, location: { lat: 32.98, lng: -96.81 }, submittedAt: inPeriod(i),
        answers: [
          { questionKey: 'support', questionLabel: 'Support Smith?', optionIds: [i % 3 ? 'y' : 'n'], answer: i % 3 ? 'Yes' : 'No' },
          { questionKey: 'issues', questionLabel: 'Top issues', optionIds: ['a'], answer: ['Schools'] },
        ],
      });
    }
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a new report is an area map; a house-level map is set only with its confirmation, which is recorded', { skip }, async () => {
  const area = await createReport();
  assert.strictEqual(area.visibility.mapMode, 'area', 'areas by default');
  assert.strictEqual(area.visibility.areaSize, 'small');
  assert.strictEqual(area.build.inputs.mapMode, 'area', 'and its first build makes areas');
  assert.ok((await runBuild(area._id))?.committed);
  ctx.areaReport = await publishNow(area._id);
  assert.strictEqual(ctx.areaReport.snapshotInputs.mapMode, 'area');
  assert.ok(ctx.areaReport.areaCellCount > 0 && ctx.areaReport.mapPointCount === 0);

  const house = await createReport();
  const refused = await call('PATCH', `/admin/client-reports/${house._id}`, asAdmin({ visibility: { mapMode: 'pins' } }));
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.json.code, 'HOUSE_LEVEL_CONFIRM_REQUIRED');
  const unchanged = await ClientReport.findById(house._id).lean();
  assert.strictEqual(unchanged.visibility.mapMode, 'area', 'a refusal changes nothing');
  assert.strictEqual(unchanged.editVersion, house.editVersion);
  const falseConfirm = await call('PATCH', `/admin/client-reports/${house._id}`, asAdmin({ visibility: { mapMode: 'pins' }, confirmHouseLevel: false }));
  assert.strictEqual(falseConfirm.json.code, 'HOUSE_LEVEL_CONFIRM_REQUIRED', 'only a literal true confirms');

  const ok = await call('PATCH', `/admin/client-reports/${house._id}`, asAdmin({ visibility: { mapMode: 'pins' }, confirmHouseLevel: true }));
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.report.visibility.mapMode, 'pins');
  assert.ok(ok.json.report.visibility.houseLevelConfirmedAt, 'when it was confirmed');
  assert.strictEqual(String(ok.json.report.visibility.houseLevelConfirmedBy), String(ctx.adminUser._id), 'and by whom');
  const row = await CampaignChange.findOne({ clientReportId: house._id, field: 'clientReport.houseLevelConfirmed' }).lean();
  assert.ok(row, 'a History row');
  assert.strictEqual(String(row.byUserId), String(ctx.adminUser._id));
  assert.deepStrictEqual(row.toValue, { mapMode: 'pins', via: 'settings' });

  // Recompute builds it house-level: a pin per reached door, with its street and its map answers.
  const rec = await call('POST', `/admin/client-reports/${house._id}/recompute`, asAdmin());
  assert.strictEqual(rec.status, 202, JSON.stringify(rec.json));
  assert.ok((await runBuild(house._id))?.committed);
  const built = await ClientReport.findById(house._id).lean();
  assert.strictEqual(built.snapshotInputs.mapMode, 'pins');
  assert.strictEqual(built.mapPointCount, 8);
  // The area report stores no pins at all: its map is cells, and a cell holds no address.
  assert.strictEqual(await ClientReportMapPoint.countDocuments({ clientReportId: area._id }), 0);
  const cells = await ClientReportAreaCell.collection.find({ clientReportId: new ObjectId(area._id) }).toArray();
  assert.ok(cells.length && cells.every((c) => !('addressLine1' in c) && !('householdId' in c)));
  ctx.houseReport = await publishNow(house._id);
  ctx.areaLink = await linkFor({ reportId: ctx.areaReport._id, token: 'nohh-area' });
  ctx.houseLink = await linkFor({ reportId: ctx.houseReport._id, token: 'nohh-house' });
  ctx.allLink = await linkFor({ token: 'nohh-all' });
});

test('every share endpoint of an area report, with a real token: no address, household id or household answer', { skip }, async () => {
  const areaId = String(ctx.areaReport._id);
  const reads = [];
  const read = async (label, link, path) => {
    const res = await shared(link, path);
    reads.push([label, res]);
    return res;
  };

  assert.strictEqual((await read('meta', ctx.areaLink, '')).status, 200);
  const hub = await read('hub (one report)', ctx.areaLink, '/reports');
  assert.deepStrictEqual(hub.json.reports.map((r) => r.id), [areaId]);
  assert.strictEqual(hub.json.reports[0].mapMode, 'area');
  // The old hub lists both reports — counts only, never a door.
  const all = await read('hub (all reports)', ctx.allLink, '/reports');
  assert.strictEqual(all.json.reports.length, 2);

  const one = await read('area report', ctx.areaLink, `/reports/${areaId}`);
  assert.strictEqual(one.status, 200, one.text);
  assert.strictEqual(one.json.report.visibility.mapMode, 'area');
  assert.deepStrictEqual(one.json.survey.questions.map((q) => q.key), ['support', 'issues'], 'its map questions, as report-wide counts');

  // The areas: cells with counts, and area answers only where every answering area has five or more.
  const areas = await read('area map', ctx.areaLink, `/reports/${areaId}/areas`);
  assert.strictEqual(areas.status, 200, areas.text);
  assert.strictEqual(areas.json.cells.length, 1, 'every door in one small area');
  assert.strictEqual(areas.json.cells[0].doors, 8);
  assert.deepStrictEqual(areas.json.cells[0].answers.map((a) => [a.questionKey, a.n]), [['support', 6]], 'the single-choice question, as a count over six homes');

  // The pins routes don't serve an area report: a coded answer, and no data.
  const asPins = await read('area report /map', ctx.areaLink, `/reports/${areaId}/map`);
  assert.strictEqual(asPins.status, 409);
  assert.strictEqual(asPins.json.code, 'MAP_UPDATED');
  const doors = await read('area report /map/doors', ctx.areaLink, `/reports/${areaId}/map/doors?snapshotKey=${encodeURIComponent(ctx.areaReport.snapshotKey)}&rows=0,1,2,3,4,5,6,7`);
  assert.strictEqual(doors.status, 409);
  assert.strictEqual(doors.json.code, 'MAP_UPDATED', 'no door of an area report is ever looked up');
  await read('mapbox token', ctx.areaLink, '/mapbox-token');

  for (const [label, res] of reads) assertNoHouseholdData(label, res);
});

test('every preview endpoint of an area report: the same', { skip }, async () => {
  const id = ctx.areaReport._id;
  const reads = [
    ['preview GET', await call('GET', `/admin/client-reports/${id}/preview`, asAdmin())],
    // The on-screen overlay can't put a house-level map on the preview: the map follows the live snapshot.
    ['preview POST', await call('POST', `/admin/client-reports/${id}/preview`, asAdmin({ title: 'On screen', visibility: { mapMode: 'pins' } }))],
    ['preview areas', await call('GET', `/admin/client-reports/${id}/preview/areas`, asAdmin())],
    ['preview map', await call('GET', `/admin/client-reports/${id}/preview/map`, asAdmin())],
    ['preview doors', await call('GET', `/admin/client-reports/${id}/preview/map/doors?snapshotKey=${encodeURIComponent(ctx.areaReport.snapshotKey)}&rows=0`, asAdmin())],
  ];
  assert.strictEqual(reads[0][1].status, 200);
  assert.strictEqual(reads[1][1].json.report.visibility.mapMode, 'area');
  assert.strictEqual(reads[2][1].status, 200);
  assert.strictEqual(reads[3][1].json.code, 'MAP_UPDATED');
  assert.strictEqual(reads[4][1].json.code, 'MAP_UPDATED');
  for (const [label, res] of reads) assertNoHouseholdData(label, res);
});

test('an opted-in house-level report works as it always has: pins with answers, and a tapped door’s address and answers', { skip }, async () => {
  const houseId = String(ctx.houseReport._id);
  const one = await shared(ctx.houseLink, `/reports/${houseId}`);
  assert.strictEqual(one.json.report.visibility.mapMode, 'pins');
  assert.deepStrictEqual(one.json.survey.questions.map((q) => q.key), ['support', 'issues'], 'its map filters');
  const map = await shared(ctx.houseLink, `/reports/${houseId}/map`);
  assert.strictEqual(map.status, 200, map.text);
  assert.strictEqual(map.json.mode, 'pins');
  assert.strictEqual(map.json.count, 8);
  assert.deepStrictEqual(map.json.questions.map((q) => q.key), ['support', 'issues']);
  assert.strictEqual(map.json.answers.support.filter((a) => a != null).length, 6, 'each surveyed door’s answer, for the filters');
  assert.ok(!map.text.includes(STREET), 'the compact payload itself carries no address');
  const doors = await shared(ctx.houseLink, `/reports/${houseId}/map/doors?snapshotKey=${encodeURIComponent(map.json.snapshotKey)}&rows=0,1,7`);
  assert.strictEqual(doors.status, 200, doors.text);
  assert.strictEqual(doors.json.doors.length, 3);
  assert.ok(doors.json.doors.every((d) => d.addressLine1.endsWith(STREET) && d.city === CITY && d.state === 'TX'), 'a tapped door names its street');
  const surveyed = doors.json.doors.find((d) => d.status === 'surveyed');
  assert.deepStrictEqual(surveyed.answers.map((a) => a.question), ['Support Smith?', 'Top issues'], 'and its answers, in their real wording');
  const preview = await call('GET', `/admin/client-reports/${houseId}/preview/map/doors?snapshotKey=${encodeURIComponent(map.json.snapshotKey)}&rows=0`, asAdmin());
  assert.strictEqual(preview.status, 200, preview.text);
  assert.ok(preview.json.doors[0].addressLine1.endsWith(STREET), 'the preview shows what the client will');
  // Its hub row and report say how the map works, never a door.
  for (const res of [await shared(ctx.houseLink, '/reports'), one]) assertNoHouseholdData('house-level report and hub', res);
});

test('a published area report goes house-level only through Refresh numbers, with its confirmation', { skip }, async () => {
  const id = ctx.areaReport._id;
  // Edit can't add a house-level map: it would add to what the client sees.
  const viaEdit = await call('PATCH', `/admin/client-reports/${id}`, asAdmin({ visibility: { mapMode: 'pins' }, confirmHouseLevel: true, ifStatus: 'published' }));
  assert.strictEqual(viaEdit.status, 400);
  assert.strictEqual(viaEdit.json.code, 'NEEDS_REFRESH');
  const unconfirmedEdit = await call('PATCH', `/admin/client-reports/${id}`, asAdmin({ visibility: { mapMode: 'pins' } }));
  assert.strictEqual(unconfirmedEdit.json.code, 'HOUSE_LEVEL_CONFIRM_REQUIRED');

  const refused = await call('POST', `/admin/client-reports/${id}/refresh`, asAdmin({ map: { mapMode: 'pins' } }));
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.json.code, 'HOUSE_LEVEL_CONFIRM_REQUIRED');
  const before = await ClientReport.findById(id).lean();
  assert.ok(!before.visibility.houseLevelConfirmedAt && before.build.status === 'idle', 'nothing claimed, nothing recorded');

  const ok = await call('POST', `/admin/client-reports/${id}/refresh`, asAdmin({ map: { mapMode: 'pins' }, confirmHouseLevel: true }));
  assert.strictEqual(ok.status, 202, JSON.stringify(ok.json));
  const after = await ClientReport.findById(id).lean();
  assert.strictEqual(after.build.inputs.mapMode, 'pins');
  assert.ok(after.visibility.houseLevelConfirmedAt);
  assert.strictEqual(String(after.visibility.houseLevelConfirmedBy), String(ctx.adminUser._id));
  assert.strictEqual(after.visibility.mapMode, 'area', 'nothing changes for the client until Apply');
  const row = await CampaignChange.findOne({ clientReportId: id, field: 'clientReport.houseLevelConfirmed' }).lean();
  assert.deepStrictEqual(row?.toValue, { mapMode: 'pins', via: 'refresh' });
  await call('POST', `/admin/client-reports/${id}/build/cancel`, asAdmin());
});

test('a map turned back on by Refresh numbers is areas unless it asks for a house-level map', { skip }, async () => {
  const r = await createReport();
  assert.ok((await runBuild(r._id))?.committed);
  await publishNow(r._id);
  const off = await call('PATCH', `/admin/client-reports/${r._id}`, asAdmin({ visibility: { showMap: false }, ifStatus: 'published' }));
  assert.strictEqual(off.status, 200, JSON.stringify(off.json));
  // A report from before the default, whose setting still says pins.
  await ClientReport.updateOne({ _id: r._id }, { $set: { 'visibility.mapMode': 'pins' } });
  const on = await call('POST', `/admin/client-reports/${r._id}/refresh`, asAdmin({ map: { showMap: true, mapKeys: [] } }));
  assert.strictEqual(on.status, 202, JSON.stringify(on.json));
  const built = await ClientReport.findById(r._id).lean();
  assert.strictEqual(built.build.inputs.showMap, true);
  assert.strictEqual(built.build.inputs.mapMode, 'area', 'areas, never the old setting');
  await call('POST', `/admin/client-reports/${r._id}/build/cancel`, asAdmin());
});

test('Next resets to areas: a house-level map is opt-in per report, and its confirmation never carries', { skip }, async () => {
  const res = await call('POST', `/admin/client-reports/${ctx.houseReport._id}/next`, asAdmin());
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const next = res.json.report;
  assert.strictEqual(next.visibility.mapMode, 'area');
  assert.strictEqual(next.visibility.areaSize, 'small');
  assert.ok(!next.visibility.houseLevelConfirmedAt && !next.visibility.houseLevelConfirmedBy, 'no confirmation carried');
  assert.strictEqual(next.build.inputs.mapMode, 'area', 'its first build makes areas');
  assert.deepStrictEqual(next.visibility.mapAnswerKeys.sort(), [...ctx.houseReport.visibility.mapAnswerKeys].sort(), 'the map picks still carry, for areas');
});
