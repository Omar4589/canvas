import { test } from 'node:test';
import assert from 'node:assert';
import { parseSince } from '../src/utils/sinceArg.js';

// The read-only checks' `--since=` (utils/sinceArg.js): strict, never the machine's own zone.

const NOW = new Date('2026-11-02T03:00:00Z'); // Sunday Nov 1, 9 pm Central standard time

test('a bare date is 00:00 UTC that day', () => {
  const r = parseSince('2026-10-01', NOW);
  assert.strictEqual(r.at.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.match(r.label, /read as 00:00 UTC/);
});

test('a time with its offset', () => {
  assert.strictEqual(parseSince('2026-11-01T00:00-06:00', NOW).at.toISOString(), '2026-11-01T06:00:00.000Z');
  assert.strictEqual(parseSince('2026-10-31T19:00-05:00', NOW).at.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(parseSince('2026-10-31T23:59:30Z', NOW).at.toISOString(), '2026-10-31T23:59:30.000Z');
});

test('refused: impossible dates and offsets, the future, and a time with no offset', () => {
  assert.match(parseSince('2026-02-30', NOW).error, /not a real date/);
  assert.match(parseSince('2026-10-01T24:00-06:00', NOW).error, /not a real date/);
  assert.match(parseSince('2026-10-01T10:00+15:00', NOW).error, /impossible UTC offset/);
  assert.match(parseSince('2026-11-03', NOW).error, /in the future/);
  assert.match(parseSince('yesterday', NOW).error, /is not a date/);
  assert.match(parseSince('2026-10-13T23:45', NOW).error, /no UTC offset/);
});

test('the "add an offset" example names Central\'s offset on that date', () => {
  assert.match(parseSince('2026-10-13T23:45', new Date('2026-10-20T12:00:00Z')).error, /2026-10-13T23:45-05:00 \(Central daylight time\)/);
  assert.match(parseSince('2026-10-13T23:45', NOW).error, /2026-10-13T23:45-06:00 \(Central standard time\)/);
});
