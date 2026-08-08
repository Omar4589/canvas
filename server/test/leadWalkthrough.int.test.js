import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The team-lead WALKTHROUGH: one lead runs an entire campaign lifecycle end-to-end
// against the real app, and every surface they touch must answer without a wall.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/lead_walk node --test test/leadWalkthrough.int.test.js
//
// teamLead.int.test.js pins the authorization MATRIX (who may call what); this file pins
// the JOURNEY — config, survey authoring, field setup, self-assignment, the mobile walk,
// every report the mobile admin app calls, exports, client reports, packets, and the
// Users surface — in dependency order, as one lead, so a regression that walls any step
// of the real workflow fails here even when every router gate is individually correct.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-lead-walkthrough';
// Exports enqueue against Redis, which tests don't run; without this bound the ioredis
// offline buffer would hang the request instead of failing fast (exports.int.test.js).
process.env.EXPORT_ENQUEUE_TIMEOUT_MS = process.env.EXPORT_ENQUEUE_TIMEOUT_MS || '400';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { VotedVoter } = await import('../src/models/VotedVoter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { ImportProfile } = await import('../src/models/ImportProfile.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, json, text };
}

// The walkthrough's one rule: the step answers, or the failure names the step.
const asLead = (method, path, body) =>
  call(method, path, { token: ctx.leadTok, orgId: ctx.org._id, ...(body !== undefined ? { body } : {}) });
const expectOk = (res, step) =>
  assert.ok(res.status < 400, `${step}: expected success, got ${res.status} ${res.text?.slice(0, 300)}`);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    SurveyTemplate, Effort, Pass, Turf, TurfAssignment, Household, Voter,
    CanvassActivity, SurveyResponse, VotedVoter, VoterNote, ClientReport,
    ReportShareLink, ExportJob, ImportProfile, Subscription,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Walk Org', slug: 'walk-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'wa@t.co', passwordHash: 'x', isActive: true });
  // THE lead: granted campaign A and rostered on it as a walker (manages + walks).
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'wl@t.co', passwordHash: 'x', isActive: true });
  // A granted-but-unrostered lead — the common real-world shape; must never hit a wall.
  const deskLead = await User.create({ firstName: 'Uma', lastName: 'Desk', email: 'wd@t.co', passwordHash: 'x', isActive: true });
  const cy = await User.create({ firstName: 'Cy', lastName: 'Walker', email: 'wc@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [lead, 'lead'], [deskLead, 'lead'], [cy, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }

  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true, version: 1,
    questions: [{
      key: 'support', label: 'Support?', type: 'single_choice', order: 0,
      options: [{ id: 'y', text: 'Support', order: 0 }, { id: 'n', text: 'Opposed', order: 1 }],
    }],
  });
  const A = await Campaign.create({
    organizationId: org._id, name: 'Walk A', type: 'survey', state: 'KY',
    isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const B = await Campaign.create({
    organizationId: org._id, name: 'Walk B', type: 'survey', state: 'KY', isActive: true,
  });
  await CampaignManager.create({ campaignId: A._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });
  await CampaignManager.create({ campaignId: A._id, userId: deskLead._id, organizationId: org._id, grantedBy: admin._id });
  await CampaignAssignment.create({ campaignId: A._id, userId: lead._id, organizationId: org._id });

  const hhs = [];
  for (let n = 0; n < 4; n++) {
    hhs.push(await Household.create({
      organizationId: org._id, campaignId: A._id, isActive: true,
      addressLine1: `${100 + n} Walk St`, city: 'Town', state: 'KY', zipCode: '40601',
      normalizedAddress: `${100 + n} WALK ST|TOWN|KY|40601`,
      location: { type: 'Point', coordinates: [-84.87 + n / 1e3, 38.19] },
    }));
  }
  for (const [i, hh] of hhs.entries()) {
    await Voter.create({
      organizationId: org._id, campaignId: A._id, householdId: hh._id,
      stateVoterId: `KY${9000 + i}`, firstName: `V${i}`, lastName: 'Test', fullName: `V${i} Test`,
      party: 'DEM',
    });
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, A, B, admin, lead, deskLead, cy, template, hhs,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
    deskTok: signUserToken(deskLead), cyTok: signUserToken(cy),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('1. console entry: identity carries the grant; the campaign list is theirs', { skip }, async () => {
  const me = await asLead('GET', '/auth/me');
  expectOk(me, 'GET /auth/me');
  const mem = (me.json.memberships || []).find((m) => String(m.organizationId?._id || m.organizationId) === String(ctx.org._id));
  assert.ok(mem && (mem.managedCampaignIds || []).map(String).includes(String(ctx.A._id)), 'managedCampaignIds on the wire');

  const list = await asLead('GET', '/admin/campaigns');
  expectOk(list, 'GET /admin/campaigns');
  assert.strictEqual(list.json.campaigns.length, 1, 'sees exactly their campaign');

  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/setup-status`), 'setup-status');
});

test('2. campaign config: rename, read imports surface, save a mapping profile', { skip }, async () => {
  expectOk(await asLead('PATCH', `/admin/campaigns/${ctx.A._id}`, { name: 'Walk A (renamed)' }), 'PATCH campaign name');
  expectOk(await asLead('GET', `/admin/imports?campaignId=${ctx.A._id}`), 'imports history');
  expectOk(await asLead('GET', '/admin/imports/profiles'), 'profiles list');
  expectOk(await asLead('POST', '/admin/imports/profiles', { name: 'VendorX', mapping: { stateVoterId: 'VoterID' } }), 'profile save (lead-writable by ruling)');
});

test('3. survey authoring: create, edit, duplicate, attach; tags readable', { skip }, async () => {
  const created = await asLead('POST', '/admin/surveys', { name: 'Lead Draft' });
  expectOk(created, 'author a survey');
  const sid = created.json.survey?._id || created.json.survey?.id || created.json._id || created.json.id;
  assert.ok(sid, `created survey id in response: ${created.text?.slice(0, 200)}`);
  expectOk(await asLead('PATCH', `/admin/surveys/${sid}`, { name: 'Lead Draft v2' }), 'edit own survey');
  expectOk(await asLead('POST', `/admin/surveys/${sid}/duplicate`), 'duplicate own survey');
  expectOk(await asLead('PATCH', `/admin/campaigns/${ctx.A._id}`, { surveyTemplateId: String(sid) }), 'attach own authored survey');
  // THE DETACH CLIFF, live: swapping the default detached the admin's template from the
  // lead's only campaign, so it left their scope — re-attaching it now needs an admin.
  const cliff = await asLead('PATCH', `/admin/campaigns/${ctx.A._id}`, { surveyTemplateId: String(ctx.template._id) });
  assert.strictEqual(cliff.status, 403, 'detached admin template is out of the lead\'s reach');
  assert.strictEqual(cliff.json.code, 'survey-out-of-scope');
  expectOk(
    await call('PATCH', `/admin/campaigns/${ctx.A._id}`, { token: ctx.adminTok, orgId: ctx.org._id, body: { surveyTemplateId: String(ctx.template._id) } }),
    'admin restores the house template'
  );
  expectOk(await asLead('GET', '/admin/tags'), 'read tags');
});

test('4. field setup: effort (auto Pass 1), walk list + CSV, books, activate, SELF-assign', { skip }, async () => {
  const eff = await asLead('POST', `/admin/campaigns/${ctx.A._id}/efforts`, { name: 'Doors North' });
  expectOk(eff, 'create effort');
  ctx.effort = eff.json.effort;
  const passes = await asLead('GET', `/admin/campaigns/${ctx.A._id}/passes?effortId=${ctx.effort._id}`);
  expectOk(passes, 'list passes');
  ctx.pass = passes.json.passes.find((p) => String(p.effortId) === String(ctx.effort._id));
  assert.ok(ctx.pass, 'effort auto-created its Pass 1');

  // Adopt the doors into the effort so the book belongs to it (imports normally do this).
  await Household.updateMany({ campaignId: ctx.A._id }, { $set: { effortId: ctx.effort._id } });

  const wl = await asLead('POST', `/admin/campaigns/${ctx.A._id}/walklists`, { name: 'Saturday', filter: {} });
  expectOk(wl, 'create walk list');
  const wlId = wl.json.walkList?._id || wl.json.walkList?.id;
  const csv = await asLead('GET', `/admin/campaigns/${ctx.A._id}/walklists/${wlId}/export.csv`);
  expectOk(csv, 'walk list CSV export');
  assert.match(csv.text, /Voter ID|First Name/, 'CSV has headers');

  // Books come from the turf generator (a queue job tests cannot run) — seed the cut
  // book directly, published, exactly as the generator would leave it.
  ctx.turf = await Turf.create({
    organizationId: ctx.org._id, campaignId: ctx.A._id, passId: ctx.pass._id,
    name: 'Book 1', mode: 'geometric', status: 'published',
    householdIds: ctx.hhs.map((h) => h._id), doorCount: ctx.hhs.length,
  });
  expectOk(await asLead('POST', `/admin/campaigns/${ctx.A._id}/passes/${ctx.pass._id}/activate`), 'activate the round');

  // The promise from ROLES.md: a lead assigns books INCLUDING to themselves.
  const selfAssign = await asLead('POST', `/admin/campaigns/${ctx.A._id}/turfs/${ctx.turf._id}/assignments`, { userIds: [String(ctx.lead._id)] });
  expectOk(selfAssign, 'self-assign the book');
  assert.deepStrictEqual(selfAssign.json.notOnTeam || [], [], 'the lead is assignable (partitionAssignable lead arm)');

  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/turfs?passId=${ctx.pass._id}`), 'list books');
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/turfs/progress?passId=${ctx.pass._id}`), 'book progress');
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/turfs/assignments?passId=${ctx.pass._id}`), 'book assignments');
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/turfs/household/${ctx.hhs[0]._id}`), 'door lookup');
});

test('5. crew: roster a canvasser, create one, set a coordinator; pin-correct a door', { skip }, async () => {
  expectOk(await asLead('POST', `/admin/campaigns/${ctx.A._id}/assignments`, { userIds: [String(ctx.cy._id)] }), 'roster existing canvasser');
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/assignments`), 'read roster');
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/crew`), 'crew picker');
  const hire = await asLead('POST', `/admin/campaigns/${ctx.A._id}/crew`, {
    email: 'hire@t.co', firstName: 'New', lastName: 'Hire', password: 'victory26',
  });
  expectOk(hire, 'create canvasser via crew');
  const hireId = hire.json.user?._id || hire.json.user?.id;
  expectOk(await asLead('GET', `/admin/campaigns/${ctx.A._id}/crew/${hireId}/coordinator-preview?coordinatorId=${ctx.lead._id}`), 'coordinator preview');
  expectOk(await asLead('PATCH', `/admin/campaigns/${ctx.A._id}/crew/${hireId}/coordinator`, { coordinatorId: String(ctx.lead._id) }), 'set coordinator');
  expectOk(await asLead('PATCH', `/admin/campaigns/${ctx.A._id}/households/${ctx.hhs[3]._id}/location`, { lat: 38.1907, lng: -84.8699 }), 'pin correction (web path)');
});

test('6. the mobile walk: campaigns, bootstrap with books, a knock, changes, day stats', { skip }, async () => {
  const camps = await asLead('GET', '/mobile/campaigns');
  expectOk(camps, 'mobile campaign list');
  assert.ok(camps.json.campaigns.some((c) => String(c.id) === String(ctx.A._id)), 'their campaign is walkable');

  const boot = await asLead('GET', `/mobile/bootstrap?campaignId=${ctx.A._id}`);
  expectOk(boot, 'bootstrap');
  assert.ok((boot.json.books || []).length >= 1, 'the self-assigned book is on the phone');
  assert.ok((boot.json.households || []).length >= 1, 'with its doors');

  const knock = await asLead('POST', `/mobile/households/${ctx.hhs[0]._id}/not-home`, {
    location: { lat: 38.1901, lng: -84.8701, accuracy: 8 },
    timestamp: new Date().toISOString(),
  });
  expectOk(knock, 'record a knock');
  assert.ok(knock.json.household?.status, 'per-round wire came back');
  ctx.knockActivity = await CanvassActivity.findOne({ campaignId: ctx.A._id, userId: ctx.lead._id }).lean();
  assert.ok(ctx.knockActivity, 'the knock is on the ledger');

  expectOk(await asLead('GET', `/mobile/changes?campaignId=${ctx.A._id}&since=${new Date(Date.now() - 60000).toISOString()}`), 'delta sync');
  expectOk(await asLead('GET', `/mobile/me/today?campaignId=${ctx.A._id}`), 'my day');
  expectOk(await asLead('GET', `/mobile/me/history?campaignId=${ctx.A._id}&tz=America/New_York`), 'my history');
  expectOk(await asLead('POST', `/mobile/households/${ctx.hhs[1]._id}/location`, { lat: 38.1905, lng: -84.8702, source: 'drag' }), 'pin correction (mobile path)');

  // Voter surfaces: manager scope — campaign-wide, roster or not.
  const search = await asLead('GET', `/mobile/voters?campaignId=${ctx.A._id}&search=Test`);
  expectOk(search, 'voter search');
  assert.ok(search.json.voters.length >= 3, 'campaign-wide, not book-scoped');
  const vid = search.json.voters[0].id;
  expectOk(await asLead('GET', `/mobile/voters/${vid}?campaignId=${ctx.A._id}`), 'voter profile');
  expectOk(await asLead('POST', `/mobile/voters/${vid}/notes`, { campaignId: String(ctx.A._id), body: 'Call back Saturday' }), 'voter note');
});

test('7. the DESK lead (granted, never rostered) walks into no walls', { skip }, async () => {
  const opts = { token: ctx.deskTok, orgId: ctx.org._id };
  const boot = await call('GET', `/mobile/bootstrap?campaignId=${ctx.A._id}`, opts);
  expectOk(boot, 'desk-lead bootstrap');
  assert.deepStrictEqual(boot.json.books, [], 'empty books, like an unrostered admin — not a 403');
  expectOk(await call('GET', `/mobile/me/today?campaignId=${ctx.A._id}`, opts), 'desk-lead day stats');
  const search = await call('GET', `/mobile/voters?campaignId=${ctx.A._id}&search=Test`, opts);
  expectOk(search, 'desk-lead voter search');
  assert.ok(search.json.voters.length >= 3, 'manager scope without a roster row');
});

test('8. every report surface the mobile admin app calls answers for the lead', { skip }, async () => {
  const A = ctx.A._id;
  const uid = ctx.lead._id; // the canvasser being drilled is the lead's own walker row
  const gets = [
    `/admin/reports/overview?campaignId=${A}`,
    `/admin/reports/campaign-rollup`,
    `/admin/reports/survey-results?campaignId=${A}`,
    `/admin/reports/knocks-by-pass?campaignId=${A}`,
    `/admin/reports/canvassers?campaignId=${A}`,
    `/admin/reports/canvassers.csv?campaignId=${A}`,
    `/admin/reports/team-averages?campaignId=${A}`,
    `/admin/reports/duplicate-surveys?campaignId=${A}`,
    `/admin/reports/canvasser-timeline?campaignId=${A}`,
    `/admin/reports/overlap-doors?campaignId=${A}`,
    `/admin/reports/notes?campaignId=${A}`,
    `/admin/reports/flags?campaignId=${A}`,
    `/admin/reports/answer-canvassers?campaignId=${A}&questionKey=support&option=Support`,
    `/admin/reports/voters-by-answer?campaignId=${A}&questionKey=support&option=Support`,
    `/admin/reports/canvassers/${uid}/summary?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/activities?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/daily?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/households?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/voters?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/notes?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/path?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/quality?campaignId=${A}`,
    `/admin/reports/canvassers/${uid}/export.csv?campaignId=${A}`,
    `/admin/households/map?campaignId=${A}`,
    `/admin/households/${ctx.hhs[0]._id}/activity`,
    `/admin/activities/${ctx.knockActivity._id}`,
    `/admin/campaigns/${A}/voted`,
    `/admin/campaigns/${A}/walklists`,
    `/admin/campaigns/${A}/efforts`,
  ];
  for (const path of gets) expectOk(await asLead('GET', path), `GET ${path}`);
});

test('9. packets print for the lead', { skip }, async () => {
  const sources = await asLead('GET', `/admin/campaigns/${ctx.A._id}/packets/sources`);
  expectOk(sources, 'packet sources');
  const data = await asLead('GET', `/admin/campaigns/${ctx.A._id}/packets/data?turfIds=${ctx.turf._id}`);
  expectOk(data, 'packet data');
  assert.ok(data.json.books?.[0]?.doors?.length >= 1, 'the packet has doors');
});

test('10. exports: types filtered, estimate, create (queue-less), list, detail', { skip }, async () => {
  const types = await asLead('GET', '/admin/exports/types');
  expectOk(types, 'export types');
  const type = (types.json.types || []).find((t) => !t.adminOnly)?.id || (types.json.types || [])[0]?.id;
  assert.ok(type, `a lead-visible export type exists: ${types.text?.slice(0, 200)}`);
  expectOk(await asLead('POST', '/admin/exports/estimate', { type, campaignId: String(ctx.A._id) }), 'estimate');
  const created = await asLead('POST', '/admin/exports', { type, campaignId: String(ctx.A._id) });
  assert.ok([201, 503].includes(created.status), `create export: 201 with a worker or a clean 503 without Redis, got ${created.status} ${created.text?.slice(0, 200)}`);
  expectOk(await asLead('GET', '/admin/exports'), 'export history');
  const jobId = created.json?.job?._id || created.json?.job?.id;
  if (jobId) expectOk(await asLead('GET', `/admin/exports/${jobId}`), 'export detail');
});

test('11. client report: create, shape, publish, preview, share, tear down', { skip }, async () => {
  const monday = '2026-08-03';
  const sunday = '2026-08-09';
  const rep = await asLead('POST', '/admin/client-reports', { campaignId: String(ctx.A._id), weekStart: monday, weekEnd: sunday, title: 'Week' });
  expectOk(rep, 'create client report');
  const rid = rep.json.report._id;
  expectOk(await asLead('PATCH', `/admin/client-reports/${rid}`, { visibility: { visibleQuestionKeys: ['support'], mapAnswerKeys: ['support'], showMap: true } }), 'set visibility');
  expectOk(await asLead('GET', `/admin/client-reports/${rid}`), 'read report');
  expectOk(await asLead('POST', `/admin/client-reports/${rid}/publish`), 'publish');
  expectOk(await asLead('GET', `/admin/client-reports/${rid}/preview`), 'preview');
  expectOk(await asLead('GET', `/admin/client-reports/${rid}/preview/map`), 'preview map');
  const share = await asLead('POST', '/admin/client-reports/shares', { campaignId: String(ctx.A._id), label: 'Client' });
  expectOk(share, 'mint share link');
  assert.ok(share.json.generatedPassword, 'the minted password is returned once');
  expectOk(await asLead('GET', `/admin/client-reports/shares?campaignId=${ctx.A._id}`), 'list shares');
  expectOk(await asLead('DELETE', `/admin/client-reports/shares/${share.json.share.id}`), 'kill share');
  expectOk(await asLead('POST', `/admin/client-reports/${rid}/unpublish`), 'unpublish');
  expectOk(await asLead('DELETE', `/admin/client-reports/${rid}`), 'delete report');
});

test('12. the Users surface: scoped list, drills, temp password, off and back on', { skip }, async () => {
  const list = await asLead('GET', '/admin/memberships');
  expectOk(list, 'users list');
  const ids = (list.json.memberships || list.json.members || []).map((m) => String(m.userId?._id || m.userId || m.user?.id));
  assert.ok(ids.includes(String(ctx.cy._id)), 'their canvasser is on the scoped list');

  const cid = ctx.cy._id;
  for (const drill of ['crews', 'campaigns', 'stats', 'recent-activity']) {
    expectOk(await asLead('GET', `/admin/memberships/${cid}/${drill}`), `drill ${drill}`);
  }
  expectOk(await asLead('PATCH', `/admin/memberships/${cid}/password`, { password: 'victory27' }), 'temp password');
  expectOk(await asLead('PATCH', `/admin/memberships/${cid}/deactivate`), 'switch off');
  expectOk(await asLead('PATCH', `/admin/memberships/${cid}/reactivate`), 'switch back on');
});

test('13. and the walls that SHOULD be walls still are', { skip }, async () => {
  assert.strictEqual((await asLead('GET', `/admin/reports/overview?campaignId=${ctx.B._id}`)).status, 403, 'ungranted campaign report');
  assert.strictEqual((await asLead('GET', `/admin/campaigns/${ctx.B._id}/turfs`)).status, 403, 'ungranted campaign books');
  assert.strictEqual((await asLead('POST', '/admin/campaigns', { name: 'Nope', type: 'survey', state: 'KY' })).status, 403, 'campaign create');
  assert.strictEqual((await asLead('POST', '/admin/client-reports/shares/revoke-legacy')).status, 403, 'org-wide share sweep');
  assert.strictEqual((await asLead('GET', '/admin/voters')).status, 403, 'org voter directory');
});
