import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_CAMPAIGN_FIELDS, campaignPatchFor } from './campaignPatch.js';

// The campaign Edit drawer's Save, by role. A team lead's Save used to send every field, the
// read-only admin ones included, and PATCH /admin/campaigns/:id refuses any of those from a lead
// even sent back unchanged, so the drawer could never save for a lead. The server half — a body shaped
// like the drawer's, refused whole and landing filtered — is in server/test/campaignGoal.int.test.js.

// What the server refuses from a lead, copied from server/src/routes/admin/campaigns.js (the
// admin-only loop in PATCH /:campaignId). A change on either side should show up here.
const LEAD_REFUSED = [
  'isActive',
  'type',
  'state',
  'electionDay',
  'earlyVotingStart',
  'earlyVotingEnd',
  'datesNote',
  'billRestrictedDoors',
  'enabledOutcomes',
];

// A body shaped like the one CampaignFormDrawer.submit builds: every field, a lead's goal changed.
const drawerBody = () => ({
  name: 'Ward 3',
  type: 'survey',
  state: 'FL',
  surveyTemplateId: '6a0000000000000000000001',
  isActive: true,
  timeZone: 'America/New_York',
  electionDay: '2026-11-03',
  earlyVotingStart: '2026-10-24',
  earlyVotingEnd: '2026-11-01',
  datesNote: 'Polls open 7am–7pm',
  doorGoal: 250,
  goalDate: '2026-10-31',
  billRestrictedDoors: null,
});

test('a lead\'s drawer Save keeps exactly the fields a lead owns', () => {
  const body = drawerBody();
  const sent = campaignPatchFor(body, { isOrgAdmin: false });
  assert.deepEqual(Object.keys(sent).sort(), ['doorGoal', 'goalDate', 'name', 'surveyTemplateId', 'timeZone']);
  for (const field of LEAD_REFUSED) {
    assert.ok(!(field in sent), `${field} is admin-only: the server 403s it from a lead`);
  }
  for (const field of LEAD_CAMPAIGN_FIELDS) {
    assert.ok(!LEAD_REFUSED.includes(field), `${field} is on the lead list and the server's refused list`);
    assert.strictEqual(sent[field], body[field], `${field} goes as the drawer built it`);
  }
  assert.deepEqual(body, drawerBody(), 'the drawer\'s own body is never mutated');
});

test('a lead\'s body keeps a field set to null or undefined, and adds none the drawer left out', () => {
  // Clearing the goal sends null for both, and an empty timezone sends undefined (the server
  // defaults it from the state): neither may be dropped or invented.
  const sent = campaignPatchFor(
    { ...drawerBody(), doorGoal: null, goalDate: null, timeZone: undefined, surveyTemplateId: null },
    { isOrgAdmin: false }
  );
  assert.strictEqual(sent.doorGoal, null);
  assert.strictEqual(sent.goalDate, null);
  assert.strictEqual(sent.surveyTemplateId, null);
  assert.ok('timeZone' in sent && sent.timeZone === undefined);
  assert.deepEqual(campaignPatchFor({ name: 'Ward 3', isActive: false }, { isOrgAdmin: false }), { name: 'Ward 3' });
});

test('an org admin\'s drawer Save sends the whole form, as before', () => {
  const body = drawerBody();
  assert.strictEqual(campaignPatchFor(body, { isOrgAdmin: true }), body);
});
