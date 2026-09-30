// The "same voter ID" rule — pure, always runs. Pins every shape the audit and the matching depend
// on: digits lose their leading zeros, anything with a letter stays exact, all-zero is no ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalVoterId, isAllZeroId } from '../src/utils/voterIdKey.js';

test('digit-only IDs compare without their leading zeros', () => {
  assert.equal(canonicalVoterId('08719967'), '8719967');
  assert.equal(canonicalVoterId('8719967'), '8719967');
  assert.equal(canonicalVoterId('008719967'), '8719967');
  assert.equal(canonicalVoterId('000000012345'), '12345'); // North Carolina pads to 12
  assert.equal(canonicalVoterId('100123456'), '100123456'); // Florida never starts with 0
  assert.equal(canonicalVoterId(' 08719967 '), '8719967');
  assert.equal(canonicalVoterId(8719967), '8719967'); // a numeric cell from a spreadsheet
});

test('an ID with anything but digits is only ever itself', () => {
  assert.equal(canonicalVoterId('LALGA399157167'), 'LALGA399157167');
  assert.equal(canonicalVoterId('OH0012345678'), 'OH0012345678');
  assert.equal(canonicalVoterId('manual:66f1a2b3c4d5e6f7a8b9c0d1'), 'manual:66f1a2b3c4d5e6f7a8b9c0d1');
  assert.equal(canonicalVoterId('DEMO-IA-000001'), 'DEMO-IA-000001');
  assert.equal(canonicalVoterId('0AB12'), '0AB12'); // a leading zero next to a letter is kept
  assert.equal(canonicalVoterId('8719967.0'), '8719967.0'); // Excel float damage is NOT repaired
  assert.equal(canonicalVoterId('1.2E+07'), '1.2E+07');
});

test('all-zero and blank values are no ID at all', () => {
  assert.equal(canonicalVoterId('0'), null);
  assert.equal(canonicalVoterId('00000000'), null);
  assert.equal(canonicalVoterId(''), null);
  assert.equal(canonicalVoterId('   '), null);
  assert.equal(canonicalVoterId(null), null);
  assert.equal(canonicalVoterId(undefined), null);
  assert.equal(isAllZeroId('00000000'), true);
  assert.equal(isAllZeroId('0'), true);
  assert.equal(isAllZeroId('08719967'), false);
  assert.equal(isAllZeroId(''), false);
});
