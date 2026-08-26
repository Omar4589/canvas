import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './datePresets.js';
// Cross-tree on purpose: this file exists to keep the WEB and MOBILE preset builders in step —
// docs/DATE_FILTERS.md claims a window means the same thing on a phone and on the console, and
// until 2026-08 that claim leaned on nothing but discipline. The import parses because Node
// >= 20.19 re-detects the typeless-package file as ESM (a MODULE_TYPELESS_PACKAGE_JSON warning
// is expected and harmless); do NOT "fix" the warning by adding `"type": "module"` to
// mobile/package.json — untested against Metro/Expo/EAS tooling.
import * as mobile from '../../../mobile/lib/dateRanges.js';

// A deliberately hostile timezone matrix: both US DST regimes, no-DST, a +14 outlier, a -11
// outlier, and Lord Howe's half-hour DST shift.
const TZS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
  'Australia/Lord_Howe',
];

test('the two preset arrays name the same presets in the same order', () => {
  assert.deepEqual(
    web.RANGE_PRESETS.map((p) => p.id),
    mobile.PRESETS.map((p) => p.key)
  );
  assert.deepEqual(
    web.RANGE_PRESETS.map((p) => p.label),
    mobile.PRESETS.map((p) => p.label)
  );
});

test('shiftDays is pure calendar math — DST, leap days and year edges included', () => {
  // Absolute fixtures, clock-independent: these fail on any real drift in either copy.
  const CASES = [
    ['2026-03-08', 1, '2026-03-09'], // US spring-forward day
    ['2026-11-01', 1, '2026-11-02'], // US fall-back day
    ['2024-02-28', 1, '2024-02-29'], // leap day in
    ['2024-02-29', 1, '2024-03-01'], // leap day out
    ['2026-01-01', -1, '2025-12-31'], // year boundary
    ['2026-08-31', 1, '2026-09-01'], // month boundary
    ['2026-08-25', -29, '2026-07-27'], // the 30d preset's arithmetic
  ];
  for (const [ymd, n, want] of CASES) {
    assert.equal(web.shiftDays(ymd, n), want, `web shiftDays(${ymd}, ${n})`);
    assert.equal(mobile.shiftDays(ymd, n), want, `mobile shiftDays(${ymd}, ${n})`);
  }
});

// The clock-dependent half. todayInTz reads new Date(), so a run that straddles midnight in the
// tested tz could produce a one-off mismatch between two calls — recompute once before failing,
// never assert a first-try mismatch straight into a red build.
const settled = (fn) => {
  const a = fn();
  const b = fn();
  return JSON.stringify(a) === JSON.stringify(b) ? a : fn();
};

test('every preset resolves to the same window on web and mobile, in every timezone', () => {
  for (const tz of TZS) {
    for (const { id } of web.RANGE_PRESETS) {
      if (id === 'custom') continue; // custom passes user input through; nothing to resolve
      const webRange = settled(() => web.rangeFor(id, null, tz));
      const mobileRange = settled(() => mobile.rangeFor(id, null, tz));
      assert.deepEqual(webRange, mobileRange, `${id} @ ${tz}`);
    }
  }
});

test('the custom picker quick chips agree too', () => {
  for (const tz of TZS) {
    for (const key of ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth']) {
      const webChip = settled(() => web.quickRangeFor(key, tz));
      const mobileChip = settled(() => mobile.quickRangeFor(key, tz));
      assert.deepEqual(webChip, mobileChip, `${key} @ ${tz}`);
    }
  }
});
