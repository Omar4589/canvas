import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Which clock each part of a voter's profile reads in (docs/PROPOSAL_CAMPAIGN_CLOCK.md), over the real app:
//   npm --prefix server run test:int -- test/voterProfileZones.int.test.js
//
// The profile names the zone of the voter row's campaign (`timeZone`) and of each other campaign holding
// the person (`otherCampaigns[].timeZone`), and every field note and admin note says which campaign it came
// from (`campaignId`), so the web page shows each time on its own campaign's clock: an Omaha voter's visits
// read in Central, never the organization's default Eastern. A lead's profile is scoped to their campaign,
// so every id in it is that campaign's. A voter whose household is gone still gets its campaign's zone.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-profile-zones';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { VoterNote } = await import('../src/models/VoterNote.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const call = async (path, token) => {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

const AT = new Date('2026-11-02T18:30:00Z'); // 12:30 PM CST in Omaha, 11:30 AM MST in the Panhandle

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignManager, Household, Voter,
    CanvassActivity, SurveyResponse, SurveyTemplate, VoterNote]) {
    await M.deleteMany({});
  }

  // The organization keeps its default Eastern clock: nothing below may come back in it.
  const org = await Organization.create({ name: 'Zones Org', slug: 'zones-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'pz-admin@t.co', passwordHash: 'x', isActive: true,
  });
  const lead = await User.create({
    firstName: 'Lea', lastName: 'Lead', email: 'pz-lead@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support ask',
    version: 1,
    questions: [
      {
        key: 'support',
        label: 'Can we count on your support?',
        type: 'single_choice',
        order: 0,
        options: [{ id: 'opt_yes', text: 'Support', order: 0 }],
      },
    ],
  });
  const omaha = await Campaign.create({
    organizationId: org._id, name: 'Omaha Race', type: 'survey', state: 'NE',
    isActive: true, timeZone: 'America/Chicago', surveyTemplateId: template._id,
  });
  const panhandle = await Campaign.create({
    organizationId: org._id, name: 'Panhandle Race', type: 'survey', state: 'NE',
    isActive: true, timeZone: 'America/Denver', surveyTemplateId: template._id,
  });
  await CampaignManager.create({ campaignId: omaha._id, userId: lead._id, organizationId: org._id });

  const home = (campaign, n) => Household.create({
    organizationId: org._id, campaignId: campaign._id,
    addressLine1: `${n} Zone St`, city: 'Omaha', state: 'NE', zipCode: '68102',
    normalizedAddress: `${n} ZONE ST|OMAHA|NE|68102`,
    location: { type: 'Point', coordinates: [-95.93 + n * 0.001, 41.25] },
  });
  const row = (campaign, h, stateVoterId) => Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: h._id,
    stateVoterId, firstName: 'Pat', lastName: 'Zone', fullName: 'Pat Zone',
  });
  const hOmaha = await home(omaha, 1);
  const hPan = await home(panhandle, 2);
  const vOmaha = await row(omaha, hOmaha, 'NE1');
  const vPan = await row(panhandle, hPan, 'NE1'); // the same person, in the Panhandle race
  // A row whose household was deleted out from under it.
  const hGone = await home(omaha, 3);
  const vGone = await row(omaha, hGone, 'NE2');
  await Household.deleteOne({ _id: hGone._id });

  const knock = (campaign, h, v, note) => CanvassActivity.create({
    organizationId: org._id, campaignId: campaign._id, householdId: h._id, voterId: v._id, userId: admin._id,
    actionType: 'not_home', note, timestamp: AT, location: { lat: 41.25, lng: -95.93 },
  });
  await knock(omaha, hOmaha, vOmaha, 'Dog in the yard');
  await knock(panhandle, hPan, vPan, 'Gate locked');
  await SurveyResponse.create({
    organizationId: org._id, campaignId: panhandle._id, householdId: hPan._id, voterId: vPan._id, userId: admin._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 41.9, lng: -103.6 }, submittedAt: AT, note: 'Wants a yard sign',
    answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Support', optionIds: ['opt_yes'] }],
  });
  await VoterNote.create([
    { organizationId: org._id, voterId: vOmaha._id, authorId: admin._id, body: 'Note on the Omaha row' },
    { organizationId: org._id, voterId: vPan._id, authorId: admin._id, body: 'Note on the Panhandle row' },
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, omaha, panhandle, vOmaha, vPan, vGone,
    adminToken: signUserToken(admin), leadToken: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test("1. an admin's profile names each campaign's zone, and every note says which campaign it came from", { skip }, async () => {
  const { omaha, panhandle, vOmaha, adminToken } = ctx;
  const O = String(omaha._id);
  const P = String(panhandle._id);
  const r = await call(`/admin/voters/${vOmaha._id}`, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.timeZone, 'America/Chicago', "the row's campaign, never the organization's America/New_York");
  assert.deepStrictEqual(r.json.otherCampaigns.map((c) => [c.campaignId, c.timeZone]), [[P, 'America/Denver']]);
  // An admin note follows the person: the one on the Panhandle row names the Panhandle campaign.
  assert.deepStrictEqual(
    Object.fromEntries(r.json.notes.admin.map((n) => [n.body, n.campaignId])),
    { 'Note on the Omaha row': O, 'Note on the Panhandle row': P }
  );
  // Field notes: the visit notes by the campaign they were recorded in, the survey note by its survey's.
  assert.deepStrictEqual(
    Object.fromEntries(r.json.notes.field.map((n) => [n.note, n.campaignId])),
    { 'Dog in the yard': O, 'Gate locked': P, 'Wants a yard sign': P }
  );
  assert.deepStrictEqual(r.json.surveys.map((s) => s.campaignId), [P]);
});

test("2. a lead's campaign profile carries the zone and only its own campaign's ids", { skip }, async () => {
  const { omaha, vOmaha, leadToken } = ctx;
  const O = String(omaha._id);
  const r = await call(`/admin/campaigns/${omaha._id}/voters/${vOmaha._id}`, leadToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.timeZone, 'America/Chicago');
  assert.deepStrictEqual(r.json.otherCampaigns, [], 'the scope still names no other campaign');
  assert.deepStrictEqual(r.json.notes.admin.map((n) => [n.body, n.campaignId]), [['Note on the Omaha row', O]]);
  assert.deepStrictEqual(r.json.notes.field.map((n) => [n.note, n.campaignId]), [['Dog in the yard', O]]);
});

test('3. the phone route returns the same zones (additive: the shipped app ignores them)', { skip }, async () => {
  const { omaha, vOmaha, adminToken } = ctx;
  const r = await call(`/mobile/voters/${vOmaha._id}?campaignId=${omaha._id}`, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.timeZone, 'America/Chicago');
  assert.deepStrictEqual(r.json.otherCampaigns.map((c) => c.timeZone), ['America/Denver']);
});

test("4. a voter whose household is gone still gets its campaign's zone", { skip }, async () => {
  const { vGone, adminToken } = ctx;
  const r = await call(`/admin/voters/${vGone._id}`, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.household, null);
  assert.equal(r.json.timeZone, 'America/Chicago');
});
