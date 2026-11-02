import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Doors-not-saved recorder's pure parts (middleware/refusalRecorder.js; docs/PROPOSAL_OFFLINE_QUEUE.md
// §D, §O): which requests are queued writes, and what a request body may put in a row. No database, no
// app boot — runs under plain `npm test`. The recorder over the real app is test/refusedUploads.int.test.js.
const { matchQueuedWrite, cleanQueueItemId, cleanObjectId, cleanRecordedAt, QUEUE_ITEM_ID_MAX } = await import(
  '../src/middleware/refusalRecorder.js'
);

const H = '65a1b2c3d4e5f60718293a4b';
const enc = [...H].map((c) => `%${c.charCodeAt(0).toString(16)}`).join('');

test('the seven door results, the walk-up add, the pin move and the survey match, with their kind', () => {
  const results = {
    'not-home': 'not_home',
    'wrong-address': 'wrong_address',
    'lit-drop': 'lit_dropped',
    refused: 'refused',
    restricted: 'restricted',
    'no-soliciting': 'no_soliciting',
    'not-target': 'not_target',
  };
  for (const [seg, actionType] of Object.entries(results)) {
    assert.deepStrictEqual(matchQueuedWrite('POST', `/households/${H}/${seg}`), { kind: 'result', actionType, householdId: H, voterId: null });
  }
  assert.deepStrictEqual(matchQueuedWrite('POST', `/households/${H}/voters`), { kind: 'add_person', actionType: null, householdId: H, voterId: null });
  assert.deepStrictEqual(matchQueuedWrite('POST', `/households/${H}/location`), { kind: 'pin_move', actionType: null, householdId: H, voterId: null });
  assert.deepStrictEqual(matchQueuedWrite('POST', `/voters/${H}/survey`), { kind: 'survey', actionType: null, householdId: null, voterId: H });
});

test('it matches what Express routes: any case, a trailing slash, an encoded id (lower-cased)', () => {
  assert.strictEqual(matchQueuedWrite('POST', `/households/${H}/not-home/`).actionType, 'not_home');
  assert.strictEqual(matchQueuedWrite('POST', `/households/${H}/NOT-HOME`).actionType, 'not_home');
  assert.deepStrictEqual(matchQueuedWrite('POST', `/HOUSEHOLDS/${H.toUpperCase()}/LOCATION`), {
    kind: 'pin_move', actionType: null, householdId: H, voterId: null,
  });
  assert.strictEqual(matchQueuedWrite('POST', `/households/${enc}/not-home`).householdId, H);
  assert.strictEqual(matchQueuedWrite('POST', `/voters/${enc}/survey`).voterId, H);
});

test('a malformed id still matches, with the id null (filing falls back to the book)', () => {
  assert.deepStrictEqual(matchQueuedWrite('POST', '/households/abc/not-home'), { kind: 'result', actionType: 'not_home', householdId: null, voterId: null });
  assert.deepStrictEqual(matchQueuedWrite('POST', '/voters/123/survey'), { kind: 'survey', actionType: null, householdId: null, voterId: null });
  assert.strictEqual(matchQueuedWrite('POST', `/households/${H}0/location`).householdId, null, '25 characters is not an id');
});

test('nothing else matches: other methods, the voter note, lookalikes, a malformed escape', () => {
  const none = [
    ['GET', `/households/${H}/not-home`],
    ['PUT', `/households/${H}/location`],
    ['POST', `/voters/${H}/notes`], // the only other /mobile POST — not a queued write
    ['POST', `/voters/${H}/surveys`],
    ['POST', `/voters/${H}/not-home`],
    ['POST', `/households/${H}/unknown-action`],
    ['POST', `/households/${H}/constructor`],
    ['POST', `/households/${H}/__proto__`],
    ['POST', `/households/${H}/toString`],
    ['POST', `/households/${H}/survey`],
    ['POST', `/households/${H}/voters/${H}`],
    ['POST', `/households/${H}/not-home/extra`],
    ['POST', `/households//not-home`],
    ['POST', `/households/${H}%2Fnot-home`],
    ['POST', `/households/${H}/not-home;x=1`],
    ['POST', `/me/households/${H}/not-home`],
    ['POST', '/households/%E0%A4%A/not-home'],
    ['POST', '/bootstrap'],
    ['POST', ''],
    ['POST', null],
    ['POST', undefined],
    [undefined, `/households/${H}/not-home`],
  ];
  for (const [method, path] of none) assert.strictEqual(matchQueuedWrite(method, path), null, `${method} ${path}`);
});

test('a queue item id is kept only as a string of 64 characters or fewer', () => {
  assert.strictEqual(cleanQueueItemId('1730500000000-ab12cd'), '1730500000000-ab12cd');
  assert.strictEqual(cleanQueueItemId('q'.repeat(QUEUE_ITEM_ID_MAX)), 'q'.repeat(64));
  assert.strictEqual(cleanQueueItemId('q'.repeat(65)), null);
  assert.strictEqual(cleanQueueItemId('q'.repeat(2_000_000)), null);
  for (const v of ['', 42, null, undefined, {}, ['a'], true]) assert.strictEqual(cleanQueueItemId(v), null, JSON.stringify(v));
});

test('ids are kept only as 24-hex, lower-cased; the tap time only as a real date', () => {
  assert.strictEqual(cleanObjectId(H.toUpperCase()), H);
  for (const v of ['abc', `${H}0`, 'z'.repeat(24), 42, null, { $ne: null }, [H]]) assert.strictEqual(cleanObjectId(v), null, JSON.stringify(v));
  assert.strictEqual(cleanRecordedAt('2026-10-30T20:42:00.000Z').toISOString(), '2026-10-30T20:42:00.000Z');
  for (const v of ['not a date', '', `2026-10-30T20:42:00.000Z${' '.repeat(100)}`, 1730500000000, null, {}, '+275760-09-14T00:00:00.001Z']) {
    assert.strictEqual(cleanRecordedAt(v), null, JSON.stringify(v).slice(0, 60));
  }
});

test('the recorder mounts once, between the sign-in gates and the entitlement gate', () => {
  // The position is load-bearing (§D): after requireAuth + blockIfMustChangePassword (their 401 and
  // temp-password 403 are never recorded), before requireEntitlement and the routers' orgContext (so the
  // 402 and the org-context refusals are). Read off the source, so a reshuffle fails here.
  const src = readFileSync(fileURLToPath(new URL('../src/routes/index.js', import.meta.url)), 'utf8');
  const lines = src.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const gates = at(/router\.use\(\['\/super-admin', '\/admin', '\/mobile'\], requireAuth, blockIfMustChangePassword\)/);
  const recorder = at(/router\.use\('\/mobile', refusalRecorder\)/);
  const entitlement = at(/router\.use\(\['\/admin', '\/mobile'\], requireEntitlement\)/);
  const firstMobileRouter = at(/router\.use\('\/mobile', mobile/);
  assert.ok(gates >= 0 && recorder >= 0 && entitlement >= 0 && firstMobileRouter >= 0);
  assert.ok(gates < recorder && recorder < entitlement && entitlement < firstMobileRouter, `${gates} < ${recorder} < ${entitlement} < ${firstMobileRouter}`);
  assert.strictEqual(lines.filter((l) => /refusalRecorder\)/.test(l)).length, 1, 'mounted exactly once');
});
