import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readParams, nextParams, sameParams } from './listParams.js';

const DEFAULTS = { chip: 'current', q: '', crew: 'all', page: '1', person: '' };

test('reading falls back to each default', () => {
  assert.deepEqual(readParams(new URLSearchParams('crew=d1&page=3'), DEFAULTS), {
    chip: 'current',
    q: '',
    crew: 'd1',
    page: '3',
    person: '',
  });
});

test('a write keeps the keys the page does not own, and leaves out defaults and empties', () => {
  const now = new URLSearchParams('return=%2Fcampaigns%2Fc1&crew=d1&page=2');
  const next = nextParams(now, { crew: 'all', person: 'u7', page: 1 }, DEFAULTS);
  assert.equal(next.get('return'), '/campaigns/c1', '?return= passes through');
  assert.equal(next.has('crew'), false, 'back at its default');
  assert.equal(next.has('page'), false, 'page 1 is how the page opens');
  assert.equal(next.get('person'), 'u7');
  assert.equal(nextParams(next, { person: null }, DEFAULTS).has('person'), false, 'closing clears the person');
});

test('a write that changes nothing is recognised, whatever the key order', () => {
  assert.equal(sameParams(new URLSearchParams('a=1&b=2'), new URLSearchParams('b=2&a=1')), true);
  assert.equal(sameParams(new URLSearchParams('a=1'), new URLSearchParams('a=2')), false);
  const now = new URLSearchParams('crew=d1');
  assert.equal(sameParams(nextParams(now, { crew: 'd1', page: '1' }, DEFAULTS), now), true, 'no-op guard');
});
