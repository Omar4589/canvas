import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Survey library lifecycle + usage annotations, exercised over the REAL Express app
// + a throwaway mongod (Redis-free paths):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/surveys_test node --test test/surveys.int.test.js
// Covers the enriched GET /admin/surveys (usedByCampaigns + usedByWalkLists +
// responseCountByCampaign — the walk-list-override accuracy fix), archive/unarchive
// idempotence, the delete in-use guard (responses / campaign default / effort
// override), and the efforts list's per-walk-list responseCount + intakeResponseCount.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-surveys';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // seeded ids + tokens

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, SurveyTemplate, SurveyResponse]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Survey Org', slug: 'survey-org-test', isActive: true });
  const org2 = await Organization.create({ name: 'Other Org', slug: 'other-org-test', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@s.co', passwordHash: 'x', isActive: true });
  const admin2 = await User.create({ firstName: 'Oda', lastName: 'Other', email: 'other@s.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: admin2._id, organizationId: org2._id, role: 'admin', isActive: true });

  // Templates: A = C1's default (has responses), B = walk-list override only,
  // C = responses only (no attachment), D = truly unused, E = archive target.
  const mk = (name) => SurveyTemplate.create({ organizationId: org._id, name, questions: [] });
  const [surveyA, surveyB, surveyC, surveyD, surveyE] = await Promise.all(
    ['Survey A', 'Survey B', 'Survey C', 'Survey D', 'Survey E'].map(mk)
  );

  const C1 = await Campaign.create({
    organizationId: org._id, name: 'Campaign One', type: 'survey', state: 'KY',
    isActive: true, surveyTemplateId: surveyA._id,
  });
  const C2 = await Campaign.create({
    organizationId: org._id, name: 'Campaign Two', type: 'survey', state: 'KY', isActive: true,
  });

  // Walk lists in C2: E1 overrides to Survey B, E2 uses the campaign default.
  const E1 = await Effort.create({
    organizationId: org._id, campaignId: C2._id, name: 'North',
    surveyTemplateId: surveyB._id, status: 'active', createdBy: admin._id,
  });
  const E2 = await Effort.create({
    organizationId: org._id, campaignId: C2._id, name: 'South',
    status: 'active', createdBy: admin._id,
  });

  // Responses (raw inserts — the aggregates only read org/campaign/survey/effort ids;
  // distinct voterId+passId keeps the per-pass unique index happy):
  //   Survey A: 2 in C1.   Survey C: 3 in C1 + 1 in C2 (total 4, split 3/1).
  //   C2 effort spread → E1: 2, E2: 1, Intake (null effortId): 1.
  const row = (surveyTemplateId, campaignId, effortId = null) => ({
    organizationId: org._id, campaignId, surveyTemplateId, effortId,
    voterId: new mongoose.Types.ObjectId(), passId: new mongoose.Types.ObjectId(),
    submittedAt: new Date(),
  });
  await SurveyResponse.collection.insertMany([
    row(surveyA._id, C1._id),
    row(surveyA._id, C1._id),
    row(surveyC._id, C1._id),
    row(surveyC._id, C1._id),
    row(surveyC._id, C1._id),
    row(surveyC._id, C2._id, E2._id),
    row(surveyB._id, C2._id, E1._id),
    row(surveyB._id, C2._id, E1._id),
    row(surveyA._id, C2._id), // Intake response — no effort yet
  ]);

  Object.assign(ctx, {
    org, org2, C1, C2, E1, E2, surveyA, surveyB, surveyC, surveyD, surveyE,
    adminTok: signUserToken(admin),
    admin2Tok: signUserToken(admin2),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

function findSurvey(list, id) {
  return list.find((s) => String(s._id) === String(id));
}

test('GET /admin/surveys annotates default, walk-list, and per-campaign usage', { skip }, async () => {
  const { adminTok, org, C1, C2, E1, surveyA, surveyB, surveyC, surveyD } = ctx;
  const { status, json } = await call('GET', '/api/admin/surveys', { token: adminTok, orgId: org._id });
  assert.strictEqual(status, 200);
  const surveys = json.surveys;

  // Survey A: C1's default, 3 responses org-wide (2 in C1 + 1 intake row in C2).
  const a = findSurvey(surveys, surveyA._id);
  assert.strictEqual(a.usedByCampaigns.length, 1);
  assert.strictEqual(String(a.usedByCampaigns[0].id), String(C1._id));
  assert.strictEqual(a.responseCount, 3);
  assert.strictEqual(a.hasResponses, true);

  // Survey B: used ONLY as a walk-list override — the accuracy fix under test.
  const b = findSurvey(surveys, surveyB._id);
  assert.strictEqual(b.usedByCampaigns.length, 0, 'no default attachment');
  assert.strictEqual(b.usedByWalkLists.length, 1, 'override usage must surface');
  assert.strictEqual(String(b.usedByWalkLists[0].effortId), String(E1._id));
  assert.strictEqual(b.usedByWalkLists[0].effortName, 'North');
  assert.strictEqual(String(b.usedByWalkLists[0].campaignId), String(C2._id));
  assert.strictEqual(b.usedByWalkLists[0].campaignName, 'Campaign Two');

  // Survey C: responses in two campaigns → total + split.
  const c = findSurvey(surveys, surveyC._id);
  assert.strictEqual(c.responseCount, 4);
  const split = new Map(c.responseCountByCampaign.map((r) => [String(r.campaignId), r.count]));
  assert.strictEqual(split.get(String(C1._id)), 3);
  assert.strictEqual(split.get(String(C2._id)), 1);

  // Survey D: untouched.
  const d = findSurvey(surveys, surveyD._id);
  assert.strictEqual(d.responseCount, 0);
  assert.strictEqual(d.usedByCampaigns.length, 0);
  assert.strictEqual(d.usedByWalkLists.length, 0);
  assert.strictEqual(d.archivedAt, null);
});

test('archive / unarchive set archivedAt and are idempotent', { skip }, async () => {
  const { adminTok, org, surveyE } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const arch = await call('POST', `/api/admin/surveys/${surveyE._id}/archive`, opt);
  assert.strictEqual(arch.status, 200);
  assert.ok(arch.json.survey.archivedAt, 'archivedAt set');

  const again = await call('POST', `/api/admin/surveys/${surveyE._id}/archive`, opt);
  assert.strictEqual(again.status, 200, 'idempotent re-archive');
  assert.strictEqual(again.json.survey.archivedAt, arch.json.survey.archivedAt, 'timestamp unchanged');

  const list = await call('GET', '/api/admin/surveys', opt);
  assert.ok(findSurvey(list.json.surveys, surveyE._id).archivedAt, 'archivedAt flows through the list');

  const un = await call('POST', `/api/admin/surveys/${surveyE._id}/unarchive`, opt);
  assert.strictEqual(un.status, 200);
  assert.strictEqual(un.json.survey.archivedAt, null);

  const unAgain = await call('POST', `/api/admin/surveys/${surveyE._id}/unarchive`, opt);
  assert.strictEqual(unAgain.status, 200, 'idempotent re-unarchive');
  assert.strictEqual(unAgain.json.survey.archivedAt, null);
});

test('DELETE blocks every kind of in-use survey with survey-in-use reasons', { skip }, async () => {
  const { adminTok, org, surveyA, surveyB, surveyC } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  // A: responses AND a campaign default.
  const a = await call('DELETE', `/api/admin/surveys/${surveyA._id}`, opt);
  assert.strictEqual(a.status, 409);
  assert.strictEqual(a.json.code, 'survey-in-use');
  assert.ok(a.json.reasons.includes('It has survey responses.'), 'responses reason');
  assert.ok(a.json.reasons.includes('It is attached to a campaign.'), 'campaign reason');

  // B: a walk-list override (plus responses).
  const b = await call('DELETE', `/api/admin/surveys/${surveyB._id}`, opt);
  assert.strictEqual(b.status, 409);
  assert.ok(b.json.reasons.includes('It is a walk-list survey override.'), 'override reason');

  // C: responses only.
  const c = await call('DELETE', `/api/admin/surveys/${surveyC._id}`, opt);
  assert.strictEqual(c.status, 409);
  assert.deepStrictEqual(c.json.reasons, ['It has survey responses.']);
});

test('DELETE removes a truly unused survey; wrong org and re-delete are 404', { skip }, async () => {
  const { adminTok, admin2Tok, org, org2, surveyD, surveyE } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  // Wrong org can't even see it.
  const cross = await call('DELETE', `/api/admin/surveys/${surveyE._id}`, { token: admin2Tok, orgId: org2._id });
  assert.strictEqual(cross.status, 404, 'wrong-org delete is 404');

  const del = await call('DELETE', `/api/admin/surveys/${surveyD._id}`, opt);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.ok, true);

  const again = await call('DELETE', `/api/admin/surveys/${surveyD._id}`, opt);
  assert.strictEqual(again.status, 404, 're-delete is 404');

  const list = await call('GET', '/api/admin/surveys', opt);
  assert.strictEqual(findSurvey(list.json.surveys, surveyD._id), undefined, 'gone from the list');
});

test('GET efforts reports per-walk-list responseCount and intakeResponseCount', { skip }, async () => {
  const { adminTok, org, C2, E1, E2 } = ctx;
  const { status, json } = await call('GET', `/api/admin/campaigns/${C2._id}/efforts`, { token: adminTok, orgId: org._id });
  assert.strictEqual(status, 200);

  const byId = new Map(json.efforts.map((e) => [String(e._id), e]));
  assert.strictEqual(byId.get(String(E1._id)).responseCount, 2, 'override walk list');
  assert.strictEqual(byId.get(String(E2._id)).responseCount, 1, 'default walk list');
  assert.strictEqual(json.intakeResponseCount, 1, 'null-effortId bucket');

  // Default-survey coverage = intake + Σ(no-override walk lists).
  const noOverride = json.efforts.filter((e) => !e.surveyTemplateId);
  const coverage = json.intakeResponseCount + noOverride.reduce((n, e) => n + e.responseCount, 0);
  assert.strictEqual(coverage, 2);
});
