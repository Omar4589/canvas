import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The admin map's answer filter with ?surveyTemplateId scoping, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/map_answer_scope_test node --test test/mapAnswerScope.int.test.js
// Question keys and option ids are label slugs, unique only WITHIN one survey template —
// two templates can both carry (support, opt_yes). Seed exactly that collision, one
// response per template in DIFFERENT households, and prove: surveyTemplateId narrows the
// answer filter to that template's household; omitting it keeps the documented legacy
// cross-template union (old mobile builds); a valid-but-unknown template id returns 200
// with zero households (never an error, never a silent widen).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-map-answer-scope';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Voter } = await import('../src/models/Voter.js');
const { Household } = await import('../src/models/Household.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Both templates carry THIS question — identical key, identical option id slugs. The
// whole point of the fixture: without a template scope the two are indistinguishable.
const QUESTIONS = [
  {
    key: 'support',
    label: 'Do you support the candidate?',
    type: 'single_choice',
    order: 0,
    options: [
      { id: 'opt_yes', text: 'Yes', order: 0 },
      { id: 'opt_no', text: 'No', order: 1 },
    ],
  },
];

function hh(orgId, campaignId, n) {
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${n} Scope St`,
    city: 'Tyler',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} SCOPE ST|TYLER|TX|75701`,
    location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
    isActive: true,
    status: 'surveyed',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, SurveyTemplate, SurveyResponse, Voter, Household]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Scope Org', slug: 'scope-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ms@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  const t1 = await SurveyTemplate.create({ organizationId: org._id, name: 'Template One', version: 1, questions: QUESTIONS });
  const t2 = await SurveyTemplate.create({ organizationId: org._id, name: 'Template Two', version: 1, questions: QUESTIONS });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Scope C', type: 'survey', state: 'TX', isActive: true,
    surveyTemplateId: t1._id,
  });

  const [hA, hB] = await Household.insertMany([hh(org._id, camp._id, 1), hh(org._id, camp._id, 2)]);
  const vA = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: hA._id, stateVoterId: 'TXS1',
    firstName: 'Ann', lastName: 'Answers', fullName: 'Ann Answers',
  });
  const vB = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: hB._id, stateVoterId: 'TXS2',
    firstName: 'Ben', lastName: 'Bothtem', fullName: 'Ben Bothtem',
  });

  // One 'Yes' per template, in different households — same questionKey, same optionId.
  const answer = { questionKey: 'support', questionLabel: 'Do you support the candidate?', answer: 'Yes', optionIds: ['opt_yes'] };
  const mkResp = (template, voter, householdId) =>
    SurveyResponse.create({
      organizationId: org._id, campaignId: camp._id,
      voterId: voter._id, householdId, userId: admin._id,
      surveyTemplateId: template._id, surveyTemplateVersion: 1,
      answers: [answer], location: { lat: 32.35, lng: -95.3 },
      submittedAt: new Date('2026-06-10T15:00:00Z'),
    });
  await mkResp(t1, vA, hA._id);
  await mkResp(t2, vB, hB._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, t1, t2, hA, hB, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function callMap(qs) {
  const res = await fetch(`${base}/api/admin/households/map?${qs}`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

function answerQs() {
  return `campaignId=${ctx.camp._id}&questionKey=support&optionId=opt_yes`;
}

test('surveyTemplateId scopes the answer filter to ONE template\'s households', { skip }, async () => {
  const { t1, t2, hA, hB } = ctx;

  const scoped1 = await callMap(`${answerQs()}&surveyTemplateId=${t1._id}`);
  assert.strictEqual(scoped1.status, 200);
  assert.deepStrictEqual(
    scoped1.json.households.map((h) => h.id),
    [String(hA._id)],
    'T1 scope returns exactly T1\'s household — the identical (support, opt_yes) in T2 no longer bleeds in'
  );

  // The mirror scope proves it's real filtering, not accidental ordering.
  const scoped2 = await callMap(`${answerQs()}&surveyTemplateId=${t2._id}`);
  assert.strictEqual(scoped2.status, 200);
  assert.deepStrictEqual(scoped2.json.households.map((h) => h.id), [String(hB._id)]);
});

test('without surveyTemplateId the legacy cross-template union is preserved', { skip }, async () => {
  const { hA, hB } = ctx;
  // Old mobile builds never send the param — their behavior must not change: the
  // answer filter matches (questionKey, optionId) across EVERY template of the campaign.
  const union = await callMap(answerQs());
  assert.strictEqual(union.status, 200);
  assert.deepStrictEqual(
    union.json.households.map((h) => h.id).sort(),
    [String(hA._id), String(hB._id)].sort(),
    'both templates\' households — the documented legacy union'
  );
});

test('an unknown/foreign template id yields 200 + zero households, never an error', { skip }, async () => {
  const foreign = new mongoose.Types.ObjectId();
  const r = await callMap(`${answerQs()}&surveyTemplateId=${foreign}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.households, [], 'no responses under that template — empty, not a widen');
  assert.ok(Array.isArray(r.json.canvassers), 'the roster still ships on the empty path (dropdown never wedges)');
});
