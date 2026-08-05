import { test } from 'node:test';
import assert from 'node:assert';
import {
  archiveStateOf,
  campaignShape,
  isArchivedCampaign,
  resolveChipSelection,
} from './campaignSelection.js';

// campaignSelection.js is the ONE place the admin campaign chip's selection is decided, so this
// is where the rules get locked down. The bug under test: the chip validated the persisted pick
// against the ACTIVE-only list, so an archived campaign could never stay selected — an org whose
// campaigns had all finished offered nothing to pick, and a super admin who drilled into it hit
// "Pick a campaign to see its notes" with an empty menu. These pin the two halves that have to
// stay apart: an archived campaign is SELECTABLE, and the auto-default is still ACTIVE-ONLY.

// Run from the REPO ROOT: `npm run test:mobile`. The script deliberately lives in the root
// package.json, NOT mobile/package.json — Expo's OTA fingerprint hashes mobile/package.json
// (scripts included), so adding even a test script there re-stamps the runtime fingerprint and
// strands OTA updates (ota-check blocks the publish).

const c = (id, name, isActive) => ({ _id: id, name, type: 'lit_drop', state: 'FL', timeZone: 'America/New_York', isActive });
const ACTIVE = c('a1', 'Running', true);
const ACTIVE_2 = c('a2', 'Also running', true);
const ARCHIVED = c('z9', 'Finished', false);

test('a valid ACTIVE selection is kept', () => {
  assert.equal(resolveChipSelection({ value: { id: 'a1' }, campaigns: [ACTIVE, ARCHIVED] }), undefined);
});

test('a valid ARCHIVED selection is KEPT — the bug this fixes', () => {
  // Before: validity was checked against the active-only list, so this returned the first active
  // campaign (or null) and the archived pick was stomped a frame after the user made it.
  assert.equal(resolveChipSelection({ value: { id: 'z9' }, campaigns: [ACTIVE, ARCHIVED] }), undefined);
});

test('with nothing picked, the default is the first ACTIVE campaign — never an archived one', () => {
  // Fed archived-FIRST on purpose: the server sorts isActive:-1 today, and this must not be the
  // thing holding the rule up. If that sort ever changes, the default must still skip archives.
  const next = resolveChipSelection({ value: null, campaigns: [ARCHIVED, ACTIVE, ACTIVE_2] });
  assert.equal(next.id, 'a1');
  assert.equal(next.name, 'Running');
});

test('with nothing picked and ONLY archived campaigns, it clears rather than seating an archive', () => {
  // The org from the bug report. null means "no auto-pick" — the user chooses from the menu,
  // which is exactly the deliberate act archived selection is supposed to be.
  assert.equal(resolveChipSelection({ value: null, campaigns: [ARCHIVED] }), null);
});

test('a selection missing from the list (lead scope, deleted) falls back to the first active', () => {
  const next = resolveChipSelection({ value: { id: 'gone' }, campaigns: [ACTIVE, ARCHIVED] });
  assert.equal(next.id, 'a1');
});

test('a missing selection with only archived campaigns clears', () => {
  assert.equal(resolveChipSelection({ value: { id: 'gone' }, campaigns: [ARCHIVED] }), null);
});

test('clearing is idempotent — feeding the result back does not loop', () => {
  // The caller persists whatever comes back; if null kept producing a fresh null the effect
  // would write on every render.
  assert.equal(resolveChipSelection({ value: null, campaigns: [] }), null);
  assert.equal(resolveChipSelection({ value: null, campaigns: [ARCHIVED] }), null);
});

test('ids compare as strings, so an ObjectId-shaped _id still matches', () => {
  const objectIdish = { _id: { toString: () => 'a1' }, name: 'Running', isActive: true };
  assert.equal(resolveChipSelection({ value: { id: 'a1' }, campaigns: [objectIdish] }), undefined);
});

test('an unloaded list returns undefined so the caller cannot act on it', () => {
  assert.equal(resolveChipSelection({ value: { id: 'a1' }, campaigns: undefined }), undefined);
  assert.equal(resolveChipSelection({ value: null, campaigns: null }), undefined);
});

test('archiveStateOf: active / archived / unknown', () => {
  const list = [ACTIVE, ARCHIVED];
  assert.equal(archiveStateOf(list, 'a1'), 'active');
  assert.equal(archiveStateOf(list, 'z9'), 'archived');
  assert.equal(archiveStateOf(list, null), 'unknown');       // nothing picked
  assert.equal(archiveStateOf(list, 'gone'), 'unknown');     // not in this viewer's list
  assert.equal(archiveStateOf(undefined, 'a1'), 'unknown');  // list still loading
});

test('archiveStateOf: a row with NO isActive field reads as active, not archived', () => {
  // An older server that doesn't send the field must never flip a live org read-only. This is
  // why every check is `isActive === false` and never `!isActive`.
  assert.equal(archiveStateOf([{ _id: 'a1', name: 'Legacy' }], 'a1'), 'active');
  assert.equal(isArchivedCampaign({ _id: 'a1' }), false);
  assert.equal(isArchivedCampaign({ _id: 'a1', isActive: false }), true);
});

test('campaignShape emits exactly the five persisted keys, with a stringified id', () => {
  // canvass.activeCampaign is read by the canvasser flow too — the shape is a contract.
  const shaped = campaignShape({ _id: { toString: () => 'a1' }, name: 'Running', type: 'survey', state: 'FL', timeZone: 'America/New_York', isActive: true });
  assert.deepEqual(Object.keys(shaped).sort(), ['id', 'name', 'state', 'timeZone', 'type']);
  assert.equal(shaped.id, 'a1');
  assert.equal(typeof shaped.id, 'string');
});
