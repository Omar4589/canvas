import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// "Before you publish" and History leftovers from stage 1 (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F5,
// §O5, §O8, G5), against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/checks node --test test/clientReportChecks.int.test.js
//
//   · an area report names every other shown report on the link that could narrow down what its areas
//     keep hidden (one that maps the same question, or charts it for a narrower scope);
//   · the usable-link line names why there is none — no link, expired, LOCKED, disabled;
//   · Erase's dry run names, by period, the later drafts Next copied the text into.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-report-checks';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { processClientReportJob } = await import('../src/services/reports/clientReportBuilds.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};

const call = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const at = (day, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-05:00`);

let n = 0;
const surveyedDoor = async (camp, when, support, { effortId = null } = {}) => {
  n += 1;
  const hh = await Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true, effortId,
    addressLine1: `${n} Check St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `CHECK${n}`,
    location: { type: 'Point', coordinates: [-82.46 + n / 1e4, 27.95] },
  });
  await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, effortId, userId: ctx.admin._id, actionType: 'survey_submitted', timestamp: when, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 } });
  const v = await Voter.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `CK${n}`, firstName: 'C', lastName: `K${n}`, fullName: `C K${n}` });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, effortId, voterId: v._id, userId: ctx.admin._id,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 }, submittedAt: when,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', optionIds: [support === 'Yes' ? 'y' : 'n'], answer: support }],
  });
};

const runBuild = async (reportId) => {
  const jobId = new ObjectId().toHexString();
  await ClientReport.updateOne({ _id: reportId }, { $set: { 'build.status': 'queued', 'build.jobId': jobId, 'build.startedAt': new Date() } });
  const out = await processClientReportJob({ id: jobId, data: { reportId: String(reportId) }, moveToDelayed: async () => {}, updateProgress: async () => {} }, 'token');
  assert.ok(out?.committed, `the build committed: ${JSON.stringify(out)}`);
  return ClientReport.findById(reportId).lean();
};
const create = async (camp, body) => {
  const res = await call('POST', '/admin/client-reports', { campaignId: String(camp._id), ...body });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json.report;
};
const patch = async (id, body) => {
  const res = await call('PATCH', `/admin/client-reports/${id}`, body);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.report;
};
const rebuild = async (id) => {
  const res = await call('POST', `/admin/client-reports/${id}/recompute`);
  assert.strictEqual(res.status, 202, JSON.stringify(res.json));
  return runBuild(id);
};
const publish = async (r) => {
  const res = await call('POST', `/admin/client-reports/${r._id}/publish`, { snapshotId: String(r.snapshotId), editVersion: r.editVersion ?? 0 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.report;
};
const checksOf = async (id) => {
  const res = await call('GET', `/admin/client-reports/${id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  return res.json.checks;
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ClientReportSeries.syncIndexes();
  const org = await Organization.create({ name: 'Checks Org', slug: 'checks-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@checks.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Checks', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] }],
  });
  Object.assign(ctx, { org, admin, template, token: signUserToken(admin), pass: new ObjectId() });
  const campaign = (name) => Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id, timeZone: 'America/Chicago' });
  ctx.links = await campaign('Links');
  ctx.area = await campaign('Areas');
  ctx.erase = await campaign('Erase');
  ctx.north = await Effort.create({ organizationId: org._id, campaignId: ctx.area._id, name: 'North' });
  for (const camp of [ctx.links, ctx.area, ctx.erase]) {
    await surveyedDoor(camp, at('2026-07-01'), 'Yes');
    await surveyedDoor(camp, at('2026-07-08'), 'No');
  }
  await surveyedDoor(ctx.area, at('2026-07-02'), 'Yes', { effortId: ctx.north._id });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the usable-link line names why there is none: no link, locked, expired, disabled', { skip }, async () => {
  const draft = await create(ctx.links, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  let c = await checksOf(draft._id);
  assert.deepStrictEqual([c.links.usable, c.links.reason], [0, 'no_link']);
  const made = await call('POST', '/admin/client-reports/shares', { campaignId: String(ctx.links._id), label: 'Candidate' });
  assert.strictEqual(made.status, 201);
  const id = made.json.share.id;
  c = await checksOf(draft._id);
  assert.deepStrictEqual([c.links.usable, c.links.reason, c.links.labels], [1, null, ['Candidate']]);
  const now = Date.now();
  await ReportShareLink.updateOne({ _id: id }, { $set: { failedUnlockAt: Array.from({ length: 50 }, (_, i) => ({ at: new Date(now - 1000 * (i + 1)), id: `l${i}` })) } });
  c = await checksOf(draft._id);
  assert.deepStrictEqual([c.links.usable, c.links.reason], [0, 'locked'], '"Your only link is locked — unlock or rotate it"');
  await call('POST', `/admin/client-reports/shares/${id}/unlock`);
  await ReportShareLink.updateOne({ _id: id }, { $set: { expiresAt: new Date(now - 1000) } });
  c = await checksOf(draft._id);
  assert.deepStrictEqual([c.links.usable, c.links.reason], [0, 'expired']);
  await call('PATCH', `/admin/client-reports/shares/${id}`, { isActive: false });
  c = await checksOf(draft._id);
  assert.deepStrictEqual([c.links.usable, c.links.reason], [0, 'disabled']);
});

test('an area report names the other reports on the link that could narrow down its hidden answers', { skip }, async () => {
  // Week 1, exact doors, the support question on the map — published.
  const pins = await publish(await runBuild((await create(ctx.area, { weekStart: '2026-06-29', weekEnd: '2026-07-05' }))._id));
  // Week 1 again, one walk list, its chart shown and no map — published.
  const walk = await create(ctx.area, { weekStart: '2026-06-29', weekEnd: '2026-07-05', effortId: String(ctx.north._id) });
  await patch(walk._id, { visibility: { showMap: false } });
  const walkBuilt = await rebuild(walk._id);
  assert.ok(walkBuilt.stats.cumulative.surveyBreakdowns.some((b) => b.questionKey === 'support'));
  await publish(walkBuilt);
  // Week 2 as an AREA report (a draft: the mode is an ordinary setting until its build).
  const draft = await create(ctx.area, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  await patch(draft._id, { visibility: { mapMode: 'area', areaSize: 'large' } });
  const area = await rebuild(draft._id);
  assert.strictEqual(area.snapshotInputs.mapMode, 'area');

  let c = await checksOf(area._id);
  assert.strictEqual(c.areaNarrowedBy.length, 1);
  const support = c.areaNarrowedBy[0];
  assert.strictEqual(support.key, 'support');
  assert.strictEqual(support.label, 'Support?');
  const how = Object.fromEntries(support.reports.map((r) => [r.id, r.how]));
  assert.deepStrictEqual(how, { [String(pins._id)]: 'doors', [String(walkBuilt._id)]: 'chart' });
  assert.ok(support.reports.every((r) => r.period === 'Jun 29 – Jul 5, 2026'));
  assert.strictEqual(support.reports.find((r) => r.id === String(walkBuilt._id)).scopeLabel, 'North');

  // A taken-down report is no longer on the link.
  await call('POST', `/admin/client-reports/${pins._id}/take-down`);
  c = await checksOf(area._id);
  assert.deepStrictEqual(c.areaNarrowedBy[0].reports.map((r) => r.id), [String(walkBuilt._id)]);
  // An exact-doors report gets no such warning: its doors are already on the map.
  assert.deepStrictEqual((await checksOf(pins._id)).areaNarrowedBy, []);
});

test('Erase’s dry run names, by period, the later drafts Next copied the text into — and only those still holding it', { skip }, async () => {
  const draft = await create(ctx.erase, { weekStart: '2026-06-29', weekEnd: '2026-07-05' });
  await patch(draft._id, { observations: [{ heading: 'Voter intent', body: 'Strong support on Elm St' }] });
  const published = await publish(await rebuild(draft._id));
  const nextRes = await call('POST', `/admin/client-reports/${published._id}/next`);
  assert.strictEqual(nextRes.status, 201, JSON.stringify(nextRes.json));
  const copied = nextRes.json.report;
  assert.strictEqual(copied.observations[0].body, 'Strong support on Elm St');
  // The published report's text is edited: History keeps the earlier text.
  await patch(published._id, { observations: [{ heading: 'Voter intent', body: 'Rewritten' }] });

  const dry = async () => {
    const res = await call('POST', `/admin/campaigns/${ctx.erase._id}/history/erase`, { clientReportId: String(published._id), dryRun: true });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    return res.json;
  };
  let res = await dry();
  assert.strictEqual(res.rows, 1);
  assert.strictEqual(res.copiedDrafts, 1);
  assert.deepStrictEqual(res.copiedDraftPeriods, ['Jul 6 – Jul 12, 2026'], 'the confirm can name the draft');
  // Once the draft's copied notes are rewritten it holds none of the text, and isn't named.
  await patch(copied._id, { observations: [{ heading: 'This week', body: 'Fresh notes' }] });
  res = await dry();
  assert.deepStrictEqual([res.copiedDrafts, res.copiedDraftPeriods], [0, []]);
  assert.strictEqual((await ClientReport.findById(published._id).lean()).eraseEpoch ?? null, null, 'a dry run writes nothing');
});

// ── Surveys whose old conditions aren't known (round-1 review: LEGACY-1, contract C3) ──────────

const yesNo = [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }];
const pick = (questionKey, id, text) => ({ questionKey, questionLabel: questionKey, optionIds: [id], answer: text });
// A knocked door with one response on the given survey, recorded under `version` of it.
const answeredDoor = async (camp, survey, when, answers, { version = 1 } = {}) => {
  n += 1;
  const hh = await Household.create({
    organizationId: ctx.org._id, campaignId: camp._id, isActive: true,
    addressLine1: `${n} Version St`, city: 'Tampa', state: 'FL', zipCode: '33601', normalizedAddress: `VERSION${n}`,
    location: { type: 'Point', coordinates: [-82.46 + n / 1e4, 27.95] },
  });
  await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, userId: ctx.admin._id, actionType: 'survey_submitted', timestamp: when, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 } });
  const v = await Voter.create({ organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: `VS${n}`, firstName: 'V', lastName: `S${n}`, fullName: `V S${n}` });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: camp._id, householdId: hh._id, voterId: v._id, userId: ctx.admin._id,
    surveyTemplateId: survey._id, surveyTemplateVersion: version, passId: ctx.pass, location: { lat: 27.95, lng: -82.46 }, submittedAt: when, answers,
  });
};
const campaignOn = (name, survey) =>
  Campaign.create({ organizationId: ctx.org._id, name, type: 'survey', state: 'FL', isActive: true, surveyTemplateId: survey._id, timeZone: 'America/Chicago' });
// depsEverFromVersion is the migration's field on SurveyTemplate; written raw, so this suite never
// depends on the model declaring it.
const setSurvey = (survey, fields) => SurveyTemplate.collection.updateOne({ _id: survey._id }, { $set: fields });

test('conditionsUnknown: answers from a version older than the survey’s follow-up record, while the map is on and a chart hidden', { skip }, async () => {
  const survey = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'Versions', isActive: true,
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: yesNo },
      { key: 'sign', label: 'Yard sign?', type: 'single_choice', options: [{ id: 's1', text: 'Yes' }, { id: 's2', text: 'No' }], visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['y'] }] } },
    ],
  });
  const camp = await campaignOn('Versions', survey);
  await answeredDoor(camp, survey, at('2026-07-07'), [pick('support', 'y', 'Yes'), pick('sign', 's1', 'Yes')]);
  await answeredDoor(camp, survey, at('2026-07-08'), [pick('support', 'n', 'No')]);
  const r = await runBuild((await create(camp, { weekStart: '2026-07-06', weekEnd: '2026-07-12' }))._id);
  const unknown = async () => (await checksOf(r._id)).conditionsUnknown;
  assert.strictEqual(await unknown(), false, 'nothing hidden');
  await patch(r._id, { visibility: { visibleQuestionKeys: ['sign'] } });
  assert.strictEqual(await unknown(), false, 'a chart hidden, but every answer is from the current version');
  // The survey was edited since: version 2 knows its own conditions, not version 1's.
  await setSurvey(survey, { version: 2 });
  assert.strictEqual(await unknown(), true);
  // The record runs from version 1 (the migration seeded it there): those answers' conditions are known.
  await setSurvey(survey, { depsEverFromVersion: 1 });
  assert.strictEqual(await unknown(), false);
  await setSurvey(survey, { depsEverFromVersion: 2 });
  assert.strictEqual(await unknown(), true);
  assert.strictEqual((await checksOf(r._id)).multipleSurveyVersions, undefined, 'replaced by conditionsUnknown');
  // With the map off, no map question can hint at anything.
  await patch(r._id, { visibility: { showMap: false } });
  assert.strictEqual(await unknown(), false);
});

test('a report from before snapshots takes its follow-ups from every survey its answers came from — checks and area warnings alike', { skip }, async () => {
  // The campaign's answers came from an old survey whose Support question was a follow-up of a
  // screening question; the campaign has since moved to a new survey with no conditions at all.
  const old = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'Old survey', isActive: false,
    questions: [
      { key: 'screen', label: 'Registered here?', type: 'single_choice', options: yesNo },
      { key: 'support', label: 'Support?', type: 'single_choice', options: yesNo, visibleIf: { logic: 'all', rules: [{ questionKey: 'screen', op: 'is', optionIds: ['y'] }] } },
    ],
  });
  await setSurvey(old, { version: 3 });
  const current = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'New survey', isActive: true,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: yesNo }],
  });
  const camp = await campaignOn('Swapped', current);
  await answeredDoor(camp, old, at('2026-07-07'), [pick('screen', 'y', 'Yes'), pick('support', 'y', 'Yes')]);
  await answeredDoor(camp, old, at('2026-07-08'), [pick('screen', 'y', 'Yes'), pick('support', 'n', 'No')]);
  const breakdowns = [
    { questionKey: 'screen', questionLabel: 'Registered here?', type: 'single_choice', options: [{ option: 'Yes', count: 2, percent: 100 }] },
    { questionKey: 'support', questionLabel: 'Support?', type: 'single_choice', options: [{ option: 'Yes', count: 1, percent: 50 }, { option: 'No', count: 1, percent: 50 }] },
  ];
  // Published before this upgrade: no snapshot, no snapshotInputs.
  const legacyReport = (visibility) =>
    ClientReport.create({
      organizationId: ctx.org._id, campaignId: camp._id, campaignType: 'survey',
      weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
      rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
      status: 'published', publishedAt: new Date(),
      stats: { cumulative: { totals: { doorsKnocked: 2 }, surveyBreakdowns: breakdowns }, period: { totals: { doorsKnocked: 2 }, surveyBreakdowns: breakdowns } },
      visibility: { showMap: true, ...visibility },
    });
  // The screening question hidden; Support charted and on the map.
  const hiding = await legacyReport({ visibleQuestionKeys: ['support'], mapAnswerKeys: ['support'] });
  assert.strictEqual((await ClientReport.findById(hiding._id).lean()).snapshotInputs, undefined);
  const c = await checksOf(hiding._id);
  assert.deepStrictEqual(
    c.hiddenParentCharts.map((h) => [h.key, h.parents.map((p) => p.key)]),
    [['support', ['screen']]],
    'the old survey’s condition, though today’s survey has none'
  );
  assert.strictEqual(c.conditionsUnknown, true, 'answers under version 1 of a survey now at version 3 — computed with no snapshot');
  // Both questions shown and mapped: Support is served with its parent, so this one can narrow down
  // an area report's Support answers door by door; the first serves no Support pins at all.
  const showing = await legacyReport({ visibleQuestionKeys: ['screen', 'support'], mapAnswerKeys: ['screen', 'support'] });
  // An area report on today's survey (its first build commits before the switch to areas).
  const draft = await runBuild((await create(camp, { weekStart: '2026-07-13', weekEnd: '2026-07-19' }))._id);
  await patch(draft._id, { visibility: { mapMode: 'area', areaSize: 'large' } });
  const area = await rebuild(draft._id);
  assert.strictEqual(area.snapshotInputs.mapMode, 'area');
  const support = (await checksOf(area._id)).areaNarrowedBy.find((x) => x.key === 'support');
  assert.deepStrictEqual(support?.reports.map((r) => [r.id, r.how]), [[String(showing._id), 'doors']]);
});
