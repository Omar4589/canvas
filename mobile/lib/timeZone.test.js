import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { safeTimeZone, _resetTimeZoneCache } from './timeZone.js';
import { todayInTz } from './dateRanges.js';
import { formatInTz, formatExact, formatRange } from './datetime.js';

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

beforeEach(() => _resetTimeZoneCache());

// Node and Hermes word the RangeError differently, so these tests check the fallback, never the text.
test('a known zone is kept', () => {
  assert.equal(safeTimeZone('America/Chicago'), 'America/Chicago');
});

test('an unknown zone falls back to the phone\'s own zone and warns once', () => {
  const original = console.warn;
  let warnings = 0;
  console.warn = () => {
    warnings += 1;
  };
  try {
    assert.equal(safeTimeZone('Mars/Olympus_Mons'), deviceZone);
    assert.equal(safeTimeZone('Mars/Olympus_Mons'), deviceZone);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings, 1);
});

test('empty input passes through for each caller\'s own no-zone behavior', () => {
  assert.equal(safeTimeZone(undefined), undefined);
  assert.equal(safeTimeZone(''), '');
  assert.equal(safeTimeZone(null), null);
});

test('the campaign-zone formatters no longer throw on an unknown zone', () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const bad = 'Not/A_Zone';
    assert.match(todayInTz(bad), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(formatInTz('2026-10-15T15:00:00Z', bad).length > 0);
    assert.ok(formatExact('2026-10-15T15:00:00Z', bad).length > 0);
    assert.ok(formatRange('2026-10-15T15:00:00Z', '2026-10-15T16:00:00Z', bad).length > 0);
  } finally {
    console.warn = original;
  }
});
