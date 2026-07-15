import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';

// Published client reports, and what they are allowed to expose.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/repsec node --test test/reportSecurity.int.test.js
//
// A published report is not the aggregate summary the privacy policy describes. Every map point is a
// household at its EXACT street address and coordinates, carrying that household's survey answers —
// "412 Elm St → Opposed". A name is a public voter-file lookup away.
//
// That is defensible: the recipient is the customer's own client, who already owns the voter file.
// What was NOT defensible is how it was protected:
//   · the share link had NO password by default and share.js waved through any link without one, so
//     a published report was an open, unauthenticated URL;
//   · the link NEVER expired — it outlived the campaign, the staffer and the client relationship,
//     and kept working from any inbox it had ever been forwarded to;
//   · `mapAnswerKeys` accepted ANY question key with no validation, so an operator could pin a
//     FREE-TEXT answer — whatever a canvasser typed — to somebody's home address, in public.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-report-security';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportMapPoint } = await import('../src/models/ClientReportMapPoint.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, SurveyTemplate, ClientReport, ClientReportMapPoint, ReportShareLink, Subscription, Household, Voter, CanvassActivity, SurveyResponse]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ada@t.co',
    passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  // A survey with BOTH a choice question and a free-text one. The free-text question is the hazard.
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true,
    questions: [
      // otherOption: the "Other: ___" write-in is the free-text channel hiding inside a CHOICE
      // question — exactly what the map sanitizer exists to stop.
      { key: 'support', label: 'Support?', type: 'single_choice', otherOption: true, options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
      { key: 'notes', label: 'Anything else?', type: 'text' },
    ],
  });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL',
    isActive: true, surveyTemplateId: template._id,
  });

  Object.assign(ctx, { org, camp, admin: { token: signUserToken(admin), orgId: org._id } });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a free-text question CANNOT be pinned to a street address in a published report', { skip }, async () => {
  const draft = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    title: 'Week 1', status: 'draft',
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true },
  });

  // 'notes' is a free-text question. A canvasser can type anything into it.
  const bad = await call('PATCH', `/admin/client-reports/${draft._id}`, {
    ...ctx.admin,
    body: { visibility: { mapAnswerKeys: ['support', 'notes'] } },
  });
  assert.strictEqual(bad.status, 400, 'a text question must be refused');
  assert.strictEqual(bad.json.code, 'MAP_ANSWER_KEYS_NOT_CHOICE');
  assert.deepStrictEqual(bad.json.rejected, ['notes']);

  const stored = await ClientReport.findById(draft._id).lean();
  assert.deepStrictEqual(stored.visibility.mapAnswerKeys, [], 'nothing was written');

  // The choice question alone is fine — this is the legitimate use.
  const ok = await call('PATCH', `/admin/client-reports/${draft._id}`, {
    ...ctx.admin,
    body: { visibility: { mapAnswerKeys: ['support'] } },
  });
  assert.strictEqual(ok.status, 200);
  const after = await ClientReport.findById(draft._id).lean();
  assert.deepStrictEqual(after.visibility.mapAnswerKeys, ['support']);
});

test('a new share link ALWAYS gets a password and an expiry', { skip }, async () => {
  // The operator supplied neither. It used to produce an open, never-expiring public URL.
  const res = await call('POST', '/admin/client-reports/shares', {
    ...ctx.admin,
    body: { campaignId: String(ctx.camp._id), label: 'Client' },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.share.hasPassword, true, 'a password was generated');
  assert.ok(res.json.share.expiresAt, 'an expiry was set');
  assert.ok(res.json.generatedPassword, 'the generated password is returned ONCE so it can be shared');
  assert.ok(res.json.generatedPassword.length >= 10);

  const stored = await ReportShareLink.findById(res.json.share.id);
  assert.ok(stored.passwordHash, 'stored hashed, never in the clear');
  assert.ok(stored.expiresAt > new Date());
  ctx.share = stored;
});

test('an expired link is refused, even with the right token', { skip }, async () => {
  const expired = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    token: 'expired-token-abc', passwordHash: 'x',
    expiresAt: new Date(Date.now() - 1000),
    isActive: true,
  });
  const res = await call('GET', `/share/${expired.token}`);
  assert.strictEqual(res.status, 410, 'an expired link must be gone, not merely password-protected');
  assert.strictEqual(res.json.code, 'SHARE_EXPIRED');
});

test('a legacy link with no expiry still works — we do not break a client\'s live URL silently', { skip }, async () => {
  // Links created before this change have expiresAt: null. Breaking them without notice would take a
  // published report offline under a customer's feet. They are sunset on notice, not by surprise.
  const legacy = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    token: 'legacy-token-xyz', passwordHash: null, expiresAt: null, isActive: true,
  });
  const res = await call('GET', `/share/${legacy.token}`);
  assert.notStrictEqual(res.status, 410, 'a legacy link must not be killed by the expiry check');
  const row = await ReportShareLink.findById(legacy._id);
  assert.strictEqual(row.isLegacyOpen(), true, 'but it is flagged so the UI can nag about it');
  ctx.legacy = row;
});

test('a share-link password can be REPLACED but never REMOVED', { skip }, async () => {
  // The published policy says report links "are protected by a password". A PATCH that nulls the
  // hash would quietly falsify that sentence for a link created under it.
  const before = await ReportShareLink.findById(ctx.share._id);
  for (const password of [null, '']) {
    const res = await call('PATCH', `/admin/client-reports/shares/${ctx.share._id}`, {
      ...ctx.admin, body: { password },
    });
    assert.strictEqual(res.status, 400, `removal via ${JSON.stringify(password)} must be refused`);
    assert.strictEqual(res.json.code, 'SHARE_PASSWORD_REQUIRED');
  }
  const unchanged = await ReportShareLink.findById(ctx.share._id);
  assert.strictEqual(unchanged.passwordHash, before.passwordHash, 'the hash was not touched');

  // Replacing is the supported path.
  const replaced = await call('PATCH', `/admin/client-reports/shares/${ctx.share._id}`, {
    ...ctx.admin, body: { password: 'NewClientPass7' },
  });
  assert.strictEqual(replaced.status, 200);
  const after = await ReportShareLink.findById(ctx.share._id);
  assert.ok(after.passwordHash && after.passwordHash !== before.passwordHash, 'the hash rotated');

  // The one permitted direction of travel for a LEGACY open link: adding a password.
  const upgraded = await call('PATCH', `/admin/client-reports/shares/${ctx.legacy._id}`, {
    ...ctx.admin, body: { password: 'FinallyLocked1' },
  });
  assert.strictEqual(upgraded.status, 200);
  assert.strictEqual(upgraded.json.share.hasPassword, true);
});

// ── The Other-write-in leak, both directions. A choice question with "Other: ___" carries
// canvasser-typed text in its answer snapshot; the public map must only ever see the canonical
// choice value ('Other'), never the typed string.

const TYPED_OTHER = 'Maria Gonzalez said call 555-0100';
const TYPED_LEGACY = 'lives at the blue duplex, works nights';

async function makeSurveyedHousehold(n, answers) {
  const hh = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, isActive: true,
    addressLine1: `${n} Elm St`, city: 'Tampa', state: 'FL', zipCode: '33601',
    normalizedAddress: `${n} ELM ST|TAMPA|FL|33601`,
    location: { type: 'Point', coordinates: [-82.46 + n / 1e4, 27.95] },
  });
  const voter = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id,
    stateVoterId: `FL${1000 + n}`, firstName: 'Test', lastName: `Voter${n}`, fullName: `Test Voter${n}`,
  });
  const admin = await User.findOne({ email: 'ada@t.co' });
  const when = new Date('2026-07-08T18:00:00Z'); // inside the report window
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id,
    userId: admin._id, actionType: 'survey_submitted',
    location: { lat: 27.95, lng: -82.46 }, timestamp: when,
  });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: hh._id,
    voterId: voter._id, userId: admin._id, surveyTemplateId: ctx.camp.surveyTemplateId,
    surveyTemplateVersion: 1,
    location: { lat: 27.95, lng: -82.46 }, submittedAt: when, answers,
  });
  return hh;
}

test('publish path: canvasser-typed Other text NEVER reaches the public map points', { skip }, async () => {
  // Three shapes: a real Other pick (optionIds carries '__other__'), a legacy snapshot-only row
  // whose text matches a canonical label, and a legacy row of pure typed text.
  const hhOther = await makeSurveyedHousehold(1, [
    { questionKey: 'support', questionLabel: 'Support?', answer: TYPED_OTHER, optionIds: ['__other__'], otherText: TYPED_OTHER },
  ]);
  const hhCanonical = await makeSurveyedHousehold(2, [
    { questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: [] },
  ]);
  const hhTyped = await makeSurveyedHousehold(3, [
    { questionKey: 'support', questionLabel: 'Support?', answer: TYPED_LEGACY, optionIds: [] },
  ]);

  const draft = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    title: 'Week 2', status: 'draft',
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: ['support'], mapAnswerKeys: ['support'], showMap: true },
  });
  const pub = await call('POST', `/admin/client-reports/${draft._id}/publish`, { ...ctx.admin });
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.json));

  const byHh = new Map(
    (await ClientReportMapPoint.find({ clientReportId: draft._id }).lean()).map((p) => [String(p.householdId), p])
  );
  assert.strictEqual(byHh.get(String(hhOther._id)).answers[0].answer, 'Other', 'an Other pick publishes as the literal choice value');
  assert.strictEqual(byHh.get(String(hhCanonical._id)).answers[0].answer, 'Yes', 'canonical labels pass through untouched');
  assert.strictEqual(byHh.get(String(hhTyped._id)).answers[0].answer, 'Other', 'legacy typed text is coerced to Other');

  const dump = JSON.stringify(await ClientReportMapPoint.find({ clientReportId: draft._id }).lean());
  assert.ok(!dump.includes(TYPED_OTHER) && !dump.includes(TYPED_LEGACY), 'no typed string survives anywhere in the frozen points');

  // The BREAKDOWN TABLES are the map's twin: legacy pre-option-id rows group on their raw
  // answer text, which for an Other write-in is whatever the canvasser typed. The public
  // breakdown may only carry canonical labels + one merged 'Other' bucket — counts intact.
  const published = await ClientReport.findById(draft._id).lean();
  const support = (published.stats?.cumulative?.surveyBreakdowns || []).find((b) => b.questionKey === 'support');
  assert.ok(support, 'the support breakdown exists');
  const byLabel = new Map(support.options.map((o) => [o.option, o.count]));
  assert.strictEqual(byLabel.get('Yes'), 1, 'canonical label kept with its exact count');
  assert.strictEqual(byLabel.get('Other'), 2, 'the __other__ pick and the typed legacy row merge into one Other bucket');
  const reportDump = JSON.stringify(published.stats);
  assert.ok(!reportDump.includes(TYPED_OTHER) && !reportDump.includes(TYPED_LEGACY), 'no typed string in any breakdown');
  ctx.publishedReport = draft;
});

test('migration path: already-frozen points from before the fix are scrubbed in place', { skip }, async () => {
  // Simulate a pre-fix frozen point: typed text stored verbatim on the published report.
  const stale = await ClientReportMapPoint.create({
    clientReportId: ctx.publishedReport._id, organizationId: ctx.org._id, campaignId: ctx.camp._id,
    lng: -82.4, lat: 27.9, addressLine1: '9 Oak St', city: 'Tampa', state: 'FL', status: 'surveyed',
    answers: [
      { questionKey: 'support', answer: TYPED_LEGACY },
      { questionKey: 'support', answer: 'No' },
      { questionKey: 'ghost-question', answer: 'orphaned row' }, // template no longer knows it
    ],
  });

  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = execFileSync(
    process.execPath,
    ['src/migrations/scrubMapPointAnswers.js', '--apply'],
    { cwd: serverRoot, env: { ...process.env, MONGODB_URI: URI }, encoding: 'utf8' }
  );
  assert.match(out, /: [1-9]\d* rewritten/, out);

  const after = await ClientReportMapPoint.findById(stale._id).lean();
  assert.deepStrictEqual(
    after.answers.map((a) => a.answer),
    ['Other', 'No'],
    'typed text → Other, canonical kept, unverifiable question dropped'
  );
  const dump = JSON.stringify(after);
  assert.ok(!dump.includes(TYPED_LEGACY) && !dump.includes('orphaned row'));

  // Idempotence: a second run changes nothing (canonical values are a fixed point).
  const again = execFileSync(
    process.execPath,
    ['src/migrations/scrubMapPointAnswers.js', '--apply'],
    { cwd: serverRoot, env: { ...process.env, MONGODB_URI: URI }, encoding: 'utf8' }
  );
  assert.match(again, /: 0 rewritten/, again);
});
