import { test } from 'node:test';
import assert from 'node:assert';

// Door counts to FbTime — the pure half: the release var, the send window, request
// planning (person-day sizing, the 2,000 cap, never an empty request), clear slicing
// and grouping, the status model (one case per docs/PROPOSAL_FBTIME_DOOR_COUNTS.md §H
// row), and the shift-owner rule. No database: these are the arithmetic the I/O in
// doorPush.js leans on.
const {
  doorCountsAvailable,
  doorsWindow,
  planDoorRequests,
  peoplePerRequest,
  clearSlices,
  clearGroups,
  doorsStatus,
  firstPassWaiting,
  clearsDue,
  clearsWaiting,
  isCuratedZone,
  accountSignatures,
  CLEAR_FLOOR_DAYS,
} = await import('../src/services/fbtime/doorCounts.js');
const { shiftOwnerOf, normPersonId } = await import('../src/services/fbtime/shiftOwner.js');

const pid = (n) => n.toString(16).padStart(24, 'a');
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysIn = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

test('the release var: on, true or 1 — trimmed, any case; anything else is off', () => {
  for (const v of ['on', 'ON', ' true ', '1', 'True']) assert.strictEqual(doorCountsAvailable(v), true, v);
  for (const v of [null, '', 'off', '0', 'yes', 'false', 'enabled']) assert.strictEqual(doorCountsAvailable(v), false, String(v));
});

test('the send window ends at the LATEST local today across the zones', () => {
  // 03:30 UTC on Oct 9 is still Oct 8 in New York.
  assert.deepStrictEqual(doorsWindow(['America/New_York'], 7, new Date('2026-10-09T03:30:00Z')), {
    startDate: '2026-10-02',
    endDate: '2026-10-08',
  });
  // 05:00 UTC: New York is on Oct 9, Honolulu still on Oct 8 — the window reaches Oct 9.
  const w = doorsWindow(['Pacific/Honolulu', 'America/New_York'], 120, new Date('2026-10-09T05:00:00Z'));
  assert.strictEqual(w.endDate, '2026-10-09');
  assert.strictEqual(daysIn(w.startDate, w.endDate), 120);
});

test('people per request are sized by person-days: 500 at 7 days, 41 at 120', () => {
  assert.strictEqual(peoplePerRequest(7), 500);
  assert.strictEqual(peoplePerRequest(120), 41);
  assert.strictEqual(peoplePerRequest(1), 500);
  assert.strictEqual(peoplePerRequest(10_000), 1, 'never zero people');
});

test('planDoorRequests: chunked, sorted, exact body keys, a day only when there was activity', () => {
  const endDate = '2026-10-09';
  const startDate = addDays(endDate, -119);
  const people = Array.from({ length: 100 }, (_, i) => pid(i + 1));
  const cells = new Map();
  cells.set(`${people[0]}|${endDate}`, 12);
  cells.set(`${people[0]}|${startDate}`, 0); // a Restricted-only day travels as 0
  cells.set(`${people[99]}|${addDays(endDate, -3)}`, 2000); // the cap itself is fine
  cells.set(`${people[50]}|${addDays(endDate, -1)}`, 2001); // one over: left out, reported
  const { requests, overCap } = planDoorRequests({ startDate, endDate, cells }, [
    { windowDays: 120, startDate, endDate, personIds: [...people].reverse() },
    { windowDays: 7, startDate: addDays(endDate, -6), endDate, personIds: [] }, // nobody → no request
  ]);
  assert.deepStrictEqual(requests.map((r) => r.personIds.length), [41, 41, 18]);
  assert.deepStrictEqual(requests[0].personIds, [...people].sort().slice(0, 41), 'people sorted');
  for (const r of requests) {
    assert.deepStrictEqual(Object.keys(r.body).sort(), ['counts', 'endDate', 'startDate', 'userIds']);
    assert.ok(!('restoreTyped' in r.body), 'a window-replace send never carries the explicit-clear flag');
    for (const c of r.body.counts) assert.deepStrictEqual(Object.keys(c).sort(), ['date', 'doors', 'userId']);
  }
  const first = requests.find((r) => r.personIds.includes(people[0])).body.counts.filter((c) => c.userId === people[0]);
  assert.deepStrictEqual(first, [
    { userId: people[0], date: startDate, doors: 0 },
    { userId: people[0], date: endDate, doors: 12 },
  ]);
  const all = requests.flatMap((r) => r.body.counts);
  assert.strictEqual(all.length, 3, 'no activity → no count, never a zero');
  assert.ok(all.some((c) => c.doors === 2000));
  assert.deepStrictEqual(overCap, [{ fbtimePersonId: people[50], date: addDays(endDate, -1), knocks: 2001 }]);
});

test('planDoorRequests refuses a window the count does not cover', () => {
  const count = { startDate: '2026-10-03', endDate: '2026-10-09', cells: new Map() };
  assert.throws(
    () => planDoorRequests(count, [{ windowDays: 120, startDate: '2026-06-12', endDate: '2026-10-09', personIds: [pid(1)] }]),
    /outside the count/
  );
});

test('1,200 people at 7 days: three requests of at most 500', () => {
  const people = Array.from({ length: 1200 }, (_, i) => pid(i + 1));
  const { requests } = planDoorRequests({ startDate: '2026-10-03', endDate: '2026-10-09', cells: new Map() }, [
    { windowDays: 7, startDate: '2026-10-03', endDate: '2026-10-09', personIds: people },
  ]);
  assert.deepStrictEqual(requests.map((r) => r.personIds.length), [500, 500, 200]);
  assert.ok(requests.every((r) => r.body.counts.length === 0), 'a listed person with no days still clears their window');
});

test('clear slices: from the first day sent (never past the 729-day floor) to tomorrow UTC, ≤ 120 days each', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  assert.deepStrictEqual(clearSlices(null, now), [], 'nothing ever sent: nothing to clear');
  assert.deepStrictEqual(clearSlices('2026-10-01', now), [{ startDate: '2026-10-01', endDate: '2026-10-10' }]);

  const long = clearSlices(addDays('2026-10-09', -300), now);
  assert.strictEqual(long.length, 3);
  assert.strictEqual(long[0].startDate, addDays('2026-10-09', -300));
  assert.strictEqual(long.at(-1).endDate, '2026-10-10', 'through tomorrow UTC');
  for (let i = 0; i < long.length; i++) {
    assert.ok(daysIn(long[i].startDate, long[i].endDate) <= 120);
    if (i) assert.strictEqual(long[i].startDate, addDays(long[i - 1].endDate, 1), 'contiguous');
  }

  const floor = clearSlices('2020-01-01', now);
  assert.strictEqual(floor[0].startDate, addDays('2026-10-09', -CLEAR_FLOOR_DAYS), 'clamped inside FbTime’s 2-year limit');
  assert.deepStrictEqual(clearSlices('2026-10-12', now), [], 'an empty range is done');
});

test('clear groups rotate, so one failing group cannot starve the rest', () => {
  const people = Array.from({ length: 100 }, (_, i) => pid(i + 1));
  const g0 = clearGroups(people, 0);
  assert.deepStrictEqual(g0.map((g) => g.length), [41, 41, 18]);
  assert.deepStrictEqual(clearGroups(people, 1)[0], g0[1]);
  assert.deepStrictEqual(clearGroups(people, 3), g0, 'rotation wraps');
  assert.deepStrictEqual(clearGroups([pid(1)], 7), [[pid(1)]]);
});

test('first passes, due clears and waiting clears', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const future = new Date('2026-10-09T12:10:00Z');
  const past = new Date('2026-10-09T11:50:00Z');
  assert.strictEqual(firstPassWaiting({ clearPersons: [{ fbtimePersonId: pid(1), confirmAfter: null }] }), true);
  assert.strictEqual(firstPassWaiting({ clearPersons: [{ fbtimePersonId: pid(1), confirmAfter: future }] }), false);
  assert.strictEqual(clearsDue({ clearPersons: [{ fbtimePersonId: pid(1), confirmAfter: future }] }, now), false);
  assert.strictEqual(clearsDue({ clearPersons: [{ fbtimePersonId: pid(1), confirmAfter: past }] }, now), true);
  assert.strictEqual(firstPassWaiting({ clearAll: true }), true);
  assert.strictEqual(firstPassWaiting({ clearAll: true, clearAllConfirmAfter: future }), false);
  assert.strictEqual(clearsDue({ clearAll: true, clearAllConfirmAfter: future }, now), false);
  assert.strictEqual(clearsWaiting({ clearAll: true, clearAllConfirmAfter: future }), true);
  assert.strictEqual(clearsWaiting({}), false);
});

// ── The status model (§H) ──────────────────────────────────────────────────────
const T0 = new Date('2026-10-09T10:00:00Z');
const T1 = new Date('2026-10-09T10:05:00Z');
const live = (doors = {}, rest = {}) => ({
  status: 'connected',
  keyScopes: ['timesheets:read', 'roster:read', 'doors:write'],
  fbtimeFeatures: ['doors:reported-wins'],
  doors: { enabled: true, enabledAt: T0, lastSentAt: T1, lastResult: [{ windowDays: 7, people: 3 }], ...doors },
  ...rest,
});
const on = { available: true };

test('status: sending, and starting until the first send since the latest turn-on', () => {
  assert.strictEqual(doorsStatus(live(), on).state, 'sending');
  assert.strictEqual(doorsStatus(live({ lastSentAt: null }), on).state, 'starting');
  const restarted = doorsStatus(live({ enabledAt: T1, lastSentAt: T0 }), on);
  assert.strictEqual(restarted.state, 'starting', 'an off/on cycle starts over');
  assert.deepStrictEqual(restarted.lastResult, [], 'results from before the turn-on are hidden');
});

test('status: paused — connection, then doorline, then fbtime-outdated', () => {
  const s1 = doorsStatus(live({}, { status: 'errored' }), { ...on, otherReporter: true });
  assert.deepStrictEqual([s1.state, s1.reason], ['paused', 'connection'], 'paused outranks attention');
  const s2 = doorsStatus(live(), { available: false });
  assert.deepStrictEqual([s2.state, s2.reason], ['paused', 'doorline']);
  const s3 = doorsStatus(live({}, { fbtimeFeatures: ['doors:keep-typed'] }), on);
  assert.deepStrictEqual([s3.state, s3.reason], ['paused', 'fbtime-outdated'], '8c52b5d alone is refused');
  assert.strictEqual(doorsStatus(live({}, { fbtimeFeatures: undefined }), on).state, 'sending', 'unknown is not outdated');
});

test('status: attention — conflict, needs-permission, timezone, refused, stuck (in that order)', () => {
  const pick = (conn, extras = on) => {
    const s = doorsStatus(conn, extras);
    return [s.state, s.reason];
  };
  assert.deepStrictEqual(pick(live(), { ...on, otherReporter: true }), ['attention', 'conflict']);
  assert.deepStrictEqual(pick(live({}, { keyScopes: ['timesheets:read'] })), ['attention', 'needs-permission']);
  assert.deepStrictEqual(pick(live({ failCode: 'INVALID_TIMEZONE' })), ['attention', 'timezone']);
  assert.deepStrictEqual(pick(live({ failCode: 'VALIDATION', failPhase: 'send' })), ['attention', 'refused']);
  assert.deepStrictEqual(pick(live({ failCode: 'STUCK' })), ['attention', 'stuck']);
  assert.deepStrictEqual(pick(live({ failCode: 'SCOPE_REQUIRED' })), ['sending', null], 'a Doorline code is not "refused"');
  assert.deepStrictEqual(
    pick(live({ failCode: 'VALIDATION' }, { keyScopes: ['timesheets:read'] }), { ...on, otherReporter: true }),
    ['attention', 'conflict']
  );
});

test('status: off, with its hint, and clearing whether on or off', () => {
  const off = (doors = {}, rest = {}) => live({ enabled: false, ...doors }, rest);
  assert.deepStrictEqual([doorsStatus(off({ enabledAt: null }), on).state, doorsStatus(off({ enabledAt: null }), on).reason], ['off', null]);
  assert.strictEqual(doorsStatus(off({}, { keyScopes: ['timesheets:read'] }), on).reason, 'hours-only-key');
  assert.strictEqual(doorsStatus(off(), on).reason, 'revoke-door-key', 'once on, a live door-count key keeps days locked');
  assert.strictEqual(doorsStatus(off(), { ...on, otherReporter: true }).reason, 'conflict');

  const waitingOff = off({ clearAll: true, reported: [pid(1)] });
  assert.strictEqual(doorsStatus(waitingOff, on).state, 'clearing');
  const blocked = doorsStatus(waitingOff, { available: false });
  assert.strictEqual(blocked.state, 'off', 'a waiting clear that cannot run is a notice, not a state');
  assert.strictEqual(blocked.pendingClears.blockedBy, 'unavailable');
  assert.strictEqual(blocked.pendingClears.all, true);

  const person = live({ clearPersons: [{ fbtimePersonId: pid(2), fromUserId: null, confirmAfter: null }] });
  assert.strictEqual(doorsStatus(person, on).state, 'clearing');
  assert.strictEqual(doorsStatus(person, { ...on, names: new Map([[pid(2), { name: 'Maria D' }]]) }).pendingClears.persons[0].name, 'Maria D');
});

test('status: a refusal blocks a waiting clear only when it was the clear that was refused', () => {
  const doors = { enabled: false, clearAll: true, reported: [pid(1)], failCode: 'VALIDATION' };
  assert.strictEqual(doorsStatus(live({ ...doors, failPhase: 'send' }), on).pendingClears.blockedBy, null);
  assert.strictEqual(doorsStatus(live({ ...doors, failPhase: 'clear' }), on).pendingClears.blockedBy, 'refused');
  assert.strictEqual(doorsStatus(live({ ...doors, failCode: 'STUCK' }), on).pendingClears.blockedBy, 'stuck');
});

test('status: notices — over-cap (five shown, all counted), unknown people, typed numbers replaced', () => {
  const overCap = Array.from({ length: 7 }, (_, i) => ({ fbtimePersonId: pid(1), date: `2026-10-0${i + 1}`, knocks: 2100 + i }));
  const s = doorsStatus(live({ overCap, unknownPersonIds: [pid(9)], replacedTyped: 29, reported: [pid(1)] }), {
    ...on,
    names: new Map([[pid(1), { name: 'Ann Lee' }], [pid(9), { fbtimeName: 'Gone G' }]]),
    canClearAll: true,
    enabledByName: 'Ada Admin',
  });
  assert.strictEqual(s.overCap.length, 5);
  assert.strictEqual(s.overCapCount, 7);
  assert.strictEqual(s.overCap[0].name, 'Ann Lee');
  assert.deepStrictEqual(s.unknownPeople, [{ fbtimePersonId: pid(9), name: 'Gone G' }]);
  assert.strictEqual(s.replacedTyped, 29);
  assert.strictEqual(s.everSent, true);
  assert.strictEqual(s.canClearAll, true);
  assert.deepStrictEqual(s.enabledBy, { name: 'Ada Admin' });
  const before = doorsStatus(live({ lastSentAt: T0, enabledAt: T1, unknownPersonIds: [pid(9)] }), on);
  assert.deepStrictEqual(before.unknownPeople, [], 'only since the latest turn-on');
});

// ── Whose hours is this shift? ────────────────────────────────────────────────
test('shift owner: no kept entry is exactly the old rule — the current link, or nobody', () => {
  assert.strictEqual(shiftOwnerOf(undefined, 'Y', new Date()), 'Y');
  assert.strictEqual(shiftOwnerOf([], null, new Date()), null);
});

test('shift owner: the kept entry with the smallest `until` later than clockIn owns it', () => {
  const d1 = new Date('2026-03-01T00:00:00Z');
  const d2 = new Date('2026-06-01T00:00:00Z');
  const kept = [
    { userId: 'Y_OLDER_UNTIL_LATER', until: d2 },
    { userId: 'X', until: d1 },
  ];
  assert.strictEqual(shiftOwnerOf(kept, 'Z', new Date('2026-02-01T00:00:00Z')), 'X');
  assert.strictEqual(shiftOwnerOf(kept, 'Z', d1), 'Y_OLDER_UNTIL_LATER', 'until is exclusive');
  assert.strictEqual(shiftOwnerOf(kept, 'Z', new Date('2026-05-31T23:59:59Z')), 'Y_OLDER_UNTIL_LATER');
  assert.strictEqual(shiftOwnerOf(kept, 'Z', d2), 'Z');
  assert.strictEqual(shiftOwnerOf(kept, null, new Date('2026-07-01T00:00:00Z')), null);
});

test('person ids: lower-cased 24-hex or nothing; zones from the curated list only', () => {
  assert.strictEqual(normPersonId('AAAAAAAAAAAAAAAAAAAAAAA1'), 'aaaaaaaaaaaaaaaaaaaaaaa1');
  assert.strictEqual(normPersonId(' aaaaaaaaaaaaaaaaaaaaaaa1 '), 'aaaaaaaaaaaaaaaaaaaaaaa1');
  assert.strictEqual(normPersonId('not-hex'), null);
  assert.strictEqual(normPersonId(null), null);
  assert.strictEqual(isCuratedZone('America/Chicago'), true);
  for (const z of ['us/eastern', 'america/chicago', 'UTC', 'Europe/London']) assert.strictEqual(isCuratedZone(z), false, z);
});

test('account signatures change when a person’s set of accounts does', () => {
  const a = accountSignatures([
    { userId: 'u1', fbtimePersonId: pid(1) },
    { userId: 'u0', fbtimePersonId: pid(1), until: new Date('2026-01-01T00:00:00Z') },
  ]);
  const b = accountSignatures([
    { userId: 'u0', fbtimePersonId: pid(1), until: new Date('2026-01-01T00:00:00Z') },
    { userId: 'u1', fbtimePersonId: pid(1) },
  ]);
  assert.strictEqual(a.get(pid(1)), b.get(pid(1)), 'order-independent');
  const c = accountSignatures([{ userId: 'u1', fbtimePersonId: pid(1) }]);
  assert.notStrictEqual(a.get(pid(1)), c.get(pid(1)));
});
