import { test } from 'node:test';
import assert from 'node:assert';
import { newObjectIdHex } from './objectId.js';

// The generated id must be a valid Mongo ObjectId hex string — the server regex-gates the
// create body on /^[0-9a-f]{24}$/i and casts it with new mongoose.Types.ObjectId(id).
test('shape: 24 lowercase hex chars', () => {
  for (let i = 0; i < 100; i++) {
    assert.match(newObjectIdHex(), /^[0-9a-f]{24}$/);
  }
});

test('timestamp prefix decodes to roughly now', () => {
  const before = Math.floor(Date.now() / 1000);
  const id = newObjectIdHex();
  const after = Math.floor(Date.now() / 1000);
  const ts = parseInt(id.slice(0, 8), 16);
  assert.ok(ts >= before && ts <= after, `${ts} not within [${before}, ${after}]`);
});

test('unique across many draws', () => {
  const seen = new Set();
  for (let i = 0; i < 10_000; i++) seen.add(newObjectIdHex());
  assert.equal(seen.size, 10_000);
});
