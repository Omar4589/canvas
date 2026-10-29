import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { sealSecret, openSecret, sealedSecretConfigured } from '../src/utils/sealedSecret.js';
import {
  sealLinkPassword,
  openLinkPassword,
  readLinkPassword,
  sameLinkPassword,
  primaryLinkOf,
  isAllReportsLink,
  allReportsRetired,
} from '../src/services/reports/shareLinks.js';

// Sealing link passwords (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §B, contract K10) and the small rules
// around them — no database. sealedSecret.js gains optional associated data: an empty one equals none,
// so FbTime's single-argument seals and opens, and the `v1:` format, are exactly what they were. A link's
// password is bound to its hash (`report-link:<hash>`): a stale copy, a value sealed for anything else, a
// replaced key — none opens. Neither link helper ever throws.
const KEY = Buffer.alloc(32, 1).toString('base64');
const saved = process.env.CREDENTIAL_SEAL_KEY;
const HASH = '$2a$10$abcdefghijklmnopqrstuuF3bDaJ2X9bTqQxv1nO4f5mYvIhk0Xy';
const OTHER_HASH = '$2a$10$abcdefghijklmnopqrstuuQzK3pXc8h1tRr2mN6uVwEoLs9jYkZa';

beforeEach(() => {
  process.env.CREDENTIAL_SEAL_KEY = KEY;
});
after(() => {
  if (saved === undefined) delete process.env.CREDENTIAL_SEAL_KEY;
  else process.env.CREDENTIAL_SEAL_KEY = saved;
});

test('sealSecret / openSecret: associated data binds a value; an empty one equals none', () => {
  const bound = sealSecret('the-secret', 'report-link:abc');
  assert.match(bound, /^v1:[^:]+:[^:]+:[^:]+$/, 'the v1 format');
  assert.strictEqual(openSecret(bound, 'report-link:abc'), 'the-secret');
  assert.throws(() => openSecret(bound, 'report-link:abd'), 'another binding');
  assert.throws(() => openSecret(bound), 'no binding');
  const plain = sealSecret('the-secret');
  assert.throws(() => openSecret(plain, 'report-link:abc'), 'sealed without, opened with');
  for (const empty of ['', null, undefined]) {
    assert.strictEqual(openSecret(sealSecret('x', empty)), 'x', JSON.stringify(empty));
    assert.strictEqual(openSecret(plain, empty), 'the-secret');
  }
});

test('FbTime’s single-argument seals are unchanged: one sealed before associated data existed still opens', () => {
  // The old sealSecret, verbatim: AES-256-GCM, a 12-byte IV, no setAAD.
  const key = Buffer.from(KEY, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update('fbt_test_oldkey0001', 'utf8'), cipher.final()]);
  const old = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  assert.strictEqual(openSecret(old), 'fbt_test_oldkey0001');
  assert.strictEqual(openSecret(sealSecret('fbt_test_newkey0001')), 'fbt_test_newkey0001');
  delete process.env.CREDENTIAL_SEAL_KEY;
  assert.throws(() => sealSecret('x'), /not configured/, 'FbTime still throws without a key');
  assert.strictEqual(sealedSecretConfigured(), false);
});

test('sealLinkPassword / openLinkPassword: bound to the hash; a stale or foreign copy never opens', () => {
  const sealed = sealLinkPassword('k7Hq9mXrW2pZ', HASH);
  assert.match(sealed, /^v1:/);
  assert.ok(!sealed.includes('k7Hq9mXrW2pZ'));
  assert.strictEqual(openLinkPassword(sealed, HASH), 'k7Hq9mXrW2pZ');
  assert.strictEqual(openLinkPassword(sealed, OTHER_HASH), null, 'the hash changed behind it: stale');
  assert.strictEqual(openLinkPassword(sealSecret('k7Hq9mXrW2pZ'), HASH), null, 'sealed without the link’s associated data');
  assert.strictEqual(openLinkPassword(sealSecret('k7Hq9mXrW2pZ', `report-link:${OTHER_HASH}`), HASH), null);
  assert.deepStrictEqual(readLinkPassword(sealed, HASH), { password: 'k7Hq9mXrW2pZ', reason: null });
  assert.deepStrictEqual(readLinkPassword(sealed, OTHER_HASH), { password: null, reason: 'unreadable' });
  assert.deepStrictEqual(readLinkPassword(null, HASH), { password: null, reason: 'not_kept' });
  assert.deepStrictEqual(readLinkPassword(undefined, HASH), { password: null, reason: 'not_kept' });
  // A replaced key.
  process.env.CREDENTIAL_SEAL_KEY = Buffer.alloc(32, 2).toString('base64');
  assert.deepStrictEqual(readLinkPassword(sealed, HASH), { password: null, reason: 'unreadable' });
});

test('no key or a malformed one: nothing is sealed, nothing opens — and nothing throws', () => {
  const sealed = sealLinkPassword('k7Hq9mXrW2pZ', HASH);
  for (const key of [undefined, '', 'short', Buffer.alloc(16).toString('base64')]) {
    if (key === undefined) delete process.env.CREDENTIAL_SEAL_KEY;
    else process.env.CREDENTIAL_SEAL_KEY = key;
    assert.strictEqual(sealLinkPassword('k7Hq9mXrW2pZ', HASH), null, `seal with ${JSON.stringify(key)}`);
    assert.strictEqual(openLinkPassword(sealed, HASH), null);
    assert.deepStrictEqual(readLinkPassword(sealed, HASH), { password: null, reason: 'no_key' });
  }
});

test('the link helpers never throw, whatever they are handed', () => {
  const junk = [undefined, null, '', 0, 12, {}, [], 'v1:', 'v1:a:b:c', 'v2:a:b:c', 'v1:@@:##:$$', true];
  for (const a of junk) {
    for (const b of junk) {
      assert.doesNotThrow(() => openLinkPassword(a, b));
      assert.doesNotThrow(() => readLinkPassword(a, b));
      assert.doesNotThrow(() => sealLinkPassword(a, b));
    }
  }
  assert.strictEqual(sealLinkPassword('k7Hq9mXrW2pZ', null), null, 'no hash to bind to');
  assert.strictEqual(sealLinkPassword('', HASH), null);
  assert.strictEqual(sealLinkPassword('abcdefghijk\ud800', HASH), null, 'never a lone surrogate');
});

test('sameLinkPassword: the same opened text, or an identical hash', () => {
  assert.strictEqual(sameLinkPassword({ passwordHash: 'h1', password: 'pw' }, { passwordHash: 'h2', password: 'pw' }), true, 'typed again');
  assert.strictEqual(sameLinkPassword({ passwordHash: 'h1', password: null }, { passwordHash: 'h1', password: null }), true, 'copied, nothing opened');
  assert.strictEqual(sameLinkPassword({ passwordHash: 'h1', password: 'pw' }, { passwordHash: 'h2', password: 'other' }), false);
  assert.strictEqual(sameLinkPassword({ passwordHash: 'h1', password: null }, { passwordHash: 'h2', password: null }), false, 'nothing to tell');
  assert.strictEqual(sameLinkPassword({ passwordHash: null, password: null }, { passwordHash: null, password: null }), false, 'two open links share nothing');
});

test('primaryLinkOf: the newest that works now, else the newest', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const at = (d) => new Date(`2026-10-${d}T00:00:00Z`);
  const ok = { _id: 'a', createdAt: at(20), isActive: true, expiresAt: at(30) };
  const newerOff = { _id: 'b', createdAt: at(25), isActive: false, expiresAt: at(30) };
  const newerExpired = { _id: 'c', createdAt: at(26), isActive: true, expiresAt: at(27) };
  const newerLocked = { _id: 'd', createdAt: at(27), isActive: true, expiresAt: at(30), failedUnlockAt: Array.from({ length: 50 }, (_, i) => ({ at: new Date(now.getTime() - 1000 * (i + 1)), id: `x${i}` })) };
  assert.strictEqual(primaryLinkOf([ok, newerOff, newerExpired, newerLocked], now)._id, 'a');
  assert.strictEqual(primaryLinkOf([newerOff, newerExpired, newerLocked], now)._id, 'd', 'none works: the newest');
  assert.strictEqual(primaryLinkOf([], now), null);
});

test('isAllReportsLink and allReportsRetired', () => {
  assert.strictEqual(isAllReportsLink({ reportId: null }), true);
  assert.strictEqual(isAllReportsLink({}), true, 'a link from before the field');
  assert.strictEqual(isAllReportsLink({ reportId: 'x' }), false);
  for (const v of ['on', 'TRUE', ' 1 ']) assert.strictEqual(allReportsRetired(v), true);
  for (const v of ['', 'off', 'no', undefined]) assert.strictEqual(allReportsRetired(v), false);
});
