import { test } from 'node:test';
import assert from 'node:assert';

// The merge + aggregate rules in services/reports/hoursSource.js — pure units,
// fixtures hand-computed against the provider contract's own worked example
// (a 6h shift with one 45-minute break: gross 6.00, adjusted 5.50, worked 5.25).
//   node --test test/hoursSourceFold.test.js
const { foldUserHours, aggregateSource, usableMeasuredDay, staleDay, spanHours, unionDayAllowed } = await import(
  '../src/services/reports/hoursSource.js'
);

// `today` deliberately DEFAULTS TO ABSENT: most fixtures predate the stale
// narrowing, and absent-today = the old broad behavior, which those tests pin.
const measuredWith = (entries, { enabled = true, hourFigure = 'adjustedHours', today } = {}) => {
  const byUserDay = new Map();
  const daysByUser = new Map();
  for (const [uid, day, row] of entries) {
    byUserDay.set(`${uid}|${day}`, row);
    if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
    daysByUser.get(uid).add(day);
  }
  return { enabled, hourFigure, byUserDay, daysByUser, today };
};

const noFlags = { isOpen: false, isStale: false, isManualEntry: false };

test('no connection: every day estimated, exactly the old span sums', () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 3.5 },
      { day: '2026-08-11', spanHours: 4.25 },
    ],
    measured: { enabled: false, byUserDay: new Map(), daysByUser: new Map() },
  });
  assert.strictEqual(fold.hoursOnDoors, 7.75);
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(fold.measuredDays, 0);
});

test('a fully measured range uses measured hours and says so', () => {
  // The contract's 6h/45m-break shift: adjusted 5.50 where the span read 4.9.
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 5.5, ...noFlags }],
    ['u1', '2026-08-11', { hours: 8.0, ...noFlags }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 4.9 },
      { day: '2026-08-11', spanHours: 7.1 },
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 13.5);
  assert.strictEqual(fold.hoursSource, 'measured');
  assert.strictEqual(fold.estimatedDays, 0);
});

test('a partially measured range is mixed: measured days measured, the rest span', () => {
  const measured = measuredWith([['u1', '2026-08-10', { hours: 5.5, ...noFlags }]]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 4.9 },
      { day: '2026-08-11', spanHours: 3.0 }, // no measured row → span
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 8.5);
  assert.strictEqual(fold.hoursSource, 'mixed');
  assert.strictEqual(fold.measuredDays, 1);
  assert.strictEqual(fold.estimatedDays, 1);
});

test('a measured day with NO knocks still adds hours — clocked-but-not-knocking lowers the rate', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 5.0, ...noFlags }],
    ['u1', '2026-08-12', { hours: 4.0, ...noFlags }], // clocked, zero knocks
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.0 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 9.0);
  assert.strictEqual(fold.extraMeasuredDays, 1);
  assert.strictEqual(fold.hoursSource, 'measured');
});

test('a STALE measured day (forgotten clock-out) falls back to the span and keeps its flag', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 31.2, isOpen: true, isStale: true, isManualEntry: false }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.0 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 4.0, 'the 31-hour ghost shift must not poison the denominator');
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(fold.hasStaleShift, true);
});

test('zero measured hours reads as ABSENT, never as a zero denominator', () => {
  const measured = measuredWith([['u1', '2026-08-10', { hours: 0, ...noFlags }]]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 2.5 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 2.5);
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(usableMeasuredDay({ hours: 0, isStale: false }), false);
});

test('open and manual-entry days count as measured, flags rolled up', () => {
  const measured = measuredWith([
    ['u1', '2026-08-10', { hours: 3.0, isOpen: true, isStale: false, isManualEntry: false }],
    ['u1', '2026-08-11', { hours: 6.0, isOpen: false, isStale: false, isManualEntry: true }],
  ]);
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 2.0 },
      { day: '2026-08-11', spanHours: 5.0 },
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 9.0);
  assert.strictEqual(fold.hasOpenShift, true);
  assert.strictEqual(fold.hasManualEntry, true);
  assert.strictEqual(fold.hoursSource, 'measured');
});

test('the hourFigure setting picks which wire figure a row contributes', () => {
  // Same row, read under workedHours instead of adjustedHours: 5.25 not 5.50.
  // (loadMeasuredHours resolves the figure into `hours`; the fold is agnostic —
  // this pins the seam's shape: one number per row, chosen upstream.)
  const asWorked = measuredWith([['u1', '2026-08-10', { hours: 5.25, ...noFlags }]], {
    hourFigure: 'workedHours',
  });
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.9 }],
    measured: asWorked,
  });
  assert.strictEqual(fold.hoursOnDoors, 5.25);
});

test('AGGREGATE ALL-OR-NOTHING: one non-measured contributor makes the aggregate estimated', () => {
  const m = (source) => ({ hoursSource: source });
  assert.strictEqual(aggregateSource([m('measured'), m('measured')]), 'measured');
  assert.strictEqual(aggregateSource([m('measured'), m('mixed')]), 'estimated');
  assert.strictEqual(aggregateSource([m('measured'), m('estimated')]), 'estimated');
  assert.strictEqual(aggregateSource([]), 'estimated', 'nobody measured is not "measured"');
});

test('spanHours guards nulls and inverted ranges', () => {
  assert.strictEqual(spanHours(null, null), 0);
  const t = Date.now();
  assert.strictEqual(spanHours(new Date(t), new Date(t - 1000)), 0);
  assert.strictEqual(spanHours(new Date(t), new Date(t + 3600000)), 1);
});

// ── hoursReason: WHICH kind of "estimated" ──────────────────────────────────
// A missing measured-hours marker has four meanings and three of them are
// somebody's to fix. These pin the precedence so the UI can name the cause
// instead of showing an absence.

const linkedWith = (entries, userIds, opts) => ({
  ...measuredWith(entries, opts),
  linkedUserIds: new Set(userIds),
});

test('hoursReason is null when the range is fully measured — nothing to explain', () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.9 }],
    measured: linkedWith([['u1', '2026-08-10', { hours: 5.5, ...noFlags }]], ['u1']),
  });
  assert.strictEqual(fold.hoursSource, 'measured');
  assert.strictEqual(fold.hoursReason, null);
});

test("hoursReason 'not-connected' when the org has no live connection", () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 3.5 }],
    measured: { enabled: false, byUserDay: new Map(), daysByUser: new Map(), linkedUserIds: new Set() },
  });
  assert.strictEqual(fold.hoursReason, 'not-connected');
});

test("hoursReason 'not-linked' outranks everything else — unlinked people have no rows to be stale", () => {
  const fold = foldUserHours({
    userId: 'u2', // connected org, but u2 was never mapped to an FbTime person
    perDayRows: [{ day: '2026-08-10', spanHours: 3.5 }],
    measured: linkedWith([['u1', '2026-08-10', { hours: 5.5, ...noFlags }]], ['u1']),
  });
  assert.strictEqual(fold.hoursSource, 'estimated');
  assert.strictEqual(fold.hoursReason, 'not-linked');
});

test("hoursReason 'stale-shift' when a linked person's day fell back on a missed clock-out", () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 4.0 }],
    measured: linkedWith(
      [['u1', '2026-08-10', { hours: 31.2, isOpen: true, isStale: true, isManualEntry: false }]],
      ['u1']
    ),
  });
  assert.strictEqual(fold.hoursReason, 'stale-shift');
  assert.strictEqual(fold.hoursOnDoors, 4.0);
});

test("hoursReason 'no-hours' when a linked person simply did not clock in", () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 3.5 }],
    measured: linkedWith([], ['u1']),
  });
  assert.strictEqual(fold.hoursReason, 'no-hours');
});

test('a MIXED row still reports why its estimated half is estimated', () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-10', spanHours: 4.9 },
      { day: '2026-08-11', spanHours: 3.0 }, // no row → span
    ],
    measured: linkedWith([['u1', '2026-08-10', { hours: 5.5, ...noFlags }]], ['u1']),
  });
  assert.strictEqual(fold.hoursSource, 'mixed');
  assert.strictEqual(fold.hoursReason, 'no-hours');
});

test('a caller that supplies no link set never accuses the mapping of being missing', () => {
  // measuredWith() has no linkedUserIds at all — the pre-existing fixture shape.
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-10', spanHours: 3.5 }],
    measured: measuredWith([]),
  });
  assert.strictEqual(fold.hoursReason, 'no-hours', "must not claim 'not-linked' without having looked");
});

// ── staleness only reaches backward ─────────────────────────────────────────
// loadMeasuredHours now derives isStale exactly (an open shift on a day before
// today), so overlay-built entries are never flagged broad. staleDay stays as
// the guard for hand-built overlays like these — a flag with no calendar keeps
// the conservative broad reading, and only a day strictly before `today` can
// ever be stale. The runaway shift's own day still falls back.

test("TODAY's open shift is not stale — an old runaway shift must not poison today", () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-08-14', spanHours: 3.0 }],
    measured: measuredWith(
      [['u1', '2026-08-14', { hours: 4.5, isOpen: true, isStale: true, isManualEntry: false }]],
      { today: '2026-08-14' }
    ),
  });
  assert.strictEqual(fold.hoursOnDoors, 4.5, "today's clock time counts");
  assert.strictEqual(fold.hoursSource, 'measured');
  assert.strictEqual(fold.hoursReason, null);
  assert.strictEqual(fold.hasOpenShift, true, 'still labeled as running');
  assert.strictEqual(fold.hasStaleShift, false, 'today cannot be the forgotten clock-out');
});

test('the runaway shift\'s OWN day still falls back — narrowing must not resurrect the ghost', () => {
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-08-12', spanHours: 4.0 }, // the forgotten clock-out's day
      { day: '2026-08-14', spanHours: 3.0 }, // today, healthy open shift
    ],
    measured: measuredWith(
      [
        ['u1', '2026-08-12', { hours: 31.2, isOpen: true, isStale: true, isManualEntry: false }],
        ['u1', '2026-08-14', { hours: 4.5, isOpen: true, isStale: true, isManualEntry: false }],
      ],
      { today: '2026-08-14' }
    ),
  });
  assert.strictEqual(fold.hoursOnDoors, 8.5, 'span 4.0 for the ghost day + measured 4.5 today');
  assert.strictEqual(fold.hoursSource, 'mixed');
  assert.strictEqual(fold.hoursReason, 'stale-shift', 'the estimated half is estimated BECAUSE of the ghost');
  assert.strictEqual(fold.hasStaleShift, true, 'the ghost day keeps its flag');
});

test('midnight boundary: yesterday stale, today exempt — nothing else', () => {
  const stale = { hours: 9.9, isOpen: true, isStale: true, isManualEntry: false };
  assert.strictEqual(usableMeasuredDay(stale, '2026-08-13', '2026-08-14'), false, 'yesterday');
  assert.strictEqual(usableMeasuredDay(stale, '2026-08-14', '2026-08-14'), true, 'today');
});

test('no `today` on the overlay keeps the old broad behavior', () => {
  // The pre-narrowing stale test above ("a STALE measured day...") is the real
  // guard; this pins the helper directly so the fallback is named, not implied.
  const stale = { hours: 5, isStale: true };
  assert.strictEqual(usableMeasuredDay(stale, '2026-08-14', undefined), false);
  assert.strictEqual(usableMeasuredDay(stale, undefined, '2026-08-14'), false, 'no day → broad too');
});

test('staleDay truth table', () => {
  const s = { isStale: true };
  const clean = { isStale: false };
  assert.strictEqual(staleDay(s, '2026-08-13', '2026-08-14'), true, 'past + stale');
  assert.strictEqual(staleDay(s, '2026-08-14', '2026-08-14'), false, 'today + stale');
  assert.strictEqual(staleDay(s, '2026-08-13', undefined), true, 'no calendar → broad');
  assert.strictEqual(staleDay(s, undefined, '2026-08-14'), true, 'no day → broad');
  assert.strictEqual(staleDay(clean, '2026-08-13', '2026-08-14'), false, 'never invents staleness');
  assert.strictEqual(staleDay(null, '2026-08-13', '2026-08-14'), false, 'absent row');
});

// ── campaign-scoped attribution ─────────────────────────────────────────────
// The union rule's campaign edition (owner-ruled 2026-08-16, NEVER by FbTime
// location): a clocked-but-no-knocks-here day charges the scoped campaign only
// inside the canvasser's knock stint there, and never on a day the ledger
// shows knocks on another campaign. Knock-days here always count.

const scopedWith = (entries, { stint = null, anyKnockDays = [] } = {}) => ({
  ...measuredWith(entries),
  campaignScoped: true,
  stintByUser: new Map(stint ? [['u1', stint]] : []),
  anyKnockDaysByUser: new Map([['u1', new Set(anyKnockDays)]]),
});

test('unionDayAllowed truth table', () => {
  const stint = { first: '2026-07-20', last: '2026-07-23' };
  const scoped = scopedWith([], { stint, anyKnockDays: ['2026-07-21'] });
  assert.strictEqual(unionDayAllowed({ campaignScoped: false }, 'u1', '2026-07-21'), true, 'unscoped: everything counts');
  assert.strictEqual(unionDayAllowed(scoped, 'u1', '2026-07-22'), true, 'idle day inside stint');
  assert.strictEqual(unionDayAllowed(scoped, 'u1', '2026-07-21'), false, 'knocked another campaign that day');
  assert.strictEqual(unionDayAllowed(scoped, 'u1', '2026-07-15'), false, 'before first knock here');
  assert.strictEqual(unionDayAllowed(scoped, 'u1', '2026-07-30'), false, 'after last knock here');
  assert.strictEqual(unionDayAllowed(scoped, 'u1', '2026-07-20'), true, 'stint bounds are inclusive');
  assert.strictEqual(unionDayAllowed(scoped, 'u2', '2026-07-22'), false, 'no stint = never knocked here = nothing to charge');
});

test('the Denny case: another project’s clocked days stop inflating this campaign’s denominator', () => {
  // Knocked here 7/20 and 7/23 (measured 5h + 6h). Also clocked: 7/15 (other
  // project, pre-stint), 7/21 (knocked the OTHER campaign that day), 7/22
  // (idle — clocked, knocked nowhere). Only the idle day joins.
  const measured = scopedWith(
    [
      ['u1', '2026-07-15', { hours: 3.0, ...noFlags }],
      ['u1', '2026-07-20', { hours: 5.0, ...noFlags }],
      ['u1', '2026-07-21', { hours: 4.0, ...noFlags }],
      ['u1', '2026-07-22', { hours: 2.0, ...noFlags }],
      ['u1', '2026-07-23', { hours: 6.0, ...noFlags }],
    ],
    { stint: { first: '2026-07-20', last: '2026-07-23' }, anyKnockDays: ['2026-07-20', '2026-07-21', '2026-07-23'] }
  );
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [
      { day: '2026-07-20', spanHours: 4.0 },
      { day: '2026-07-23', spanHours: 5.0 },
    ],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 13.0, '5 + 6 knock-days + 2 idle — never the 3 pre-stint or the 4 knocked-elsewhere');
  assert.strictEqual(fold.hoursSource, 'measured');
  assert.strictEqual(fold.extraMeasuredDays, 1, 'only the idle day joined');
});

test('a knock-day here still measures even though it appears in anyKnockDays', () => {
  // anyKnockDays includes knocks on THIS campaign too — the first branch
  // (knocked here) must win before the elsewhere-check is ever consulted.
  const measured = scopedWith(
    [['u1', '2026-07-20', { hours: 5.0, ...noFlags }]],
    { stint: { first: '2026-07-20', last: '2026-07-20' }, anyKnockDays: ['2026-07-20'] }
  );
  const fold = foldUserHours({
    userId: 'u1',
    perDayRows: [{ day: '2026-07-20', spanHours: 4.0 }],
    measured,
  });
  assert.strictEqual(fold.hoursOnDoors, 5.0);
  assert.strictEqual(fold.hoursSource, 'measured');
});
