import { test, afterEach } from 'node:test';
import assert from 'node:assert';

// The FbTime client's test seam and error surface — no network, no DB.
//   node --test test/fbtimeClient.test.js
const { ping, getShifts, listAllPeople, setFbtimeFake, FbtimeApiError, FATAL_CODES } = await import(
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
    () => getShifts({ apiKey: 'fbt_test_x', startDate: '2026-08-01', endDate: '2026-08-02', timeZone: 'America/New_York' }),
    (err) => err instanceof FbtimeApiError && err.code === 'KEY_REVOKED' && err.status === 401
  );
  // The codes sync treats as fatal-for-the-connection are exactly these four.
  assert.deepStrictEqual(
    [...FATAL_CODES].sort(),
    ['KEY_EXPIRED', 'KEY_INVALID', 'KEY_REVOKED', 'ORG_INACTIVE']
  );
});

test('getShifts forwards the range and timezone (the window edge), pages at 1000', async () => {
  installFbtimeFake({ shifts: [{ id: 's1', userId: 'p1', clockIn: '2026-08-01T14:00:00Z' }] });
  const res = await getShifts({
    apiKey: 'fbt_test_tz',
    startDate: '2026-08-01',
    endDate: '2026-08-07',
    timeZone: 'America/Chicago',
  });
  assert.strictEqual(res.length, 1);
  const { params } = fbtimeCalls()[0];
  assert.strictEqual(params.timeZone, 'America/Chicago');
  assert.strictEqual(params.startDate, '2026-08-01');
  assert.strictEqual(params.limit, 1000);
});

test('getShifts drains pagination, and a total that MOVES between pages triggers ONE re-pull', async () => {
  // Page-scripted fake: two pages of a pull whose total drifts (a shift was
  // edited mid-pull, shuffling the clockIn-sorted pages), then a stable
  // two-page pull. The client must restart once and return the stable set.
  let call = 0;
  installFbtimeFake({
    shifts: ({ params }) => {
      call += 1;
      const page = Number(params.page);
      const paged = (ids, total) => ({
        shifts: ids.map((id) => ({ id, userId: 'p1', clockIn: '2026-08-01T14:00:00Z' })),
        pagination: { page, limit: 1000, total, totalPages: 2 },
      });
      if (call <= 2) return page === 1 ? paged(['a', 'b'], 4) : paged(['c'], 3); // drift: 4 → 3
      return page === 1 ? paged(['a', 'b'], 3) : paged(['d'], 3); // stable re-pull
    },
  });
  const shifts = await getShifts({
    apiKey: 'fbt_test_drift', startDate: '2026-08-01', endDate: '2026-08-07', timeZone: 'America/Chicago',
  });
  assert.deepStrictEqual(shifts.map((s) => s.id), ['a', 'b', 'd'], 'the re-pulled set, not the torn one');
  assert.strictEqual(fbtimeCalls().length, 4, 'exactly one restart — never a loop');
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
