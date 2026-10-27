import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenRows, matches, atLimit, saveIds, settingsChanged, keptCount, STALE_LINE, MAX_RECIPIENTS } from './recipientPicker.js';

const S = {
  enabled: true,
  billingAdmins: true,
  alertUserIds: ['u1', 'gone'],
  chosen: [
    { userId: 'u1', name: 'Pat Lee', role: 'admin', eligible: true },
    { userId: 'gone', name: 'Jo Park', role: 'canvasser', eligible: false },
  ],
  eligible: [
    { userId: 'u1', name: 'Pat Lee', role: 'admin', billingAdmin: true },
    { userId: 'u2', name: 'Riley Shaw', role: 'lead', billingAdmin: false },
    { userId: 'u3', name: 'Rita Shah', role: 'admin', billingAdmin: false },
  ],
};

test('Also email lists the people chosen; one who can’t be emailed says so', () => {
  assert.deepEqual(chosenRows(S, ['u1', 'gone', 'u2']), [
    { userId: 'u1', name: 'Pat Lee', eligible: true, line: 'Org admin · billing admin' },
    { userId: 'gone', name: 'Jo Park', eligible: false, line: STALE_LINE },
    { userId: 'u2', name: 'Riley Shaw', eligible: true, line: 'Team lead' },
  ]);
  assert.equal(STALE_LINE, 'Not emailed: no longer an admin or team lead');
  // A server before `chosen`: a stored pick still names itself from `eligible`.
  assert.equal(chosenRows({ ...S, chosen: undefined }, ['u1'])[0].name, 'Pat Lee');
});

test('the search matches every typed word, leaves out who is already chosen, at most 8', () => {
  assert.deepEqual(matches(S, ['u1'], 'ri').map((p) => p.userId), ['u2', 'u3']);
  assert.deepEqual(matches(S, ['u1'], 'riley sh').map((p) => p.userId), ['u2']);
  assert.deepEqual(matches(S, ['u1'], 'pat'), [], 'already chosen');
  assert.deepEqual(matches(S, [], ''), [], 'nothing typed, nothing listed');
  const many = { eligible: Array.from({ length: 20 }, (_, i) => ({ userId: `p${i}`, name: `Person ${i}` })) };
  assert.equal(matches(many, [], 'person').length, 8);
});

test('the limit is 25 people a Save would keep', () => {
  const full = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `p${i}`);
  const s = { eligible: full.map((id) => ({ userId: id, name: id })) };
  assert.equal(atLimit(s, full), true);
  assert.equal(atLimit(s, full.slice(1)), false);
  assert.equal(keptCount(s, [...full.slice(1), 'stale']), 24, 'a stale pick doesn’t count against it');
});

test('Save sends only the picks who can be emailed, which drops a stale one', () => {
  assert.deepEqual(saveIds(S, ['u1', 'gone', 'u2', 'u2']), ['u1', 'u2']);
  assert.equal(settingsChanged(S, { enabled: true, billingAdmins: true, alertUserIds: ['gone', 'u1'] }), false, 'order doesn’t matter');
  assert.equal(settingsChanged(S, { enabled: true, billingAdmins: true, alertUserIds: ['u1'] }), true, 'removing the stale pick is a change');
  assert.equal(settingsChanged(S, { enabled: false, billingAdmins: true, alertUserIds: ['u1', 'gone'] }), true);
});
