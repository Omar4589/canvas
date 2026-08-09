import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The survey answer drill-in, exercised over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/answer_drill_test node --test test/answerDrill.int.test.js
// The point of this file is the COUNTING CONTRACT: /answer-canvassers (per-canvasser
// breakdown of one option) must sum EXACTLY to that option's count on /survey-results
// for identical filters — id-native rows AND legacy text rows, with or without a date
// window (anchored to the CAMPAIGN timezone, not UTC). Also covers /voters-by-answer's
// ?userId narrowing + wasOfflineSubmission, the CSV export (campaign-tz dates, offline
// column), /responses/:id's edit/sync audit fields, and the lead campaignId gate.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-drill';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Voter } = await import('../src/models/Voter.js');
const { Household } = await import('../src/models/Household.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // seeded ids + tokens

// Campaign days are America/Chicago (CDT in June = UTC-5), so the local day 2026-06-10
// runs [2026-06-10T05:00Z, 2026-06-11T05:00Z). rB1 below sits at 02:30Z on the 11th —
// PAST midnight UTC but still the evening of the 10th at the door. Every date-window and
// CSV-date assertion leans on that row: get the timezone wrong and they all fail.
const DAY1 = '2026-06-10';

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, SurveyTemplate, SurveyResponse, Voter, Household]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Drill Org', slug: 'drill-org-test', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@d.co', passwordHash: 'x', isActive: true });
  const canvA = await User.create({ firstName: 'Al', lastName: 'Alpha', email: 'a@d.co', passwordHash: 'x', isActive: true });
  const canvB = await User.create({ firstName: 'Bo', lastName: 'Bravo', email: 'b@d.co', passwordHash: 'x', isActive: true });
  const canvC = await User.create({ firstName: 'Cy', lastName: 'Charlie', email: 'c@d.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'lead@d.co', passwordHash: 'x', isActive: true });
  const lead2 = await User.create({ firstName: 'Nog', lastName: 'Grant', email: 'lead2@d.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [canvA, canvB, canvC]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: lead2._id, organizationId: org._id, role: 'lead', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Drill Survey',
    version: 1,
    questions: [
      {
        key: 'support',
        label: 'Do you support the candidate?',
        type: 'single_choice',
        order: 0,
        options: [
          { id: 'opt_yes', text: 'Yes', order: 0 },
          { id: 'opt_no', text: 'No', tag: 'Opposed', order: 1 },
          { id: 'opt_und', text: 'Undecided', order: 2 },
        ],
      },
      {
        key: 'issues',
        label: 'Which issues matter most?',
        type: 'multiple_choice',
        order: 1,
        options: [
          { id: 'opt_econ', text: 'Economy', order: 0 },
          { id: 'opt_edu', text: 'Education', order: 1 },
          { id: 'opt_env', text: 'Environment', order: 2 },
        ],
      },
    ],
  });

  const C = await Campaign.create({
    organizationId: org._id, name: 'Drill Campaign', type: 'survey', state: 'TX',
    isActive: true, timeZone: 'America/Chicago', surveyTemplateId: template._id,
  });
  const B = await Campaign.create({
    organizationId: org._id, name: 'Unmanaged Campaign', type: 'survey', state: 'TX', isActive: true,
  });
  // lead manages C only; lead2 manages nothing.
  await CampaignManager.create({ campaignId: C._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  // Voters/households raw-inserted with just what populate reads (the drill endpoints
  // only project fullName/party + address fields). One voter per response — passId is
  // null on all rows, so the unique {voterId,passId} index demands distinct voters.
  const voterIds = Array.from({ length: 7 }, () => new mongoose.Types.ObjectId());
  await Voter.collection.insertMany(
    voterIds.map((id, i) => ({
      _id: id, organizationId: org._id, campaignId: C._id,
      fullName: `Drill Voter ${i + 1}`, party: i % 2 ? 'R' : 'D', isActive: true,
    }))
  );
  const h1 = new mongoose.Types.ObjectId();
  const h2 = new mongoose.Types.ObjectId();
  await Household.collection.insertMany([
    { _id: h1, organizationId: org._id, campaignId: C._id, addressLine1: '101 Main St', city: 'Tyler', state: 'TX', zipCode: '75701', isActive: true },
    { _id: h2, organizationId: org._id, campaignId: C._id, addressLine1: '202 Oak Ave', city: 'Tyler', state: 'TX', zipCode: '75702', isActive: true },
  ]);

  const support = (text, ids = []) => ({
    questionKey: 'support', questionLabel: 'Do you support the candidate?', answer: text, optionIds: ids,
  });
  const issues = (texts, ids) => ({
    questionKey: 'issues', questionLabel: 'Which issues matter most?', answer: texts, optionIds: ids,
  });
  let voterIdx = 0;
  const mkResp = (user, householdId, answers, extra = {}) =>
    SurveyResponse.create({
      organizationId: org._id, campaignId: C._id,
      voterId: voterIds[voterIdx++], householdId, userId: user._id,
      surveyTemplateId: template._id, surveyTemplateVersion: 1,
      answers, location: { lat: 32.35, lng: -95.3 },
      ...extra,
    });

  // The 'support' matrix for target option No (opt_no):
  //   A: No, No, Yes, Undecided(LEGACY)  → count 2 of 4 own answers (pctOfOwnAnswers 50)
  //   B: No(LEGACY, offline, past UTC midnight on day 1), No(edited, day 2) → count 2
  //   C: Yes + a multi-choice row picking TWO issues (explode semantics)
  // Option No totals: 4 all-time, 3 in the day-1 window.
  const rA1 = await mkResp(canvA, h1, [support('No', ['opt_no'])], { submittedAt: new Date('2026-06-10T15:00:00Z') });
  const rA2 = await mkResp(canvA, h1, [support('No', ['opt_no'])], { submittedAt: new Date('2026-06-10T16:00:00Z'), note: 'Prefers mail voting' });
  await mkResp(canvA, h2, [support('Yes', ['opt_yes'])], { submittedAt: new Date('2026-06-10T17:00:00Z') });
  await mkResp(canvA, h2, [support('Undecided')], { submittedAt: new Date('2026-06-10T18:00:00Z') }); // legacy: no optionIds
  const rB1 = await mkResp(canvB, h1, [support('No')], {
    submittedAt: new Date('2026-06-11T02:30:00Z'), // = 2026-06-10 21:30:00 in Chicago
    wasOfflineSubmission: true, syncedAt: new Date('2026-06-11T09:00:00Z'),
  });
  const rB2 = await mkResp(canvB, h2, [support('No', ['opt_no'])], {
    submittedAt: new Date('2026-06-12T15:00:00Z'),
    editedBy: admin._id, editedAt: new Date('2026-06-12T18:00:00Z'),
  });
  await mkResp(canvC, h1, [support('Yes', ['opt_yes']), issues(['Economy', 'Education'], ['opt_econ', 'opt_edu'])], {
    submittedAt: new Date('2026-06-12T16:00:00Z'),
  });

  Object.assign(ctx, {
    org, C, B, template, canvA, canvB, canvC, rA1, rA2, rB1, rB2,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
    lead2Tok: signUserToken(lead2),
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

// Raw-text variant for the CSV download (json() would mangle it).
async function callCsv(path, { token, orgId } = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
  });
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition'),
    text: await res.text(),
  };
}

// The identical-filter base every drill request shares (campaign + template). The
// campaignId is non-negotiable on EVERY /admin/reports/* call — the router 403s any
// lead without one, and identical filters are the whole reconciliation contract.
function drillBase() {
  return `campaignId=${ctx.C._id}&surveyTemplateId=${ctx.template._id}`;
}

function optionCount(resultsJson, qKey, optId) {
  const q = (resultsJson.questions || []).find((x) => x.key === qKey);
  const o = q?.options.find((x) => x.id === optId);
  return o ? o.count : 0;
}

test('answer-canvassers sums EXACTLY to the survey-results option count (legacy text rows included)', { skip }, async () => {
  const { adminTok, org, canvA, canvB } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const results = await call('GET', `/api/admin/reports/survey-results?${drillBase()}`, opt);
  assert.strictEqual(results.status, 200);
  // 2 id-native (A) + 1 legacy text (B) + 1 id-native (B)
  assert.strictEqual(optionCount(results.json, 'support', 'opt_no'), 4, 'survey-results No count');

  const drill = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}&questionKey=support&optionId=opt_no&option=No`, opt);
  assert.strictEqual(drill.status, 200);
  const sum = drill.json.rows.reduce((s, r) => s + r.count, 0);
  assert.strictEqual(sum, optionCount(results.json, 'support', 'opt_no'), 'rows sum to the option count');
  assert.strictEqual(drill.json.total, sum, 'total field equals the sum');

  const byUser = new Map(drill.json.rows.map((r) => [r.userId, r]));
  assert.strictEqual(byUser.get(String(canvA._id)).count, 2, 'A has 2 No');
  assert.strictEqual(byUser.get(String(canvB._id)).count, 2, 'B has 2 No (one legacy)');
  assert.strictEqual(byUser.get(String(canvA._id)).share, 50, 'share = % of the option total');
  assert.strictEqual(byUser.get(String(canvA._id)).firstName, 'Al');
  assert.strictEqual(byUser.get(String(canvA._id)).status, 'active');
  assert.strictEqual(
    new Date(byUser.get(String(canvA._id)).lastAt).toISOString(),
    '2026-06-10T16:00:00.000Z',
    'lastAt = the most recent matching submission'
  );
});

test('the reconciliation holds under a date window anchored to the CAMPAIGN timezone', { skip }, async () => {
  const { adminTok, org, canvA, canvB } = ctx;
  const opt = { token: adminTok, orgId: org._id };
  const windowQs = `${drillBase()}&from=${DAY1}&to=${DAY1}`;

  // B's legacy No is at 02:30Z on the 11th = 21:30 on the 10th in Chicago — a UTC day
  // window would count 2 here, not 3. Both endpoints must agree on 3.
  const results = await call('GET', `/api/admin/reports/survey-results?${windowQs}`, opt);
  assert.strictEqual(results.status, 200);
  assert.strictEqual(optionCount(results.json, 'support', 'opt_no'), 3, 'windowed No count is Chicago-day scoped');

  const drill = await call('GET', `/api/admin/reports/answer-canvassers?${windowQs}&questionKey=support&optionId=opt_no&option=No`, opt);
  assert.strictEqual(drill.status, 200);
  const sum = drill.json.rows.reduce((s, r) => s + r.count, 0);
  assert.strictEqual(sum, 3, 'windowed rows sum matches');
  assert.strictEqual(drill.json.total, 3);
  const byUser = new Map(drill.json.rows.map((r) => [r.userId, r]));
  assert.strictEqual(byUser.get(String(canvA._id)).count, 2);
  assert.strictEqual(byUser.get(String(canvB._id)).count, 1, 'the near-midnight-UTC row lands in day 1');
});

test('pctOfOwnAnswers is the option share of that canvasser\'s OWN answers to the question', { skip }, async () => {
  const { adminTok, org, canvA, canvB } = ctx;
  const drill = await call(
    'GET',
    `/api/admin/reports/answer-canvassers?${drillBase()}&questionKey=support&optionId=opt_no&option=No`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(drill.status, 200);
  const byUser = new Map(drill.json.rows.map((r) => [r.userId, r]));
  const a = byUser.get(String(canvA._id));
  assert.strictEqual(a.questionTotal, 4, 'A answered the question 4 times');
  assert.strictEqual(a.pctOfOwnAnswers, 50, '2 of A\'s 4 answers are No');
  const b = byUser.get(String(canvB._id));
  assert.strictEqual(b.questionTotal, 2);
  assert.strictEqual(b.pctOfOwnAnswers, 100, 'everything B recorded on this question is No');
});

test('a multi-choice response contributes 1 to EACH selected option (explode semantics)', { skip }, async () => {
  const { adminTok, org, canvC } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const results = await call('GET', `/api/admin/reports/survey-results?${drillBase()}`, opt);
  for (const optionId of ['opt_econ', 'opt_edu']) {
    const drill = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}&questionKey=issues&optionId=${optionId}`, opt);
    assert.strictEqual(drill.status, 200);
    assert.strictEqual(drill.json.total, 1, `${optionId} total`);
    assert.strictEqual(drill.json.total, optionCount(results.json, 'issues', optionId), `${optionId} reconciles with survey-results`);
    const row = drill.json.rows[0];
    assert.strictEqual(row.userId, String(canvC._id));
    assert.strictEqual(row.count, 1, 'the one response counts once per option');
    assert.strictEqual(row.questionTotal, 2, 'denominator = C\'s total SELECTIONS on the question');
    assert.strictEqual(row.pctOfOwnAnswers, 50);
  }
});

test('voters-by-answer?userId narrows to one canvasser and agrees with their answer-canvassers count', { skip }, async () => {
  const { adminTok, org, canvA, canvB } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const drill = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}&questionKey=support&optionId=opt_no&option=No`, opt);
  const aCount = drill.json.rows.find((r) => r.userId === String(canvA._id)).count;

  const mine = await call('GET', `/api/admin/reports/voters-by-answer?${drillBase()}&questionKey=support&optionId=opt_no&option=No&userId=${canvA._id}`, opt);
  assert.strictEqual(mine.status, 200);
  assert.strictEqual(mine.json.total, aCount, 'userId-filtered total = A\'s breakdown count');
  assert.strictEqual(mine.json.voters.length, aCount);
  for (const v of mine.json.voters) {
    assert.strictEqual(v.canvasser.id, String(canvA._id), 'only A\'s rows');
  }

  // ?userId also composes with TAG mode (opt_no carries the Opposed tag): B's two No
  // rows — one id-native, one legacy text — both match.
  const tagged = await call('GET', `/api/admin/reports/voters-by-answer?${drillBase()}&tag=Opposed&userId=${canvB._id}`, opt);
  assert.strictEqual(tagged.status, 200);
  assert.strictEqual(tagged.json.total, 2, 'tag drill narrowed to B');
});

test('answer-canvassers rejects tag mode and incomplete option params (400)', { skip }, async () => {
  const { adminTok, org } = ctx;
  const opt = { token: adminTok, orgId: org._id };
  // Tag rollups are distinct-voter counts — no honest per-canvasser sum, by design.
  const tag = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}&tag=Opposed`, opt);
  assert.strictEqual(tag.status, 400, 'tag mode is unsupported');
  const noKey = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}`, opt);
  assert.strictEqual(noKey.status, 400, 'questionKey required');
  const noOption = await call('GET', `/api/admin/reports/answer-canvassers?${drillBase()}&questionKey=support`, opt);
  assert.strictEqual(noOption.status, 400, 'option or optionId required');
});

test('lead gating: managed campaignId 200; missing or unmanaged campaignId 403; ungranted lead 403', { skip }, async () => {
  const { leadTok, lead2Tok, org, C, B, template } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const drillQs = `surveyTemplateId=${template._id}&questionKey=support&optionId=opt_no&option=No`;

  const ok = await call('GET', `/api/admin/reports/answer-canvassers?campaignId=${C._id}&${drillQs}`, opt);
  assert.strictEqual(ok.status, 200, 'granted lead + managed campaignId');
  const csv = await callCsv(`/api/admin/reports/voters-by-answer.csv?campaignId=${C._id}&${drillQs}`, opt);
  assert.strictEqual(csv.status, 200, 'granted lead can export the CSV');

  const bare = await call('GET', `/api/admin/reports/answer-canvassers?${drillQs}`, opt);
  assert.strictEqual(bare.status, 403, 'lead without campaignId');
  const unmanaged = await call('GET', `/api/admin/reports/answer-canvassers?campaignId=${B._id}&${drillQs}`, opt);
  assert.strictEqual(unmanaged.status, 403, 'lead with an unmanaged campaignId');
  const ungranted = await call('GET', `/api/admin/reports/answer-canvassers?campaignId=${C._id}&${drillQs}`, { token: lead2Tok, orgId: org._id });
  assert.strictEqual(ungranted.status, 403, 'lead with no grant at all');
});

test('CSV export: attachment headers, campaign-timezone dates, offline flag, exact row count', { skip }, async () => {
  const { adminTok, org, rA1, rB1 } = ctx;
  const csv = await callCsv(
    `/api/admin/reports/voters-by-answer.csv?${drillBase()}&questionKey=support&optionId=opt_no&option=No`,
    { token: adminTok, orgId: org._id }
  );
  assert.strictEqual(csv.status, 200);
  assert.ok(csv.type.startsWith('text/csv'), `content-type is csv (${csv.type})`);
  assert.match(csv.disposition, /^attachment/, 'served as a download');

  // Seeded cells contain no commas/quotes, so plain splits are safe here.
  const lines = csv.text.split('\n');
  const headers = lines[0].split(',');
  assert.ok(headers.some((h) => h.startsWith('Time (')), 'Time column names the campaign zone');
  assert.ok(headers.includes('Offline submission'), 'offline column present');
  assert.strictEqual(lines.length - 1, 4, 'one row per matching response, unpaginated');

  const col = (name) => headers.findIndex((h) => h === name || (name === 'Time' && h.startsWith('Time (')));
  const rowOf = (r) => lines.find((l) => l.includes(String(r._id))).split(',');

  // The offline row was submitted 02:30Z on the 11th = the evening of the 10th in
  // Chicago: ISO keeps the UTC instant, Date/Time show the campaign's wall clock.
  const offline = rowOf(rB1);
  assert.strictEqual(offline[col('Submitted (ISO)')], '2026-06-11T02:30:00.000Z');
  assert.strictEqual(offline[col('Date')], DAY1, 'Date column is the campaign-tz day');
  assert.strictEqual(offline[col('Time')], '21:30:00', 'hh:mm:ss on the campaign clock');
  assert.strictEqual(offline[col('Offline submission')], 'yes');
  assert.strictEqual(rowOf(rA1)[col('Offline submission')], 'no');
});

test('voters-by-answer rows carry wasOfflineSubmission; the response detail exposes syncedAt/editedAt/editedBy', { skip }, async () => {
  const { adminTok, org, C, rA2, rB1, rB2 } = ctx;
  const opt = { token: adminTok, orgId: org._id };

  const list = await call('GET', `/api/admin/reports/voters-by-answer?${drillBase()}&questionKey=support&optionId=opt_no&option=No`, opt);
  assert.strictEqual(list.status, 200);
  const byId = new Map(list.json.voters.map((v) => [v.responseId, v]));
  assert.strictEqual(byId.get(String(rB1._id)).wasOfflineSubmission, true);
  assert.strictEqual(byId.get(String(rA2._id)).wasOfflineSubmission, false);
  assert.strictEqual(byId.get(String(rA2._id)).note, 'Prefers mail voting');

  const edited = await call('GET', `/api/admin/reports/responses/${rB2._id}?campaignId=${C._id}`, opt);
  assert.strictEqual(edited.status, 200);
  assert.strictEqual(new Date(edited.json.response.editedAt).toISOString(), '2026-06-12T18:00:00.000Z');
  assert.strictEqual(edited.json.response.editedBy.firstName, 'Ada');
  assert.ok(edited.json.response.syncedAt, 'syncedAt always present');

  const offline = await call('GET', `/api/admin/reports/responses/${rB1._id}?campaignId=${C._id}`, opt);
  assert.strictEqual(offline.status, 200);
  assert.strictEqual(offline.json.response.wasOfflineSubmission, true);
  assert.ok(
    new Date(offline.json.response.syncedAt) > new Date(offline.json.response.submittedAt),
    'offline syncedAt trails submittedAt'
  );
  assert.strictEqual(offline.json.response.editedAt, null, 'never-edited row stays null');
});

// ── The "Other: ___" write-in ────────────────────────────────────────────────
//
// The write-in is a question FLAG, not a row in options[], so reporting has to materialize the
// `__other__` sentinel by hand. Before it did, the whole bucket was broken END TO END: the chart
// showed a bar labelled with the raw sentinel and badged "retired", and every drill behind it
// returned ZERO — the bucket carried a null id, so the drill fell back to matching the LABEL
// against `answers.answer`, which holds the canvasser's typed text and can never equal '__other__'.
//
// Self-contained fixture (its own org/campaign/template) so it can't perturb the counting-contract
// assertions above. Deliberately includes a real option ALSO named "Other" — the collision that
// makes a text-keyed implementation steal rows.
test('write-in answers: counted, labelled, drillable, and never confused with a real "Other" option', { skip }, async () => {
  const org2 = await Organization.create({ name: 'Other Org', slug: 'other-org-test', isActive: true });
  const admin2 = await User.create({ firstName: 'Otto', lastName: 'Admin', email: 'otto@o.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin2._id, organizationId: org2._id, role: 'admin', isActive: true });
  const canv = await User.create({ firstName: 'Wren', lastName: 'Wright', email: 'wren@o.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org2._id, role: 'canvasser', isActive: true });

  const tpl = await SurveyTemplate.create({
    organizationId: org2._id,
    name: 'Write-in Survey',
    version: 1,
    questions: [{
      key: 'issue',
      label: 'Top issue?',
      type: 'single_choice',
      order: 0,
      otherOption: true,
      options: [
        { id: 'opt_roads', text: 'Roads', order: 0 },
        // A hand-authored option literally named "Other". Nothing forbids this, and it is what
        // breaks any implementation that matches the write-in by its label.
        { id: 'opt_other', text: 'Other', order: 1 },
      ],
    }],
  });
  const camp = await Campaign.create({
    organizationId: org2._id, name: 'Write-in Campaign', type: 'survey', state: 'TX',
    isActive: true, timeZone: 'America/Chicago', surveyTemplateId: tpl._id,
  });

  const vIds = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  await Voter.collection.insertMany(vIds.map((id, i) => ({
    _id: id, organizationId: org2._id, campaignId: camp._id, fullName: `Write-in Voter ${i + 1}`, isActive: true,
  })));
  const hh = new mongoose.Types.ObjectId();
  await Household.collection.insertMany([{
    _id: hh, organizationId: org2._id, campaignId: camp._id,
    addressLine1: '9 Elm St', city: 'Tyler', state: 'TX', zipCode: '75701', isActive: true,
  }]);

  let vi = 0;
  const mk = (answers) => SurveyResponse.create({
    organizationId: org2._id, campaignId: camp._id, voterId: vIds[vi++], householdId: hh,
    userId: canv._id, surveyTemplateId: tpl._id, surveyTemplateVersion: 1,
    submittedAt: new Date('2026-06-10T18:00:00Z'),
    location: { lat: 32.35, lng: -95.3 }, // required — every survey carries its GPS stamp
    answers,
  });
  const row = (answer, optionIds, otherText = null) => ([{
    questionKey: 'issue', questionLabel: 'Top issue?', answer, optionIds, otherText,
  }]);

  // Two write-ins (the capture flow snapshots the TYPED TEXT as `answer`), one real "Other"
  // option pick, one canonical, and one legacy pre-option-id row whose snapshot reads 'Other'.
  await mk(row('potholes', ['__other__'], 'potholes'));
  await mk(row('speeding', ['__other__'], 'speeding'));
  await mk(row('Other', ['opt_other']));
  await mk(row('Roads', ['opt_roads']));
  await mk(row('Other', []));

  const opt = { token: signUserToken(admin2), orgId: org2._id };
  const results = await call('GET', `/api/admin/reports/survey-results?campaignId=${camp._id}`, opt);
  assert.strictEqual(results.status, 200);
  const q = results.json.questions.find((x) => x.key === 'issue');

  const writeIn = q.options.find((o) => o.id === '__other__');
  assert.ok(writeIn, 'the write-in gets its own bucket keyed on the sentinel');
  assert.strictEqual(writeIn.count, 2, 'both typed answers land in it — and nothing else does');
  assert.strictEqual(writeIn.retired, false, 'it is a live choice, not a deleted option');
  assert.notStrictEqual(writeIn.option, '__other__', 'the raw sentinel is never shown to a human');

  // The real option named "Other" keeps its own rows: its id-native pick AND the legacy row whose
  // snapshot text matches its label. Seeding the sentinel by TEXT would have stolen these.
  const realOther = q.options.find((o) => o.id === 'opt_other');
  assert.strictEqual(realOther.count, 2, 'the hand-authored "Other" option keeps its own answers');

  // Two buckets, two distinct labels — a shared label collides as a React key and expand-state.
  const labels = q.options.map((o) => o.option);
  assert.strictEqual(new Set(labels).size, labels.length, 'no two buckets share a label');
  assert.strictEqual(q.options.reduce((s, o) => s + o.count, 0), 5, 'every response is counted once');

  // THE DRILL. This returned zero rows before the fix.
  const drill = await call(
    'GET',
    `/api/admin/reports/voters-by-answer?campaignId=${camp._id}&questionKey=issue` +
      `&optionId=__other__&option=${encodeURIComponent(writeIn.option)}&surveyTemplateId=${tpl._id}`,
    opt
  );
  assert.strictEqual(drill.status, 200);
  assert.strictEqual(drill.json.total, 2, 'the drill returns exactly the write-ins');
  const typed = drill.json.voters.map((r) => r.answer).sort();
  // Self-describing: a write-in of "potholes" must not read identically to a canonical option
  // someone happened to name "potholes".
  assert.deepStrictEqual(typed, ['Other — potholes', 'Other — speeding']);

  // The per-canvasser breakdown must sum to the same number — this file's counting contract.
  const byCanv = await call(
    'GET',
    `/api/admin/reports/answer-canvassers?campaignId=${camp._id}&questionKey=issue` +
      `&optionId=__other__&option=${encodeURIComponent(writeIn.option)}&surveyTemplateId=${tpl._id}`,
    opt
  );
  assert.strictEqual(byCanv.status, 200);
  assert.strictEqual(
    byCanv.json.rows.reduce((s, r) => s + r.count, 0),
    writeIn.count,
    'answer-canvassers sums EXACTLY to the survey-results count for the write-in'
  );
});
