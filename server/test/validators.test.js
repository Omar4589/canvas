import { test } from 'node:test';
import assert from 'node:assert';
import {
  phoneSchema,
  usStateSchema,
  nameSchema,
  slugSchema,
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
