import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedDayStr, zonedTimeToUtc, zonedDayRange, tzAbbrev } from '../src/utils/timezone.js';

// The timezone helpers share one Intl.DateTimeFormat per pattern and zone (utils/timezone.js). On
// 2026-10-25 an automatic-pause preview built a new formatter for every row on every day of a 22-day
// range and took the web dyno past 4 GB. These pin that sharing changes no answer, that a zone Intl
// rejects is still refused on every call, and that repeated calls build at most one formatter.

const ZONES = ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Phoenix', 'Pacific/Honolulu', 'UTC'];
const freshDay = (instant, tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

test('the day of an instant is the same as a fresh formatter gives, across both clock changes', () => {
  // Every 37 minutes across the March and November 2026 changes, in zones with and without them.
  for (const [from, to] of [
    ['2026-03-07T00:00:00Z', '2026-03-10T00:00:00Z'],
    ['2026-10-31T00:00:00Z', '2026-11-03T00:00:00Z'],
  ]) {
    for (let t = Date.parse(from); t < Date.parse(to); t += 37 * 60 * 1000) {
      for (const tz of ZONES) assert.equal(zonedDayStr(new Date(t), tz), freshDay(new Date(t), tz), `${tz} at ${new Date(t).toISOString()}`);
    }
  }
  assert.equal(zonedDayStr('2026-10-22T06:30:00Z', 'America/Los_Angeles'), '2026-10-21', 'a string instant');
  assert.equal(zonedDayStr(Date.parse('2026-10-22T07:30:00Z'), 'America/Los_Angeles'), '2026-10-22', 'a number instant');
});

test('local midnight round-trips, and day windows still span exactly the local days', () => {
  for (const tz of ZONES) {
    for (const [y, m, d] of [[2026, 3, 8], [2026, 11, 1], [2026, 10, 22]]) {
      const midnight = zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
      assert.equal(zonedDayStr(midnight, tz), `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, `${tz} ${y}-${m}-${d}`);
      assert.equal(zonedDayStr(new Date(midnight.getTime() - 1), tz) < zonedDayStr(midnight, tz), true, 'the instant before is the day before');
    }
  }
  const r = zonedDayRange('2026-11-01', '2026-11-01', 'America/New_York');
  assert.equal(r.$lt - r.$gte, 25 * 3600 * 1000, 'the day the clocks go back is 25 hours long');
  assert.equal(tzAbbrev('America/Los_Angeles', new Date('2026-10-22T20:00:00Z')), 'PDT');
  assert.equal(tzAbbrev('America/Los_Angeles', new Date('2026-12-22T20:00:00Z')), 'PST');
});

test('a zone Intl rejects is refused on every call, never cached', () => {
  for (let i = 0; i < 3; i++) {
    assert.throws(() => zonedDayStr(new Date(), 'Not/AZone'), RangeError, `call ${i + 1}`);
    assert.throws(() => zonedTimeToUtc(2026, 10, 22, 0, 0, 0, 'Not/AZone'), RangeError);
    assert.equal(tzAbbrev('Not/AZone'), '', 'the label helper still answers empty');
  }
  assert.throws(() => zonedDayStr(new Date(), null), RangeError, 'null is not a zone, as before');
});

test('repeated calls in one zone build at most one formatter', () => {
  const Real = Intl.DateTimeFormat;
  let built = 0;
  Intl.DateTimeFormat = new Proxy(Real, {
    construct(target, args) {
      built += 1;
      return new target(...args);
    },
  });
  try {
    for (let i = 0; i < 5000; i++) {
      zonedDayStr(new Date(1760000000000 + i * 61000), 'America/Denver');
      zonedTimeToUtc(2026, 10, 1 + (i % 28), 0, 0, 0, 'America/Denver');
      tzAbbrev('America/Denver', new Date(1760000000000 + i * 61000));
    }
  } finally {
    Intl.DateTimeFormat = Real;
  }
  assert.ok(built <= 3, `built ${built} formatters for 15,000 calls (one per pattern at most)`);
});
