import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_SAVED_EMPTY, NOT_SAVED_TABS, doorLine, emptyLine, notSavedReason, rowState, whatLabel } from './notSaved.js';

// The Audit page's Doors not saved words (lib/notSaved.js; docs/PROPOSAL_OFFLINE_QUEUE.md §E).

test('the tabs and the empty state are §E’s', () => {
  assert.deepEqual(NOT_SAVED_TABS.map((t) => t.label), ['Open', 'Reviewed', 'All']);
  assert.equal(NOT_SAVED_EMPTY, "Nothing has been turned down. Items saved without signal that the server couldn't accept would show here.");
  assert.equal(emptyLine('open', 0), NOT_SAVED_EMPTY);
  assert.equal(emptyLine('all', 0), NOT_SAVED_EMPTY);
  assert.equal(emptyLine('open', 3), 'Nothing open. Everything turned down here has been reviewed or was saved later.');
  assert.equal(emptyLine('reviewed', 3), 'Nothing has been marked reviewed yet.');
});

test('what was recorded', () => {
  assert.equal(whatLabel({ kind: 'result', actionType: 'not_home' }), 'Not home');
  assert.equal(whatLabel({ kind: 'result', actionType: 'lit_dropped' }), 'Lit dropped');
  assert.equal(whatLabel({ kind: 'result', actionType: 'not_target' }), 'Not a target voter');
  assert.equal(whatLabel({ kind: 'result', actionType: 'something_new' }), 'Door result');
  assert.equal(whatLabel({ kind: 'survey' }), 'Survey');
  assert.equal(whatLabel({ kind: 'add_person' }), 'Added a person');
  assert.equal(whatLabel({ kind: 'pin_move' }), 'Moved a pin');
  assert.equal(whatLabel({}), 'Door');
});

test('the door: address · book, or no longer in this campaign', () => {
  assert.equal(doorLine({ address: '1412 Elm St, Austin', book: 'Book 7' }), '1412 Elm St, Austin · Book 7');
  assert.equal(doorLine({ address: '1412 Elm St, Austin', book: null }), '1412 Elm St, Austin');
  assert.equal(doorLine({ address: null, book: 'Book 7' }), 'No longer in this campaign');
  assert.equal(doorLine({}), 'No longer in this campaign');
});

test('why, in the third person, by code', () => {
  const by = (code, extra = {}) => notSavedReason({ code, kind: 'result', status: 403, reason: 'server words', ...extra });
  assert.equal(by('NOT_ASSIGNED'), "Not on this campaign's team");
  assert.equal(by('SUPPORT_ACCESS_REQUIRED'), 'Doorline staff need an access grant for this organization');
  assert.equal(by('SURVEY_TEMPLATE_MISMATCH', { kind: 'survey', status: 400 }), "The walk list's survey changed");
  assert.equal(by('TEMPLATE_NOT_FOUND', { kind: 'survey', status: 404 }), 'The survey was deleted');
  assert.equal(by('DO_NOT_CONTACT', { kind: 'survey' }), 'The voter asked not to be contacted');
  assert.equal(by('HOUSEHOLD_NOT_FOUND', { status: 404 }), 'The house is no longer in the campaign');
  assert.equal(by('HOUSEHOLD_FOR_VOTER_NOT_FOUND', { kind: 'survey', status: 404 }), 'The house is no longer in the campaign');
  assert.equal(by('VOTER_NOT_FOUND', { kind: 'survey', status: 404 }), "The person this survey was for isn't in this campaign");
  // The same 404 hides another organization's house: with the house still in this campaign, that's the cause.
  assert.equal(by('HOUSEHOLD_NOT_FOUND', { status: 404, address: '1412 Elm St' }), 'Uploaded while another organization was selected on the phone');
  assert.equal(by('HOUSEHOLD_FOR_VOTER_NOT_FOUND', { kind: 'survey', status: 404, address: '1412 Elm St' }), 'Uploaded while another organization was selected on the phone');
  assert.equal(by('CAMPAIGN_NOT_FOUND', { status: 404 }), 'The campaign was deleted');
  assert.equal(by('campaign-deleting', { status: 409 }), 'The campaign was deleted');
  assert.equal(by('campaign-archived', { kind: 'add_person', status: 409 }), 'The campaign is archived');
  assert.equal(by('subscription-inactive', { status: 402 }), 'The account was paused');
  assert.equal(by('out_of_bounds', { kind: 'pin_move', status: 400 }), "The new pin was outside the campaign's area");
  assert.equal(by('invalid_coords', { kind: 'pin_move', status: 400 }), "The new pin was outside the campaign's area");
  assert.equal(by('VOTER_ID_CONFLICT', { kind: 'add_person', status: 409 }), "The person couldn't be added — add them again");
});

test('FORBIDDEN_ROLE and ORG_CONTEXT read by kind and message too', () => {
  // requireOrgMember's refusal: they had left the organization — even on a pin move.
  for (const kind of ['result', 'pin_move', 'survey']) {
    assert.equal(notSavedReason({ code: 'FORBIDDEN_ROLE', kind, status: 403, reason: 'No active org membership' }), 'Not in this organization any more');
  }
  const pinRule = 'Only team leads and admins can move a house pin. Ask your lead to fix this one.';
  assert.equal(notSavedReason({ code: 'FORBIDDEN_ROLE', kind: 'pin_move', status: 403, reason: pinRule }), 'Only leads and admins can move a pin');
  assert.equal(notSavedReason({ code: 'FORBIDDEN_ROLE', kind: 'result', status: 403, reason: 'Forbidden' }), 'Forbidden');
  assert.equal(notSavedReason({ code: 'ORG_CONTEXT', kind: 'survey', status: 403, reason: 'Not a member of this organization' }), 'Not in this organization any more');
  assert.equal(notSavedReason({ code: 'ORG_CONTEXT', kind: 'result', status: 400, reason: 'Invalid X-Org-Id' }), 'Invalid X-Org-Id');
});

test('anything else shows the server’s words', () => {
  const outcome = '"Not a target voter" is turned off for this campaign, so this door was not recorded. Pick a different outcome.';
  assert.equal(notSavedReason({ code: 'OUTCOME_DISABLED', kind: 'result', status: 400, reason: outcome }), outcome);
  assert.equal(notSavedReason({ code: 'INVALID_INPUT', kind: 'survey', status: 400, reason: 'Invalid input' }), 'Invalid input');
  assert.equal(notSavedReason({ code: null, kind: 'result', status: 404, reason: 'Not found' }), 'Not found');
  assert.equal(notSavedReason({ code: 'constructor', kind: 'result', status: 400, reason: 'odd' }), 'odd', 'no prototype lookups');
  assert.equal(notSavedReason({ code: null, kind: 'result', status: 418, reason: null }), 'Turned down by the server (418)');
  assert.equal(notSavedReason({}), 'Turned down by the server');
});

test('the row’s state: saved later, reviewed, or open', () => {
  assert.equal(rowState({ savedLaterAt: '2026-10-30T20:00:00Z', reviewedAt: '2026-10-30T21:00:00Z' }), 'saved-later');
  assert.equal(rowState({ savedLaterAt: null, reviewedAt: '2026-10-30T21:00:00Z' }), 'reviewed');
  assert.equal(rowState({ savedLaterAt: null, reviewedAt: null }), 'open');
});
