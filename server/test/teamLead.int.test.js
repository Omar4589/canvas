import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Authorization matrix for the team-lead (campaign-scoped admin) role, exercised over the
// REAL Express app + a throwaway mongod (no Redis — we test the Redis-free authz paths):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/lead_test node --test test/teamLead.int.test.js
// Seed: one org, an admin, a canvasser, and a lead granted campaign A only (with a campaign B
// they do NOT manage). Assert a lead can run A but is 403 on B, on campaign CRUD, on the org
// survey/tag mutations and the org Users admin — while allowed to read libraries, run their
// crew, and read A's voters (never B's, and never the org-wide directory).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-team-lead';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Effort } = await import('../src/models/Effort.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Voter } = await import('../src/models/Voter.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // { org, A, B, adminTok, leadTok }

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Household, CanvassActivity, ReportShareLink, SurveyTemplate, Effort, Voter, SurveyResponse, VoterNote]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Test Org', slug: 'test-org-lead', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'lead@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  // A canvasser: no admin surface at all, campaign Voters tab included.
  const canv = await User.create({ firstName: 'Cy', lastName: 'Walker', email: 'walker@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const A = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'KY', isActive: true });
  const B = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'KY', isActive: true });
  await CampaignManager.create({ campaignId: A._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  // Survey authoring scope fixtures:
  //  - survOverrideA: attached to MANAGED campaign A via a walk-list override (not A's
  //    default, which a later test nulls out) → lead may edit/duplicate.
  //  - survDefaultB: attached only to UNMANAGED campaign B's default → lead may NOT.
  //  - survLeadDraft: authored by the lead, unattached → lead may edit (createdBy branch).
  const survOverrideA = await SurveyTemplate.create({ organizationId: org._id, name: 'Override A', createdBy: admin._id, version: 1 });
  await Effort.create({ organizationId: org._id, campaignId: A._id, name: 'WL-A', surveyTemplateId: survOverrideA._id });
  const survDefaultB = await SurveyTemplate.create({ organizationId: org._id, name: 'Default B', createdBy: admin._id, version: 1 });
  B.surveyTemplateId = survDefaultB._id;
  await B.save();
  const survLeadDraft = await SurveyTemplate.create({ organizationId: org._id, name: 'Lead Draft', createdBy: lead._id, version: 1 });

  // A household in each campaign, for the /:householdId/activity scoping test. Raw insert
  // (bypass schema requireds) — the handler only needs _id + organizationId + campaignId.
  const hhA = new mongoose.Types.ObjectId();
  const hhB = new mongoose.Types.ObjectId();
  await Household.collection.insertMany([
    { _id: hhA, campaignId: A._id, organizationId: org._id, isActive: true },
    { _id: hhB, campaignId: B._id, organizationId: org._id, isActive: true },
  ]);

  // Voter rows for the campaign Voters tab test. A SHARED person — one row per campaign, the
  // sibling pair the profile unions for an admin and must NOT union for a lead — plus an A-only
  // row so A's directory has a count worth checking. One survey and one admin note per sibling
  // (on a template attached to nothing and authored by the admin, so it never enters the lead's
  // survey list); a do-not-contact flag on both siblings (the org-wide invariant) and an email on
  // the A row — owner rulings 1 and 2: both are shown to a lead. Real documents, not raw
  // inserts: the directory and the profile read every identity field.
  const survFixture = await SurveyTemplate.create({ organizationId: org._id, name: 'Responses fixture', createdBy: admin._id, version: 1 });
  const dnc = { flagged: true, at: new Date(), byUserId: admin._id, reason: 'Asked us to stop calling', source: 'admin' };
  const voterA = await Voter.create({
    organizationId: org._id, campaignId: A._id, householdId: hhA, stateVoterId: 'KY-SHARED-1',
    firstName: 'Ann', lastName: 'Alpha', fullName: 'Ann Alpha', email: 'ann@example.com', doNotContact: dnc,
  });
  const voterB = await Voter.create({
    organizationId: org._id, campaignId: B._id, householdId: hhB, stateVoterId: 'KY-SHARED-1',
    firstName: 'Ann', lastName: 'Alpha', fullName: 'Ann Alpha', doNotContact: dnc,
  });
  const voterA2 = await Voter.create({
    organizationId: org._id, campaignId: A._id, householdId: hhA, stateVoterId: 'KY-A-ONLY-2',
    firstName: 'Bob', lastName: 'Beta', fullName: 'Bob Beta',
  });
  const response = (campaign, voter, householdId) => ({
    organizationId: org._id, campaignId: campaign._id, householdId, voterId: voter._id, userId: admin._id,
    surveyTemplateId: survFixture._id, surveyTemplateVersion: 1,
    location: { lat: 38.19, lng: -84.87 }, submittedAt: new Date(),
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes' }],
  });
  await SurveyResponse.create([response(A, voterA, hhA), response(B, voterB, hhB)]);
  await VoterNote.create([
    { organizationId: org._id, voterId: voterA._id, authorId: admin._id, body: 'Note on the A row' },
    { organizationId: org._id, voterId: voterB._id, authorId: admin._id, body: 'Note on the B row' },
  ]);

  // A password-protected share link for the unlock rate-limit test.
  const shareToken = 'ratelimit-test-token';
  await ReportShareLink.collection.insertOne({
    token: shareToken,
    organizationId: org._id,
    campaignId: A._id,
    passwordHash: await bcrypt.hash('the-real-password', 10),
    isActive: true,
  });

  // One activity per campaign, for the /admin/activities/:id (ping detail) scoping test.
  // Same raw-insert idiom as the households above — the handler authorizes on campaignId.
  const actA = new mongoose.Types.ObjectId();
  const actB = new mongoose.Types.ObjectId();
  await CanvassActivity.collection.insertMany([
    { _id: actA, organizationId: org._id, campaignId: A._id, householdId: hhA, userId: admin._id, actionType: 'not_home', timestamp: new Date() },
    { _id: actB, organizationId: org._id, campaignId: B._id, householdId: hhB, userId: admin._id, actionType: 'not_home', timestamp: new Date() },
  ]);

  Object.assign(ctx, {
    org, A, B, hhA, hhB, actA, actB, shareToken, admin, lead,
    survOverrideA, survDefaultB, survLeadDraft,
    voterA, voterB, voterA2,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
    canvTok: signUserToken(canv),
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

test('lead can run a granted campaign (A) — 200 on its field routes', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  // Slugs with a bare GET / handler (campaignHouseholds only exposes PATCH, so it's
  // excluded here — its guard swap is covered by the B-403 case + Phase 2).
  for (const slug of ['passes', 'assignments', 'efforts', 'walklists', 'voted', 'setup-status', 'turfs', 'crew']) {
    const { status } = await call('GET', `/api/admin/campaigns/${A._id}/${slug}`, opt);
    assert.ok(status < 400, `GET A/${slug} expected <400, got ${status}`);
  }
});

test('lead is 403 on a campaign they do NOT manage (B)', { skip }, async () => {
  const { leadTok, org, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  for (const slug of ['passes', 'assignments', 'efforts', 'walklists', 'setup-status', 'turfs', 'crew']) {
    const { status } = await call('GET', `/api/admin/campaigns/${B._id}/${slug}`, opt);
    assert.strictEqual(status, 403, `GET B/${slug} expected 403, got ${status}`);
  }
});

test('GET /admin/campaigns is scoped: lead sees only A, admin sees A + B', { skip }, async () => {
  const { leadTok, adminTok, org, A } = ctx;
  const lead = await call('GET', '/api/admin/campaigns', { token: leadTok, orgId: org._id });
  assert.strictEqual(lead.status, 200);
  assert.strictEqual(lead.json.campaigns.length, 1);
  assert.strictEqual(String(lead.json.campaigns[0]._id), String(A._id));

  const admin = await call('GET', '/api/admin/campaigns', { token: adminTok, orgId: org._id });
  assert.strictEqual(admin.status, 200);
  assert.strictEqual(admin.json.campaigns.length, 2);
});

test('campaign create / archive / delete are admin-only (lead 403)', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const create = await call('POST', '/api/admin/campaigns', { ...opt, body: { name: 'New', type: 'survey', state: 'KY' } });
  assert.strictEqual(create.status, 403, 'lead create');
  const archive = await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { isActive: false } });
  assert.strictEqual(archive.status, 403, 'lead archive');
  const del = await call('DELETE', `/api/admin/campaigns/${A._id}`, opt);
  assert.strictEqual(del.status, 403, 'lead delete');
});

test('lead can PATCH editable config on a managed campaign, not on B', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const ok = await call('PATCH', `/api/admin/campaigns/${A._id}`, { token: leadTok, orgId: org._id, body: { surveyTemplateId: null } });
  assert.strictEqual(ok.status, 200, 'lead PATCH A survey');
  const no = await call('PATCH', `/api/admin/campaigns/${B._id}`, { token: leadTok, orgId: org._id, body: { name: 'x' } });
  assert.strictEqual(no.status, 403, 'lead PATCH B');
});

test('imports + reports scope to managed campaigns', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/imports?campaignId=${A._id}`, opt)).status, 200, 'imports A');
  assert.strictEqual((await call('GET', `/api/admin/imports?campaignId=${B._id}`, opt)).status, 403, 'imports B');
  assert.strictEqual((await call('GET', `/api/admin/reports/overview?campaignId=${A._id}`, opt)).status, 200, 'reports A');
  assert.strictEqual((await call('GET', `/api/admin/reports/overview?campaignId=${B._id}`, opt)).status, 403, 'reports B');
  assert.strictEqual((await call('GET', '/api/admin/reports/overview', opt)).status, 403, 'reports org-wide');
  assert.strictEqual((await call('GET', '/api/admin/reports/campaign-rollup', opt)).status, 200, 'rollup self-scopes');
  // The notes-hub feed rides the same router gate: managed campaign or nothing.
  assert.strictEqual((await call('GET', `/api/admin/reports/notes?campaignId=${A._id}`, opt)).status, 200, 'notes A');
  assert.strictEqual((await call('GET', `/api/admin/reports/notes?campaignId=${B._id}`, opt)).status, 403, 'notes B');
  assert.strictEqual((await call('GET', '/api/admin/reports/notes', opt)).status, 403, 'notes org-wide');
});

test('the activity ping detail is scoped to a managed campaign', { skip }, async () => {
  const { leadTok, org, actA, actB } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/activities/${actA}`, opt)).status, 200, 'ping detail A');
  // NB: this 403 is the handler's inline canManageCampaign check (activities.js), not the
  // middleware — it carries no FORBIDDEN_ROLE code, so only the status is pinned here.
  assert.strictEqual((await call('GET', `/api/admin/activities/${actB}`, opt)).status, 403, 'ping detail B');
});

test('libraries: lead reads surveys/tags but cannot mutate them, and cannot reach org Users/voters', { skip }, async () => {
  const { leadTok, adminTok, org, survOverrideA, survDefaultB, survLeadDraft } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  // The lead's survey LIST is scoped: authored (Lead Draft) or attached to a managed
  // campaign (Override A, via WL-A's override) — never Default B, which belongs to the
  // unmanaged campaign. The stringify sweep is the belt-and-braces leak check: no
  // usedBy map, walk-list label, or response bucket may name Campaign B either.
  const leadList = await call('GET', '/api/admin/surveys', opt);
  assert.strictEqual(leadList.status, 200, 'GET surveys');
  const leadIds = leadList.json.surveys.map((s) => String(s._id));
  assert.ok(leadIds.includes(String(survOverrideA._id)), 'managed-attached survey listed');
  assert.ok(leadIds.includes(String(survLeadDraft._id)), 'authored survey listed');
  assert.ok(!leadIds.includes(String(survDefaultB._id)), 'unmanaged-attached survey EXCLUDED');
  assert.ok(!JSON.stringify(leadList.json).includes('Campaign B'), 'no leak of the unmanaged campaign anywhere in the payload');
  const adminList = await call('GET', '/api/admin/surveys', { token: adminTok, orgId: org._id });
  for (const s of [survOverrideA, survDefaultB, survLeadDraft]) {
    assert.ok(adminList.json.surveys.some((x) => String(x._id) === String(s._id)), 'admin list is unscoped');
  }
  assert.strictEqual((await call('GET', '/api/admin/tags', opt)).status, 200, 'GET tags');
  // Leads CAN author survey templates now (from their campaign) — createdBy is stamped
  // as the lead, and attaching is separately campaign-scoped.
  assert.strictEqual((await call('POST', '/api/admin/surveys', { ...opt, body: { name: 'X' } })).status, 201, 'POST surveys (lead can author)');
  assert.strictEqual((await call('POST', '/api/admin/tags', { ...opt, body: { name: 'x' } })).status, 403, 'POST tags');
  // Survey lifecycle mutations (archive / unarchive / delete) stay admin-only; the guard
  // fires before any lookup, so a random id suffices.
  const sid = new mongoose.Types.ObjectId();
  assert.strictEqual((await call('POST', `/api/admin/surveys/${sid}/archive`, opt)).status, 403, 'archive survey');
  assert.strictEqual((await call('POST', `/api/admin/surveys/${sid}/unarchive`, opt)).status, 403, 'unarchive survey');
  assert.strictEqual((await call('DELETE', `/api/admin/surveys/${sid}`, opt)).status, 403, 'delete survey');
  // Users is lead-VISIBLE since 2026-07-23 — scoped server-side to their campaigns'
  // rosters. The full boundary matrix (list scoping, canvasser-only writes, ADMIN_ONLY
  // routes) lives in leadUserManagement.int.test.js; here we just pin reachability.
  assert.strictEqual((await call('GET', '/api/admin/memberships', opt)).status, 200, 'org Users (lead-scoped)');
  assert.strictEqual((await call('GET', '/api/admin/voters', opt)).status, 403, 'org voters');
  // The whole /admin/voters router is admin-only, including the nested survey-response delete —
  // pinned since 2026-08 because the mobile Duplicate surveys screen puts a lead one render
  // condition away from it. The report itself IS lead-readable, so hiding the button is a UI
  // courtesy; this is the actual gate. (Random ids: the router guard fires before any lookup.)
  // The campaign-scoped READ a lead does get — a campaign's Voters tab and its profile — lives on
  // its own router, /admin/campaigns/:campaignId/voters (routes/admin/campaignVoters.js), pinned
  // in the campaign Voters tab test below; this org router gained no per-route carve-out for it.
  const vid = new mongoose.Types.ObjectId();
  const rid = new mongoose.Types.ObjectId();
  assert.strictEqual(
    (await call('DELETE', `/api/admin/voters/${vid}/surveys/${rid}`, opt)).status,
    403,
    'delete a survey response'
  );
  assert.strictEqual((await call('GET', `/api/admin/voters/${vid}`, opt)).status, 403, 'voter profile');
});

test('a role 403 carries code FORBIDDEN_ROLE', { skip }, async () => {
  const { leadTok, org, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  // Machine-readable so a client can tell "your role is too low here" apart from "that's not
  // your org" (ORG_CONTEXT). Mobile uses it to notice a mid-session demotion; without it the
  // body is a bare {error:'Forbidden'} and no client can act on it. Covers both role gates:
  // requireOrgRole (org-level) and requireCampaignManager (campaign-level).
  // (/admin/voters, not /admin/memberships — memberships is lead-visible since 2026-07-23.)
  const orgLevel = await call('GET', '/api/admin/voters', opt);
  assert.strictEqual(orgLevel.status, 403);
  assert.strictEqual(orgLevel.json.code, 'FORBIDDEN_ROLE');

  const campaignLevel = await call('GET', `/api/admin/campaigns/${B._id}/turfs`, opt);
  assert.strictEqual(campaignLevel.status, 403);
  assert.strictEqual(campaignLevel.json.code, 'FORBIDDEN_ROLE');
});

test('the campaign Voters tab: a lead reads a managed campaign\'s directory and profiles, read-only — never B\'s, never through the org router', { skip }, async () => {
  const { leadTok, adminTok, canvTok, org, A, B, admin, lead, voterA, voterB, voterA2 } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const adminOpt = { token: adminTok, orgId: org._id };
  const canvOpt = { token: canvTok, orgId: org._id };
  const tab = (campaign, rest = '') => `/api/admin/campaigns/${campaign._id}/voters${rest}`;

  // The directory (routes/admin/campaignVoters.js — the URL is the scope): this campaign's rows,
  // counted exactly, in name order, with no `campaigns` chips — inside one campaign rows and
  // people are the same thing.
  const list = await call('GET', tab(A), opt);
  assert.strictEqual(list.status, 200, 'lead lists A');
  assert.strictEqual(list.json.total, 2, 'the shared person\'s A row and the A-only row');
  assert.deepStrictEqual(list.json.voters.map((v) => v.id), [String(voterA._id), String(voterA2._id)], 'A\'s rows, Alpha before Beta');
  assert.ok(list.json.voters.every((v) => !('campaigns' in v)), 'no campaign chips on a campaign-scoped row');
  assert.strictEqual(list.json.voters[0].dnc, true, 'the do-not-contact flag shows on the row');
  // An ungranted campaign is the ROLE refusal (requireCampaignManager); a canvasser likewise
  // (the campaigns router's own gate, before this router is even reached).
  const onB = await call('GET', tab(B), opt);
  assert.strictEqual(onB.status, 403, 'lead on B');
  assert.strictEqual(onB.json.code, 'FORBIDDEN_ROLE');
  const asCanv = await call('GET', tab(A), canvOpt);
  assert.strictEqual(asCanv.status, 403, 'canvasser on A');
  assert.strictEqual(asCanv.json.code, 'FORBIDDEN_ROLE');
  assert.strictEqual((await call('GET', tab(A, `/${voterA._id}`), canvOpt)).json.code, 'FORBIDDEN_ROLE', 'canvasser on a profile');

  // The profile, as a lead: THIS row only. The same person has a B row with its own survey and
  // note; a lead is told about neither (otherCampaigns empty, A's survey and note only) — while
  // the do-not-contact reason, who flagged and when, and the email ARE shown (owner rulings 1
  // and 2, 2026-09-30: the flag is org-wide by design, and a lead may be the paying client).
  const profile = await call('GET', tab(A, `/${voterA._id}`), opt);
  assert.strictEqual(profile.status, 200, 'lead opens an A profile');
  assert.strictEqual(profile.json.voter.id, String(voterA._id));
  assert.deepStrictEqual(profile.json.otherCampaigns, [], 'no sibling campaigns for a lead');
  assert.strictEqual(profile.json.surveys.length, 1, 'only the A survey');
  assert.ok(profile.json.surveys.every((s) => s.campaignId === String(A._id)), 'every survey is A\'s');
  assert.deepStrictEqual(profile.json.notes.admin.map((n) => n.body), ['Note on the A row'], 'only the A note');
  assert.strictEqual(profile.json.voter.email, 'ann@example.com', 'email is shown to a lead');
  assert.strictEqual(profile.json.voter.doNotContact.flagged, true);
  assert.strictEqual(profile.json.voter.doNotContact.reason, 'Asked us to stop calling', 'the reason is shown to a lead');
  assert.strictEqual(profile.json.voter.doNotContact.by?.id, String(admin._id), 'and who flagged');
  assert.ok(profile.json.voter.doNotContact.at, 'and when');

  // A voter outside this campaign is a DOMAIN refusal: 404 VOTER_NOT_IN_CAMPAIGN for EVERY role
  // (admins included) — never FORBIDDEN_ROLE, which means only "your role is too low", and a 404
  // like an unknown id, so a client-lead cannot probe which ids exist in campaigns they do not
  // manage.
  const leadCross = await call('GET', tab(A, `/${voterB._id}`), opt);
  assert.strictEqual(leadCross.status, 404, 'lead: B\'s row through A');
  assert.strictEqual(leadCross.json.code, 'VOTER_NOT_IN_CAMPAIGN');
  assert.notStrictEqual(leadCross.json.code, 'FORBIDDEN_ROLE');
  const adminCross = await call('GET', tab(A, `/${voterB._id}`), adminOpt);
  assert.strictEqual(adminCross.status, 404, 'admin: B\'s row through A');
  assert.strictEqual(adminCross.json.code, 'VOTER_NOT_IN_CAMPAIGN');
  const unknown = await call('GET', tab(A, `/${new mongoose.Types.ObjectId()}`), opt);
  assert.strictEqual(unknown.status, 404, 'an unknown id');
  assert.strictEqual(unknown.json.error, 'Voter not found');

  // The same profile as an ADMIN keeps the org-wide union (ruling 5): the B sibling is linked,
  // its survey and its note are in.
  const asAdmin = await call('GET', tab(A, `/${voterA._id}`), adminOpt);
  assert.strictEqual(asAdmin.status, 200, 'admin opens the same profile through the campaign tab');
  assert.deepStrictEqual(
    asAdmin.json.otherCampaigns.map((c) => [c.campaignId, c.voterId]),
    [[String(B._id), String(voterB._id)]],
    'admin: the B row is linked'
  );
  assert.strictEqual(asAdmin.json.surveys.length, 2, 'admin: both surveys');
  assert.deepStrictEqual(asAdmin.json.notes.admin.map((n) => n.body).sort(), ['Note on the A row', 'Note on the B row'], 'admin: both notes');

  // The one write a lead has here: a note on a voter of this campaign — and only of this one.
  const noted = await call('POST', tab(A, `/${voterA._id}/notes`), { ...opt, body: { body: 'Lead left a note' } });
  assert.strictEqual(noted.status, 201, 'lead adds a note');
  const stored = await VoterNote.findById(noted.json.id).lean();
  assert.ok(stored, 'the note exists');
  assert.strictEqual(String(stored.voterId), String(voterA._id), 'on the A row');
  assert.strictEqual(String(stored.authorId), String(lead._id), 'by the lead');
  assert.strictEqual(String(stored.organizationId), String(org._id), 'in the org');
  const blank = await call('POST', tab(A, `/${voterA._id}/notes`), { ...opt, body: { body: '   ' } });
  assert.strictEqual(blank.status, 400, 'a blank note is refused');
  assert.strictEqual(blank.json.error, 'Note body required');
  const crossNote = await call('POST', tab(A, `/${voterB._id}/notes`), { ...opt, body: { body: 'nope' } });
  assert.strictEqual(crossNote.status, 404, 'a note on B\'s row through A');
  assert.strictEqual(crossNote.json.code, 'VOTER_NOT_IN_CAMPAIGN');
  assert.strictEqual(await VoterNote.countDocuments({ voterId: voterB._id }), 1, 'and nothing was written to the B row');
  // Removing it goes through the org router, which did not move: admin-only, every write.
  const del = await call('DELETE', `/api/admin/voters/${voterA._id}/notes/${noted.json.id}`, opt);
  assert.strictEqual(del.status, 403, 'note delete stays on the admin-only org router');
  assert.strictEqual(del.json.code, 'FORBIDDEN_ROLE');

  // PARITY: one resolver behind both lists (services/voters/voterDirectory.js) — the org
  // directory narrowed to A answers exactly what A's tab answers, rows and total; and the tab
  // ignores a stray ?campaignId (the URL is the scope).
  const viaOrg = await call('GET', `/api/admin/voters?campaignId=${A._id}`, adminOpt);
  const viaTab = await call('GET', tab(A), adminOpt);
  assert.strictEqual(viaOrg.status, 200);
  assert.strictEqual(viaTab.status, 200);
  assert.deepStrictEqual(viaTab.json.voters, viaOrg.json.voters, 'same rows');
  assert.strictEqual(viaTab.json.total, viaOrg.json.total, 'same total');
  const stray = await call('GET', tab(A, `?campaignId=${B._id}`), adminOpt);
  assert.deepStrictEqual(stray.json.voters, viaTab.json.voters, 'A\'s tab with ?campaignId=B is still A');
});

test('lead survey edit/duplicate is scoped: own or managed-attached yes, unmanaged no', { skip }, async () => {
  const { leadTok, org, survOverrideA, survDefaultB, survLeadDraft } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  // Attached to a MANAGED campaign (via a walk-list override) → 200.
  assert.strictEqual(
    (await call('PATCH', `/api/admin/surveys/${survOverrideA._id}`, { ...opt, body: { name: 'Override A v2' } })).status,
    200, 'PATCH managed-attached'
  );
  // Authored by the lead, unattached → 200 (createdBy branch).
  assert.strictEqual(
    (await call('PATCH', `/api/admin/surveys/${survLeadDraft._id}`, { ...opt, body: { name: 'Draft v2' } })).status,
    200, 'PATCH own unattached'
  );
  // Attached only to an UNMANAGED campaign → 403.
  assert.strictEqual(
    (await call('PATCH', `/api/admin/surveys/${survDefaultB._id}`, { ...opt, body: { name: 'nope' } })).status,
    403, 'PATCH unmanaged-attached'
  );
  // Duplicate follows the same scope.
  assert.strictEqual((await call('POST', `/api/admin/surveys/${survOverrideA._id}/duplicate`, opt)).status, 201, 'duplicate managed');
  assert.strictEqual((await call('POST', `/api/admin/surveys/${survDefaultB._id}/duplicate`, opt)).status, 403, 'duplicate unmanaged');
});

test('lead ATTACH is scoped like edit: campaign default and walk-list override', { skip }, async () => {
  const { leadTok, adminTok, org, A, survOverrideA, survDefaultB, survLeadDraft } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const adminOpt = { token: adminTok, orgId: org._id };

  // Campaign default: the list is scoped, so this guard only fires on a hand-crafted id.
  const foreign = await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { surveyTemplateId: String(survDefaultB._id) } });
  assert.strictEqual(foreign.status, 403, 'attach unmanaged-attached template');
  assert.strictEqual(foreign.json.code, 'survey-out-of-scope');
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { surveyTemplateId: String(survLeadDraft._id) } })).status,
    200, 'attach authored template'
  );
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { surveyTemplateId: String(survOverrideA._id) } })).status,
    200, 'attach managed-attached template'
  );

  // Walk-list override: same guard on the efforts router. Ordering is deliberate —
  // Override A is A's default RIGHT NOW, so it stays in the lead's scope while WL-A's
  // override is swapped away and back (otherwise the swap itself would strand it:
  // the detach cliff). It is RESTORED before A's default is cleared below.
  const efforts = await call('GET', `/api/admin/campaigns/${A._id}/efforts`, opt);
  const wlA = efforts.json.efforts.find((e) => e.name === 'WL-A');
  assert.ok(wlA, 'fixture walk list present');
  const overrideForeign = await call('PATCH', `/api/admin/campaigns/${A._id}/efforts/${wlA._id}`, { ...opt, body: { surveyTemplateId: String(survDefaultB._id) } });
  assert.strictEqual(overrideForeign.status, 403, 'override with unmanaged template');
  assert.strictEqual(overrideForeign.json.code, 'survey-out-of-scope');
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}/efforts/${wlA._id}`, { ...opt, body: { surveyTemplateId: String(survLeadDraft._id) } })).status,
    200, 'override with authored template'
  );
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}/efforts/${wlA._id}`, { ...opt, body: { surveyTemplateId: String(survOverrideA._id) } })).status,
    200, 'override restored to the fixture template'
  );
  const createForeign = await call('POST', `/api/admin/campaigns/${A._id}/efforts`, { ...opt, body: { name: 'WL-X', surveyTemplateId: String(survDefaultB._id) } });
  assert.strictEqual(createForeign.status, 403, 'create effort with unmanaged override');
  assert.strictEqual(createForeign.json.code, 'survey-out-of-scope');

  // Back to the campaign default: detach is free (Override A stays scoped via WL-A).
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { surveyTemplateId: null } })).status,
    200, 'detach stays free'
  );
  // Admins are unchanged — attach anything, then restore A to its seeded no-default state.
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...adminOpt, body: { surveyTemplateId: String(survDefaultB._id) } })).status,
    200, 'admin attaches unscoped'
  );
  assert.strictEqual(
    (await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...adminOpt, body: { surveyTemplateId: null } })).status,
    200, 'admin restore'
  );
});

test('a lead\'s survey list says whether a survey on their campaigns has answers anywhere in the org — never whose or how many', { skip }, async () => {
  const { leadTok, adminTok, org, A, B, admin, lead } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const questions = [
    { key: 'support', label: 'Can we count on your support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
    { key: 'why_not', label: 'Why not?', type: 'text', options: [] },
    { key: 'anything_else', label: 'Anything else?', type: 'text', options: [] },
  ];
  // The builder's own first "then go to" on a Show-only-if survey (accepted on one with no answers).
  const firstRoute = {
    flow: 'script',
    questions: [{ ...questions[0], options: [{ id: 'yes', text: 'Yes', goTo: 'anything_else' }, { id: 'no', text: 'No' }] }, questions[1], questions[2]],
  };
  const mk = (name, createdBy) => SurveyTemplate.create({ organizationId: org._id, name, createdBy, version: 1, flow: 'list', questions });
  const [elsewhere, legacy, mixed, none, authored, main] = await Promise.all([
    mk('Gap elsewhere', admin._id), mk('Gap legacy', admin._id), mk('Gap mixed', admin._id), mk('Gap none', admin._id),
    mk('Gap authored', lead._id), // in the lead's library only because they wrote it: on none of their campaigns
    mk('Gap main', admin._id), // A's main survey for the length of this test (set inside the try)
  ]);
  const ids = [elsewhere, legacy, mixed, none, authored, main].map((s) => s._id);
  // Four on A as walk-list overrides; `main` is A's own survey, the arm a lead's builder opens.
  const efforts = await Effort.create([elsewhere, legacy, mixed, none].map((s) => ({
    organizationId: org._id, campaignId: A._id, name: `WL ${s.name}`, surveyTemplateId: s._id,
  })));
  // Raw rows with REAL ObjectIds everywhere: the list keys its counts by String(), so a string id would
  // still count there while the PATCH's ObjectId-cast exists missed it — a fake disagreement. A fresh
  // voterId and passId per row keep the {voterId, passId} unique index quiet. campaignId null is a
  // legacy row, which the schema now refuses (SurveyResponse.js :43-48) — hence the raw insert.
  const row = (s, campaignId) => ({
    organizationId: org._id, campaignId, surveyTemplateId: s._id,
    voterId: new mongoose.Types.ObjectId(), passId: new mongoose.Types.ObjectId(), submittedAt: new Date(),
  });
  await SurveyResponse.collection.insertMany([
    row(elsewhere, B._id), row(elsewhere, B._id),
    row(legacy, null),
    row(mixed, A._id), row(mixed, B._id), row(mixed, B._id),
    row(authored, B._id),
    row(main, B._id),
  ]);
  try {
    // The attach test above left A with no main survey; `finally` puts that back.
    await Campaign.updateOne({ _id: A._id }, { $set: { surveyTemplateId: main._id } });
    const leadList = await call('GET', '/api/admin/surveys', opt);
    assert.strictEqual(leadList.status, 200);
    const mine = new Map(leadList.json.surveys.map((s) => [String(s._id), s]));
    const of = (s) => mine.get(String(s._id));
    for (const s of [elsewhere, legacy, mixed, main]) assert.strictEqual(of(s).hasResponses, true, `${s.name}: answers somewhere in the org lock it`);
    assert.strictEqual(of(none).hasResponses, false, 'no answers anywhere: never locked');
    assert.strictEqual(of(authored).hasResponses, false, 'only authored, on none of their campaigns: narrowed (owner ruling 2026-10-03)');
    for (const s of [elsewhere, legacy, authored, main]) {
      assert.strictEqual(of(s).responseCount, 0, `${s.name}: counts stay theirs`);
      assert.deepStrictEqual(of(s).responseCountByCampaign, []);
    }
    assert.strictEqual(of(mixed).responseCount, 1);
    assert.deepStrictEqual(of(mixed).responseCountByCampaign.map((b) => [b.campaignName, b.count]), [['Campaign A', 1]]);
    const text = JSON.stringify(leadList.json);
    assert.ok(!text.includes('Campaign B'), 'no other campaign anywhere in the payload');
    assert.ok(!text.includes('No campaign'), 'no legacy bucket either');
    // Exactly the two bare booleans and the narrowed annotations — a future org-wide number would fail here.
    const stored = await SurveyTemplate.findById(mixed._id).lean();
    assert.deepStrictEqual(
      Object.keys(of(mixed)).filter((k) => !(k in stored)).sort(),
      ['hasResponses', 'responseCount', 'responseCountByCampaign', 'usedByCampaigns', 'usedByWalkLists', 'usedElsewhere']
    );

    // The list and the save agree on every survey on the lead's campaigns…
    for (const s of [elsewhere, legacy, mixed, main]) {
      const res = await call('PATCH', `/api/admin/surveys/${s._id}`, { ...opt, body: firstRoute });
      assert.strictEqual(res.status, 409, `${s.name}: ${JSON.stringify(res.json)}`);
      assert.strictEqual(res.json.code, 'survey-has-responses');
    }
    const free = await call('PATCH', `/api/admin/surveys/${none._id}`, { ...opt, body: firstRoute });
    assert.strictEqual(free.status, 200, JSON.stringify(free.json));
    // …and the save still guards the one the ruling leaves narrowed (no lead builder opens it).
    const guarded = await call('PATCH', `/api/admin/surveys/${authored._id}`, { ...opt, body: firstRoute });
    assert.strictEqual(guarded.status, 409);

    // The admin branch is unchanged: org-wide counts (never assert bucket order — it is unsorted).
    const adminList = await call('GET', '/api/admin/surveys', { token: adminTok, orgId: org._id });
    const all = new Map(adminList.json.surveys.map((s) => [String(s._id), s]));
    assert.deepStrictEqual([elsewhere, legacy, mixed, none, main].map((s) => all.get(String(s._id)).responseCount), [2, 1, 3, 0, 1]);
    assert.strictEqual(all.get(String(none._id)).hasResponses, false);
    assert.ok(!('usedElsewhere' in all.get(String(mixed._id))), 'admin rows carry no usedElsewhere');
  } finally {
    await Campaign.updateOne({ _id: A._id }, { $set: { surveyTemplateId: null } });
    await SurveyResponse.deleteMany({ surveyTemplateId: { $in: ids } });
    await Effort.deleteMany({ _id: { $in: efforts.map((e) => e._id) } });
    await SurveyTemplate.deleteMany({ _id: { $in: ids } });
  }
});

test('lead can create a canvasser onto a managed campaign via /crew, not onto B', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const ok = await call('POST', `/api/admin/campaigns/${A._id}/crew`, {
    ...opt,
    body: { firstName: 'Cy', lastName: 'Canvasser', email: 'cy@t.co', password: 'password123' },
  });
  assert.strictEqual(ok.status, 201, 'crew create on A');
  const no = await call('POST', `/api/admin/campaigns/${B._id}/crew`, {
    ...opt,
    body: { firstName: 'No', lastName: 'Pe', email: 'nope@t.co', password: 'password123' },
  });
  assert.strictEqual(no.status, 403, 'crew create on B');
});

test('crew create issues a temp password + forced change; an address that already has an account attaches the real person', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };

  // 1) A brand-new canvasser created via /crew is forced to change on first login (with the
  //    72h temp-password clock started). A simple temp like "victory26" is accepted.
  const created = await call('POST', `/api/admin/campaigns/${A._id}/crew`, {
    ...opt,
    body: { firstName: 'Temp', lastName: 'Hire', email: 'temp.hire@t.co', password: 'victory26' },
  });
  assert.strictEqual(created.status, 201, 'crew create new');
  const newUser = await User.findOne({ email: 'temp.hire@t.co' });
  assert.strictEqual(newUser.mustChangePassword, true, 'new hire must change password');
  assert.ok(newUser.tempPasswordSetAt, 'new hire has tempPasswordSetAt (72h clock)');

  // 2) An EXISTING global account (as if from another org), created out-of-band.
  const existing = await User.create({
    firstName: 'Rey', lastName: 'Returner', email: 'returner@t.co',
    passwordHash: 'existing-hash', isActive: true,
  });

  // 3) THE BLIND ATTACH. The lead types that address believing it is a new hire, and gives a name
  //    and a password. The server resolves the address FIRST, finds a real account, and attaches
  //    the real person instead of minting a second one — no 409, no checkbox, no second round trip
  //    (EMAIL_EXISTS_USE_LINK is what this replaces). What was typed is discarded: overwriting a
  //    stranger's name would be a lie and setting their password would be a takeover, since a
  //    password is per-USER and reaches every org they belong to.
  const attached = await call('POST', `/api/admin/campaigns/${A._id}/crew`, {
    ...opt,
    body: { firstName: 'Wrong', lastName: 'Guess', email: 'returner@t.co', password: 'password123' },
  });
  assert.strictEqual(attached.status, 201, 'existing address attaches rather than 409ing');
  assert.strictEqual(attached.json.attached, true, 'response says it attached, not created');
  assert.strictEqual(attached.json.outcome, 'attached', 'outcome names the branch');
  // The operator learns WHO only here, in the success body — never from a probe beforehand.
  assert.strictEqual(attached.json.user.firstName, 'Rey', 'the real person landed, not the typed name');
  const afterLink = await User.findById(existing._id);
  assert.strictEqual(afterLink.firstName, 'Rey', 'typed name did NOT overwrite the account');
  assert.strictEqual(afterLink.passwordHash, 'existing-hash', 'attached account keeps its password');
  assert.ok(!afterLink.mustChangePassword, 'attached account is NOT forced to change');
  assert.ok(
    await CampaignAssignment.exists({ campaignId: A._id, userId: existing._id }),
    'and they are on the campaign roster'
  );
});

test('the crew list is THIS CAMPAIGN\'s people — never the organization directory', { skip }, async () => {
  const { leadTok, adminTok, org, A, B, admin } = ctx;
  const opt = { token: leadTok, orgId: org._id };

  // Someone who works for this org on a campaign the lead does NOT manage. Before the campaign
  // Team page was scoped, this person (name AND email) was handed to every lead in the org.
  const stranger = await User.create({
    firstName: 'Otto', lastName: 'Otherclient', email: 'otto@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: stranger._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await CampaignAssignment.create({ campaignId: B._id, userId: stranger._id, organizationId: org._id });

  const list = await call('GET', `/api/admin/campaigns/${A._id}/crew`, opt);
  assert.strictEqual(list.status, 200, 'lead reads their campaign crew');
  const emails = (list.json.members || []).map((m) => m.user.email);
  assert.ok(!emails.includes('otto@t.co'), 'a member of an unmanaged campaign is NOT listed');
  // The org admin is an active member of the org but is on no campaign — the old query returned
  // them too. Belt and braces over the whole body, which also catches a leak through any field
  // added later.
  assert.ok(!JSON.stringify(list.json).includes('otto@t.co'), 'no trace of them anywhere in the body');
  assert.ok(emails.includes('cy@t.co'), "but the campaign's own crew is still listed");

  // Coordinators are a separate, deliberately org-level list: resolveCoordinatorId accepts any
  // active admin/lead, and managing a campaign does not put you on its roster — so scoping this to
  // the roster would empty the crew picker. Names and roles only, no emails.
  const coordIds = (list.json.coordinators || []).map((c) => c.id);
  assert.ok(coordIds.includes(String(admin._id)), 'an org admin can still be picked as coordinator');
  assert.ok(!JSON.stringify(list.json.coordinators).includes('@'), 'coordinator rows carry no email');

  // Admins read the same campaign-scoped list — the endpoint no longer forks by role.
  const asAdmin = await call('GET', `/api/admin/campaigns/${A._id}/crew`, { token: adminTok, orgId: org._id });
  assert.strictEqual(asAdmin.status, 200, 'admin reads it too');
  assert.ok(
    !(asAdmin.json.members || []).map((m) => m.user.email).includes('otto@t.co'),
    'and it is campaign-scoped for an admin as well'
  );
});

test('resolve answers for colleagues and stays silent about everyone else', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const resolve = (email) => call('POST', `/api/admin/campaigns/${A._id}/crew/resolve`, { ...opt, body: { email } });

  // Already on this campaign — created by an earlier test in this file.
  const onCampaign = await resolve('cy@t.co');
  assert.strictEqual(onCampaign.status, 200);
  assert.strictEqual(onCampaign.json.outcome, 'on-campaign');
  assert.strictEqual(onCampaign.json.person.firstName, 'Cy');

  // In the org, on another campaign — named, because they are already this lead's colleague and
  // the claim confirm has to say who it is about.
  const inOrg = await resolve('otto@t.co');
  assert.strictEqual(inOrg.json.outcome, 'in-org', 'a colleague resolves');
  assert.strictEqual(inOrg.json.person.lastName, 'Otherclient');

  // A switched-off membership is checked BEFORE role, so it can never resolve to a plain claim and
  // leave a roster row for somebody who cannot sign in.
  const off = await User.create({ firstName: 'Dee', lastName: 'Disabled', email: 'dee@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: off._id, organizationId: org._id, role: 'canvasser', isActive: false });
  assert.strictEqual((await resolve('dee@t.co')).json.outcome, 'in-org-inactive');

  // THE BOUNDARY. An account belonging to another customer and an address with no account at all
  // must be indistinguishable — a lead may be the client's own manager, so any difference between
  // these two is a cross-tenant disclosure. Compare the whole body, not just the outcome string.
  const otherOrg = await Organization.create({ name: 'Rival Firm', slug: 'rival-firm-crew', isActive: true });
  const rival = await User.create({ firstName: 'Ria', lastName: 'Rival', email: 'ria@rival.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: rival._id, organizationId: otherOrg._id, role: 'canvasser', isActive: true });
  const foreign = await resolve('ria@rival.co');
  const unknown = await resolve('nobody-at-all@nowhere.co');
  assert.deepStrictEqual(foreign.json, unknown.json, 'a foreign account looks exactly like no account');
  assert.deepStrictEqual(unknown.json, { outcome: 'outside', person: null }, 'and carries nothing else');
});

test('claiming a colleague rosters them without touching their membership; a switched-off one needs an admin', { skip }, async () => {
  const { leadTok, adminTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };

  // CLAIM: already in the org, not on this campaign. One roster row, no membership write — so a
  // lead can never silently promote or demote anyone by adding them.
  const otto = await User.findOne({ email: 'otto@t.co' });
  const before = await Membership.findOne({ userId: otto._id, organizationId: org._id });
  const claimed = await call('POST', `/api/admin/campaigns/${A._id}/crew`, { ...opt, body: { email: 'otto@t.co' } });
  assert.strictEqual(claimed.status, 201, 'colleague claimed onto the campaign');
  assert.strictEqual(claimed.json.outcome, 'in-org', 'reported as a claim');
  assert.strictEqual(claimed.json.attached, false, 'not an attach — they were already ours');
  assert.ok(await CampaignAssignment.exists({ campaignId: A._id, userId: otto._id }), 'roster row created');
  const after = await Membership.findOne({ userId: otto._id, organizationId: org._id });
  assert.strictEqual(String(after._id), String(before._id), 'the same membership row, untouched');
  assert.strictEqual(after.role, before.role, 'role unchanged by the claim');

  // Re-adding is idempotent, not an error.
  const again = await call('POST', `/api/admin/campaigns/${A._id}/crew`, { ...opt, body: { email: 'otto@t.co' } });
  assert.strictEqual(again.status, 201, 're-adding is a no-op, not a 409');
  assert.strictEqual(again.json.outcome, 'on-campaign');

  // A switched-off colleague is a reactivation, which is ORG-wide: the lead is told who and told to
  // ask, the admin may do it inline.
  const asLead = await call('POST', `/api/admin/campaigns/${A._id}/crew`, { ...opt, body: { email: 'dee@t.co' } });
  assert.strictEqual(asLead.status, 409, 'lead cannot reactivate');
  assert.strictEqual(asLead.json.code, 'MEMBER_DEACTIVATED');
  assert.strictEqual(asLead.json.person.firstName, 'Dee', 'but is told who it is, so the message is actionable');
  assert.ok(
    !(await CampaignAssignment.exists({ campaignId: A._id, userId: (await User.findOne({ email: 'dee@t.co' }))._id })),
    'and no ghost roster row was left behind'
  );

  const asAdmin = await call('POST', `/api/admin/campaigns/${A._id}/crew`, {
    token: adminTok, orgId: org._id, body: { email: 'dee@t.co' },
  });
  assert.strictEqual(asAdmin.status, 201, 'admin reactivates and rosters in one step');
  const dee = await Membership.findOne({ userId: (await User.findOne({ email: 'dee@t.co' }))._id, organizationId: org._id });
  assert.strictEqual(dee.isActive, true, 'membership switched back on');
});

test('lead can load the campaign map for A, not B, and never org-wide', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/households/map?campaignId=${A._id}`, opt)).status, 200, 'map A');
  assert.strictEqual((await call('GET', `/api/admin/households/map?campaignId=${B._id}`, opt)).status, 403, 'map B');
  assert.strictEqual((await call('GET', '/api/admin/households/map', opt)).status, 403, 'map org-wide');
});

test('lead household-activity is scoped to a managed campaign', { skip }, async () => {
  const { leadTok, org, hhA, hhB } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/households/${hhA}/activity`, opt)).status, 200, 'activity A');
  assert.strictEqual((await call('GET', `/api/admin/households/${hhB}/activity`, opt)).status, 403, 'activity B');
});

test('share-link unlock is rate-limited after repeated wrong passwords', { skip }, async () => {
  const { shareToken } = ctx;
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const r = await call('POST', `/api/share/${shareToken}/unlock`, { body: { password: 'wrong-guess' } });
    statuses.push(r.status);
  }
  assert.strictEqual(statuses[0], 401, 'first wrong attempt is 401');
  assert.strictEqual(statuses[10], 429, '11th attempt in the window is rate-limited (429)');
});
