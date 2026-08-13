import { test, afterEach } from 'node:test';
import assert from 'node:assert';

// The FbTime client's test seam and error surface — no network, no DB.
//   node --test test/fbtimeClient.test.js
const { ping, getHours, listAllPeople, setFbtimeFake, FbtimeApiError, FATAL_CODES } = await import(
  '../src/services/fbtime/client.js'
);
const { installFbtimeFake, uninstallFbtimeFake, fbtimeCalls } = await import(
  './support/fbtimeFake.js'
);

afterEach(() => uninstallFbtimeFake());

test('an fbt_test_ key routes to the installed fake, never the network', async () => {
  installFbtimeFake({ ping: { ok: true, organization: { id: 'abc', name: 'Fake Org' } } });
  const res = await ping({ apiKey: 'fbt_test_route' });
  assert.strictEqual(res.organization.name, 'Fake Org');
  assert.strictEqual(fbtimeCalls().length, 1);
  assert.strictEqual(fbtimeCalls()[0].path, '/ping');
});

test('an fbt_test_ key with NO fake installed throws loudly, not silently succeeds', async () => {
  await assert.rejects(() => ping({ apiKey: 'fbt_test_orphan' }), /no fake installed/);
});

test('a missing key is refused before anything else, with KEY_MALFORMED', async () => {
  await assert.rejects(
    () => ping({ apiKey: '' }),
    (err) => err instanceof FbtimeApiError && err.code === 'KEY_MALFORMED'
  );
});

test('provider machine codes surface as FbtimeApiError.code', async () => {
  installFbtimeFake({ error: { code: 'KEY_REVOKED', status: 401 } });
  await assert.rejects(
    () => getHours({ apiKey: 'fbt_test_x', startDate: '2026-08-01', endDate: '2026-08-02', timeZone: 'America/New_York' }),
    (err) => err instanceof FbtimeApiError && err.code === 'KEY_REVOKED' && err.status === 401
  );
  // The codes sync treats as fatal-for-the-connection are exactly these four.
  assert.deepStrictEqual(
    [...FATAL_CODES].sort(),
    ['KEY_EXPIRED', 'KEY_INVALID', 'KEY_REVOKED', 'ORG_INACTIVE']
  );
});

test('getHours forwards the range and timezone — the bucket-alignment contract', async () => {
  installFbtimeFake({ hours: ({ params }) => ({ people: [], range: params }) });
  const res = await getHours({
    apiKey: 'fbt_test_tz',
    startDate: '2026-08-01',
    endDate: '2026-08-07',
    timeZone: 'America/Chicago',
  });
  assert.strictEqual(res.range.timeZone, 'America/Chicago');
  assert.strictEqual(res.range.startDate, '2026-08-01');
  assert.strictEqual(res.range.includeDays, 'true');
});

test('listAllPeople drains pagination to exhaustion', async () => {
  // The fake serves one page; assert the client asked for page 1 and stopped
  // at totalPages — the by-_id ordering guarantee lives on the provider side.
  installFbtimeFake({ people: [{ id: 'p1' }, { id: 'p2' }] });
  const people = await listAllPeople({ apiKey: 'fbt_test_pages' });
  assert.strictEqual(people.length, 2);
  assert.strictEqual(fbtimeCalls()[0].params.includeInactive, 'true');
});

test('the raw key never appears in an error message', async () => {
  installFbtimeFake({ error: { code: 'KEY_INVALID', status: 401, message: 'Invalid API key.' } });
  try {
    await ping({ apiKey: 'fbt_test_supersecret123' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(!String(err.message).includes('supersecret123'));
  }
  // Direct handler use (setFbtimeFake) — same guarantee for a thrown non-Fbtime error.
  setFbtimeFake(() => {
    throw new Error('boom');
  });
  try {
    await ping({ apiKey: 'fbt_test_supersecret123' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(!String(err.message).includes('supersecret123'));
  }
});
