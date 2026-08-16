import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The toggleable/always-on outcome split is a hand-maintained mirror across the two clients:
//   client/src/lib/outcomeToggles.js   (web Door Outcomes page)
//   mobile/lib/outcomeToggles.js       (mobile admin Door Outcomes screen)
// This is the gate that keeps them honest, the same way actionLabels.test.js keeps the label
// maps honest. All three files are plain ESM with no React/RN imports, so they load in node.
// Runs under plain `npm test` (no DB, no app boot).
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../client/src/lib/outcomeToggles.js');
const MOBILE = path.resolve(here, '../../mobile/lib/outcomeToggles.js');

const web = await import(WEB);
const mobile = await import(MOBILE);
const server = await import('../src/services/canvass/outcomeToggles.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Campaign } = await import('../src/models/Campaign.js');

// Read straight off the schema rather than hand-listed — a hand-listed copy would just be
// another mirror to drift.
const ACTION_TYPES = CanvassActivity.schema.path('actionType').enumValues;

test('every toggleable and always-on outcome is a real actionType', () => {
  for (const k of [...server.TOGGLEABLE_OUTCOMES, ...server.ALWAYS_ON_OUTCOMES]) {
    assert.ok(ACTION_TYPES.includes(k), `'${k}' is not in the CanvassActivity actionType enum`);
  }
});

test('toggleable and always-on are disjoint — an outcome cannot be both', () => {
  for (const k of server.TOGGLEABLE_OUTCOMES) {
    assert.ok(!server.ALWAYS_ON_OUTCOMES.includes(k), `'${k}' appears in both lists`);
  }
});

test('Campaign.disabledOutcomes element enum IS the toggleable list', () => {
  // Read off the schema path, never hand-listed: if the model and the constant ever disagree,
  // zod and mongoose would accept different sets and the write path would 500 on the gap.
  const elementEnum = Campaign.schema.path('disabledOutcomes').caster.enumValues;
  assert.deepStrictEqual([...elementEnum].sort(), [...server.TOGGLEABLE_OUTCOMES].sort());
});

test('web and mobile mirrors match the server exactly', () => {
  for (const m of [web, mobile]) {
    assert.deepStrictEqual([...m.TOGGLEABLE_OUTCOMES], [...server.TOGGLEABLE_OUTCOMES]);
    assert.deepStrictEqual([...m.ALWAYS_ON_OUTCOMES], [...server.ALWAYS_ON_OUTCOMES]);
  }
});

test('both clients hint every toggleable outcome, identically', () => {
  assert.deepStrictEqual(
    web.OUTCOME_HINTS,
    mobile.OUTCOME_HINTS,
    'client/src/lib/outcomeToggles.js and mobile/lib/outcomeToggles.js have drifted — the same toggle would explain itself differently depending on the device'
  );
  assert.deepStrictEqual(Object.keys(web.OUTCOME_HINTS).sort(), [...server.TOGGLEABLE_OUTCOMES].sort());
});
