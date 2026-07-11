import { test } from 'node:test';
import assert from 'node:assert';
import {
  phoneSchema,
  usStateSchema,
  nameSchema,
  slugSchema,
  passwordSchema,
  strongPasswordSchema,
  isStrongPassword,
  passwordProblem,
} from '../src/utils/validators.js';

// Pure schema tests — no DB, always run. Locks the "phone can't hold letters" fix and
// the real-US-state check.

test('phoneSchema canonicalizes valid US numbers to (555) 123-4567', () => {
  assert.strictEqual(phoneSchema.parse('5551234567'), '(555) 123-4567');
  assert.strictEqual(phoneSchema.parse('+1 (555) 123-4567'), '(555) 123-4567');
  assert.strictEqual(phoneSchema.parse('555.123.4567'), '(555) 123-4567');
  assert.strictEqual(phoneSchema.parse('1-555-123-4567'), '(555) 123-4567');
  // optional → empty / absent become undefined
  assert.strictEqual(phoneSchema.parse(''), undefined);
  assert.strictEqual(phoneSchema.parse(undefined), undefined);
});

test('phoneSchema rejects letters and wrong digit counts', () => {
  for (const bad of ['abc', '555-CALL-NOW', '123', '999999999999999']) {
    assert.throws(() => phoneSchema.parse(bad), /valid US phone/i, `should reject ${bad}`);
  }
});

test('usStateSchema uppercases valid states and rejects fakes', () => {
  assert.strictEqual(usStateSchema.parse('ky'), 'KY');
  assert.strictEqual(usStateSchema.parse('Tx'), 'TX');
  assert.throws(() => usStateSchema.parse('XX'));
  assert.throws(() => usStateSchema.parse('ZZ'));
  assert.throws(() => usStateSchema.parse('Kentucky'));
});

test('nameSchema trims + bounds; slugSchema enforces kebab-case', () => {
  assert.strictEqual(nameSchema.parse('  Jane  '), 'Jane');
  assert.throws(() => nameSchema.parse('   '));
  assert.throws(() => nameSchema.parse('x'.repeat(81)));
  assert.strictEqual(slugSchema.parse('acme-campaigns-2026'), 'acme-campaigns-2026');
  assert.throws(() => slugSchema.parse('Acme Campaigns'));
  assert.throws(() => slugSchema.parse('-leading-hyphen'));
});

test('strongPasswordSchema accepts a compliant user-chosen password', () => {
  assert.strictEqual(strongPasswordSchema.parse('Str0ng!pw'), 'Str0ng!pw');
  assert.ok(isStrongPassword('Str0ng!pw'));
  assert.strictEqual(passwordProblem('Str0ng!pw'), null);
});

test('strongPasswordSchema rejects a password missing ANY required class', () => {
  const cases = {
    'password123!': 'uppercase', // no uppercase
    'PASSWORD123!': 'lowercase', // no lowercase
    'Password!!!': 'number', // no number
    'Password123': 'special', // no special
    'Ab1!': 'characters', // too short
    // the classic weak password the report flagged — no uppercase, no special
    password123: 'password needs',
  };
  for (const [bad, needle] of Object.entries(cases)) {
    assert.strictEqual(isStrongPassword(bad), false, `${bad} should be weak`);
    assert.throws(() => strongPasswordSchema.parse(bad), new RegExp(needle, 'i'), `reject ${bad}`);
  }
});

test('admin temp passwordSchema stays lax (min 8, no complexity) — victory26 / password123 ok', () => {
  // Admin-set temporary passwords are replaced at first login; complexity is intentionally
  // NOT required here (keeps existing create/reset flows + fixtures working).
  assert.strictEqual(passwordSchema.parse('password123'), 'password123');
  assert.strictEqual(passwordSchema.parse('victory26'), 'victory26'); // a simple temp is fine
  assert.strictEqual(passwordSchema.parse('victory 26'), 'victory 26'); // an internal space is fine
  assert.throws(() => passwordSchema.parse('short')); // still enforces min 8
});

test('admin temp passwordSchema enforces basic hygiene (no whitespace edges / control chars)', () => {
  // A temp password can't be set to something that silently breaks the login it enables.
  assert.throws(() => passwordSchema.parse('        ')); // whitespace-only (8 spaces)
  assert.throws(() => passwordSchema.parse(' victory26')); // leading space
  assert.throws(() => passwordSchema.parse('victory26 ')); // trailing space
  assert.throws(() => passwordSchema.parse(`victory26${String.fromCharCode(9)}`)); // tab (control)
  assert.throws(() => passwordSchema.parse(`vic${String.fromCharCode(0)}tory26`)); // null byte
});
