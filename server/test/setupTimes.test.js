import { test } from 'node:test';
import assert from 'node:assert';
import { summarizeImportTimes, formatDuration } from '../src/services/site/setupTimes.js';

// The import-timing report behind the homepage's "often the same day" (migrations/reportSetupTimes.js).
const t0 = new Date('2026-10-01T15:00:00Z');
const at = (min) => new Date(t0.getTime() + min * 60_000);

test('imports land in their size bucket, with the median and slowest wait and processing time', () => {
  const { total, buckets, largest } = summarizeImportTimes([
    { totalRows: 2_000, createdAt: t0, startedAt: at(0.5), completedAt: at(2) },
    { totalRows: 8_000, createdAt: t0, startedAt: at(1), completedAt: at(5) },
    { totalRows: 9_999, createdAt: t0, startedAt: at(1), completedAt: at(4) },
    { totalRows: 120_000, createdAt: t0, startedAt: at(3), completedAt: at(43) },
  ]);
  assert.strictEqual(total, 4);
  const small = buckets[0];
  assert.deepStrictEqual([small.label, small.count], ['Under 10,000 rows', 3], '9,999 rows is still under 10,000');
  assert.strictEqual(small.waitMedian, 4 * 60_000);
  assert.strictEqual(small.waitMax, 5 * 60_000);
  assert.strictEqual(small.runMedian, 3 * 60_000);
  assert.deepStrictEqual(buckets.map((b) => b.count), [3, 0, 0, 1]);
  assert.deepStrictEqual(largest, { rows: 120_000, wait: 43 * 60_000 });
});

test('an import missing a clock is skipped, and one with no start still counts its wait', () => {
  const { total, buckets } = summarizeImportTimes([
    { totalRows: 500, createdAt: t0, startedAt: null, completedAt: at(3) },
    { totalRows: 500, createdAt: t0, startedAt: at(1), completedAt: null },
    { totalRows: 500, createdAt: null, startedAt: at(1), completedAt: at(2) },
  ]);
  assert.strictEqual(total, 1);
  assert.strictEqual(buckets[0].waitMedian, 3 * 60_000);
  assert.strictEqual(buckets[0].runMedian, null);
});

test('durations read like a person would say them', () => {
  assert.strictEqual(formatDuration(42_000), '42 s');
  assert.strictEqual(formatDuration(6 * 60_000 + 20_000), '6 min');
  assert.strictEqual(formatDuration(72 * 60_000), '1 h 12 min');
  assert.strictEqual(formatDuration(null), '—');
});
