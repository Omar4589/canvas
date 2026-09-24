import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ACTION type → display label is a hand-maintained mirror across the two clients:
//   client/src/lib/statusColors.js   (web)
//   mobile/lib/theme.js              (mobile)
// This is the gate that keeps them honest. It exists because the map had already drifted into
// FOURTEEN private copies, and `survey_submitted` was rendering three different ways depending
// on which screen you were looking at — "Survey submitted" on audit surfaces, "Surveyed" in
// activity feeds, "Survey" in notes lists. Canonical wording is now "Surveyed", which also
// matches the *status* label for the status that action produces.
//
// Both files are plain ESM with no React/RN imports at the top level, so they load in node.
// Runs under plain `npm test` (no DB, no app boot).
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../client/src/lib/statusColors.js');
const MOBILE = path.resolve(here, '../../mobile/lib/theme.js');

const web = await import(WEB);
const mobile = await import(MOBILE);
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

// Every actionType the server can write, read STRAIGHT OFF the CanvassActivity schema rather
// than hand-listed here — a hand-listed copy would just be a fourth mirror to drift. Add an
// action to the model and this test fails until both label maps learn it.
const ACTION_TYPES = CanvassActivity.schema.path('actionType').enumValues;

test('web and mobile action labels are identical', () => {
  assert.deepStrictEqual(
    web.ACTION_LABELS,
    mobile.ACTION_LABELS,
    'client/src/lib/statusColors.js and mobile/lib/theme.js have drifted — the same action would read differently depending on the device'
  );
});

test('every actionType the server writes has a label on both platforms', () => {
  for (const t of ACTION_TYPES) {
    assert.ok(web.ACTION_LABELS[t], `web is missing a label for '${t}'`);
    assert.ok(mobile.ACTION_LABELS[t], `mobile is missing a label for '${t}'`);
  }
  // ...and nothing extra, which would mean an action was renamed/removed server-side without
  // the label maps following.
  assert.deepStrictEqual(Object.keys(web.ACTION_LABELS).sort(), [...ACTION_TYPES].sort());
});

test("survey_submitted reads 'Surveyed' — the same word as the status it produces", () => {
  assert.strictEqual(web.ACTION_LABELS.survey_submitted, 'Surveyed');
  assert.strictEqual(web.ACTION_LABELS.survey_submitted, web.STATUS_LABELS.surveyed);
});

test('actionLabel falls back to the raw type rather than rendering blank', () => {
  assert.strictEqual(web.actionLabel('survey_submitted'), 'Surveyed');
  assert.strictEqual(web.actionLabel('some_future_action'), 'some_future_action');
  assert.strictEqual(mobile.actionLabel('some_future_action'), 'some_future_action');
  assert.strictEqual(web.actionLabel(undefined), '—');
});

// ── door STATUS labels (the same gate, one domain over) ───────────────────────────────────────
// A status is not an action: `surveyed` and `unknocked` are statuses no actionType is named for,
// and `note_added` is an action with no status. The server needs its own status→label map because
// a client-sendable CSV prints the words rather than the slugs (services/export), and this is what
// stops it drifting from what the web console shows for the same door.
//
// Keys come off Household's own enum, like ACTION_TYPES above comes off CanvassActivity's — a
// renamed status fails here rather than shipping a raw slug to a customer. deepStrictEqual against
// the web map is impossible and should not be attempted: that map also carries voted / dnc /
// doNotKnock, which are VOTER facts, not door statuses. Subset, therefore, in both directions that
// matter — every door status has a label, and every label matches the web wording.
const { Household } = await import('../src/models/Household.js');
const { DOOR_STATUS_LABELS } = await import('../src/utils/statusPrecedence.js');
const DOOR_STATUSES = Household.schema.path('status').enumValues;

test('the server door-status labels cover exactly Household.status', () => {
  assert.deepStrictEqual(
    Object.keys(DOOR_STATUS_LABELS).sort(),
    [...DOOR_STATUSES].sort(),
    'server/src/utils/statusPrecedence.js DOOR_STATUS_LABELS has drifted from the Household.status enum'
  );
});

test('server door-status wording is identical to the web console', () => {
  for (const status of DOOR_STATUSES) {
    assert.strictEqual(
      DOOR_STATUS_LABELS[status],
      web.STATUS_LABELS[status],
      `'${status}' reads differently in an export than on the web map`
    );
  }
});
