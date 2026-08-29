import { test } from 'node:test';
import assert from 'node:assert';
import { foldDeltaVoters } from './deltaFold.js';

const V = (_id, householdId, extra = {}) => ({ _id, householdId, fullName: `v${_id}`, ...extra });

test('known voters merge whole (delta fields win)', () => {
  const prev = [V('a', 'h1', { surveyStatus: 'not_surveyed' })];
  const delta = [V('a', 'h1', { surveyStatus: 'surveyed', surveyedByMe: true })];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.equal(out.length, 1);
  assert.equal(out[0].surveyStatus, 'surveyed');
  assert.equal(out[0].surveyedByMe, true);
});

test('unknown voter at a known household APPENDS (the walk-up case)', () => {
  const prev = [V('a', 'h1')];
  const delta = [V('b', 'h1')];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.deepEqual(out.map((v) => v._id), ['a', 'b']);
});

test('unknown voter at an UNKNOWN household is skipped (door suppressed or out of scope)', () => {
  const prev = [V('a', 'h1')];
  const delta = [V('b', 'h2')];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.deepEqual(out.map((v) => v._id), ['a']);
});

test('empty delta returns prev by reference (no churn)', () => {
  const prev = [V('a', 'h1')];
  assert.strictEqual(foldDeltaVoters(prev, [], new Set(['h1'])), prev);
});

test('mixed: merge + append + skip in one fold', () => {
  const prev = [V('a', 'h1', { surveyStatus: 'not_surveyed' }), V('c', 'h3')];
  const delta = [
    V('a', 'h1', { surveyStatus: 'surveyed' }), // merge
    V('b', 'h1'), // append (known door)
    V('x', 'h9'), // skip (unknown door)
  ];
  const out = foldDeltaVoters(prev, delta, new Set(['h1', 'h3']));
  assert.deepEqual(out.map((v) => v._id), ['a', 'c', 'b']);
  assert.equal(out[0].surveyStatus, 'surveyed');
});
