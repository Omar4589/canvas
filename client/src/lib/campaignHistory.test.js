import { test } from 'node:test';
import assert from 'node:assert';
import { labelForField, formatValue, isNotable } from './campaignHistory.js';

// The History rows for the two door settings. The server stores only the field key and raw values
// (a list as its sorted comma-join, an empty one as null), so a lost label or branch here breaks
// nothing loudly: the rows fall back to "Enabled Outcomes: not set → not_target" and "Door Add
// Policy: all → leads" (how that one read before its fix). Kept identical to
// mobile/lib/campaignHistory.test.js, as the two modules are.

// A row's three strings, joined the way the docs write one.
const row = (field, fromValue, toValue) =>
  `${labelForField(field)}: ${formatValue(field, fromValue)} → ${formatValue(field, toValue)}`;

test('an off-by-default outcome reads as its label both ways, and an empty list reads "none"', () => {
  assert.strictEqual(row('enabledOutcomes', null, 'not_target'), 'Off-by-default outcomes: none → Not a target voter');
  assert.strictEqual(row('enabledOutcomes', 'not_target', null), 'Off-by-default outcomes: Not a target voter → none');
  // Every campaign is born with nothing extra on: empty is "none", never the generic "not set".
  assert.strictEqual(formatValue('enabledOutcomes', undefined), 'none');
  assert.strictEqual(formatValue('enabledOutcomes', ''), 'none');
});

test('switching an off-by-default outcome on or off is highlighted', () => {
  // The trust decision behind an outcome nobody can check: the row is the record of who and when.
  const item = { kind: 'config', field: 'enabledOutcomes' };
  assert.strictEqual(isNotable({ ...item, fromValue: null, toValue: 'not_target' }), true, 'on');
  assert.strictEqual(isNotable({ ...item, fromValue: 'not_target', toValue: null }), true, 'off');
});

test('the Add-person policy reads in words both ways, and an unset one reads as everyone', () => {
  assert.strictEqual(
    row('doorAddPolicy', 'all', 'leads'),
    'Adding people at the door: Everyone on the campaign → Team leads & admins only'
  );
  assert.strictEqual(
    row('doorAddPolicy', 'leads', 'all'),
    'Adding people at the door: Team leads & admins only → Everyone on the campaign'
  );
  // 'all' is the schema default, so a campaign saved before the setting existed reads as it.
  assert.strictEqual(formatValue('doorAddPolicy', null), 'Everyone on the campaign');
});
