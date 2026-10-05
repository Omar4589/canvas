import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../models/SurveyResponseArchive.js';
import { UnknockRunChunk } from '../models/UnknockRunChunk.js';
import { HouseholdLocationChange } from '../models/HouseholdLocationChange.js';
import { Household } from '../models/Household.js';
import { farAssessment, buildPinFixMap } from '../services/audit/flagDetection.js';
import { FLAG_THRESHOLDS, SEVERITY_RANK } from '../services/audit/flagThresholds.js';

// Stored GPS stamps that the stamp rules in docs/PROPOSAL_GPS_UPGRADES.md §I refuse, store as unknown or
// judge differently today, or would refuse once off-Earth coordinates are refused too (W1-offEarth).
// READ-ONLY — this script never writes; the rules apply to new stamps only.
//
//   npm run audit:gps-stamps                                     # every stored row
//   npm run audit:gps-stamps -- --since=2026-10-13T23:45-05:00   # rows created at or after that instant
//   npm run audit:gps-stamps -- --since=2026-10-14               # a bare date is 00:00 UTC that day
//
// `--since` takes a full time with its UTC offset (Central daylight time is -05:00, -06:00 from
// 2026-11-01) or a bare date. A time without an offset is refused, because a late-evening US deploy is
// already the next day in UTC; so are a date that doesn't exist (2026-02-30, T24:00) and a time in the
// future. After a deploy, pass the deploy's finish time: the expected result is zero negative, zero
// and non-finite accuracies and zero non-finite coordinates on rows created since then.
//
// What it reports:
//   1. Per ledger (door results, survey responses, archived survey answers): accuracies that are
//      negative, exactly zero or not finite; coordinates that are not finite, finite but off the
//      Earth, or exactly (0, 0); on door results, replaced-entry snapshots with such an accuracy.
//      Zero accuracies are split by month and by the mock-location flag, so the owner sees who sends
//      them. Every count is printed against the rows scanned, so "0 of 0" can't read as clean.
//   2. What the read-side clamp changes (§I.2): farAssessment run twice on every door result whose
//      own or snapshot-nearest accuracy is negative (the only rows the clamp can change), once with
//      the arithmetic it replaced (a negative accuracy adds distance) and once as the server runs it
//      now, with the household's pin-fix entry, so the honest-correction and pin-downgrade paths
//      count too. Printed as the audit far reasons removed, the flags whose severity drops, the
//      change in the per-canvasser Far count and in "forgiven", and how many canvassers that touches.
//   3. Unknocked entries frozen for a revert (judged by the frozen rows' own dates) and GPS pin fixes.
//
// Counts only: no coordinate, name or id is ever printed. The predicates are unindexed, so each
// ledger costs one collection scan — run it late in the evening, when no crew is out.

// ── --since ───────────────────────────────────────────────────────────────────────────────────
const SINCE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;
const NO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

// Strict on purpose: Date.parse rolls 2026-02-30 forward to March and reads a time with no offset as
// the machine's local time (UTC on a Heroku dyno), and either mistake makes the post-deploy check
// count the wrong rows. Returns { at, label } or { error }.
const parseSince = (value, now = new Date()) => {
  if (NO_OFFSET.test(value)) {
    return { error: `--since=${value} has a time but no UTC offset. Add one, for example ${value.replace(' ', 'T')}-05:00 (Central daylight time).` };
  }
  const m = SINCE_SHAPE.exec(value);
  if (!m) return { error: `--since=${value} is not a date (YYYY-MM-DD) or a time with its offset (YYYY-MM-DDTHH:MM-05:00).` };
  const [, y, mo, d, hh = '00', mi = '00', ss = '00', frac = '0', tz = 'Z'] = m;
  const [Y, M, D, H, Mi, S] = [y, mo, d, hh, mi, ss].map(Number);
  const local = new Date(Date.UTC(Y, M - 1, D, H, Mi, S, Number(frac.padEnd(3, '0'))));
  const real =
    local.getUTCFullYear() === Y && local.getUTCMonth() === M - 1 && local.getUTCDate() === D &&
    local.getUTCHours() === H && local.getUTCMinutes() === Mi && local.getUTCSeconds() === S;
  if (!real) return { error: `--since=${value} is not a real date and time.` };
  let offsetMin = 0;
  if (tz !== 'Z') {
    const [oh, om] = tz.slice(1).split(':').map(Number);
    if (oh > 14 || om > 59) return { error: `--since=${value} has an impossible UTC offset.` };
    offsetMin = (tz[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const at = new Date(local.getTime() - offsetMin * 60000);
  if (at > now) return { error: `--since=${value} is in the future.` };
  const label = hh === '00' && !m[4]
    ? `${at.toISOString()} (the bare date ${value}, read as 00:00 UTC)`
    : `${at.toISOString()} (${y}-${mo}-${d} ${hh}:${mi}${m[6] ? `:${ss}` : ''} at ${tz === 'Z' ? 'UTC' : tz})`;
  return { at, label };
};

const args = process.argv.slice(2);
const unknown = args.filter((a) => !a.startsWith('--since='));
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: npm run audit:gps-stamps [-- --since=<YYYY-MM-DD | YYYY-MM-DDTHH:MM±HH:MM>]`);
  process.exit(1);
}
const sinceArg = args.find((a) => a.startsWith('--since='));
let since = null;
let sinceLabel = '';
if (sinceArg) {
  const parsed = parseSince(sinceArg.slice('--since='.length));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  since = parsed.at;
  sinceLabel = parsed.label;
}

// ── Predicates (aggregation expressions, so NaN and ±Infinity are compared, never cast away) ──
// MongoDB orders NaN below every number, so `x < 0` alone would count NaN as negative and
// `lat < -90` would count it as off the Earth: every range test below is guarded by `finite`.
const NON_FINITE = [Infinity, -Infinity, NaN];
const finite = (x) => ({ $and: [{ $isNumber: x }, { $not: [{ $in: [x, NON_FINITE] }] }] });
const negative = (x) => ({ $and: [finite(x), { $lt: [x, 0] }] });
const zero = (x) => ({ $and: [finite(x), { $eq: [x, 0] }] });
const nonFinite = (x) => ({ $and: [{ $isNumber: x }, { $in: [x, NON_FINITE] }] });
const unusableAcc = (x) => ({ $or: [negative(x), zero(x), nonFinite(x)] });
const coordNonFinite = (p) => ({ $or: [nonFinite(`${p}.lat`), nonFinite(`${p}.lng`)] });
const coordOffEarth = (p) => ({
  $or: [
    { $and: [finite(`${p}.lat`), { $or: [{ $gt: [`${p}.lat`, 90] }, { $lt: [`${p}.lat`, -90] }] }] },
    { $and: [finite(`${p}.lng`), { $or: [{ $gt: [`${p}.lng`, 180] }, { $lt: [`${p}.lng`, -180] }] }] },
  ],
});
const nullIsland = (p) => ({ $and: [{ $eq: [`${p}.lat`, 0] }, { $eq: [`${p}.lng`, 0] }] });
const count = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
const sinceMatch = (field = 'createdAt') => (since ? [{ $match: { [field]: { $gte: since } } }] : []);

// One scan per ledger: the totals and the zero-accuracy split ride one $facet.
const ledgerReport = async (Model, { snapshot = false } = {}) => {
  const acc = '$location.accuracy';
  const anomaly = [unusableAcc(acc), coordNonFinite('$location'), coordOffEarth('$location'), nullIsland('$location')];
  if (snapshot) anomaly.push(unusableAcc('$replaced.location.accuracy'), unusableAcc('$replaced.nearest.accuracy'));
  const [r] = await Model.aggregate([
    ...sinceMatch(),
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              scanned: { $sum: 1 },
              rows: count({ $or: anomaly }),
              accNegative: count(negative(acc)),
              accZero: count(zero(acc)),
              accNonFinite: count(nonFinite(acc)),
              coordNonFinite: count(coordNonFinite('$location')),
              coordOffEarth: count(coordOffEarth('$location')),
              nullIsland: count(nullIsland('$location')),
              ...(snapshot
                ? { snapshotAcc: count({ $or: [unusableAcc('$replaced.location.accuracy'), unusableAcc('$replaced.nearest.accuracy')] }) }
                : {}),
              first: { $min: { $cond: [{ $or: anomaly }, '$createdAt', null] } },
              last: { $max: { $cond: [{ $or: anomaly }, '$createdAt', null] } },
            },
          },
        ],
        zeros: [
          { $match: { $expr: zero(acc) } },
          {
            $group: {
              _id: { month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, mocked: { $eq: ['$location.mocked', true] } },
              n: { $sum: 1 },
            },
          },
          { $sort: { '_id.month': 1 } },
        ],
      },
    },
  ]);
  return { ...(r.totals[0] || { scanned: 0, rows: 0 }), zeros: r.zeros };
};

// ── What the clamp changes (§I.2) ─────────────────────────────────────────────────────────────
// The server computes effective = max(0, d − max(0, accuracy ?? 0)) at every far check
// (flagDetection.js effectiveMeters). Before the clamp it was max(0, d − (accuracy ?? 0)), so a
// negative accuracy added distance. Both verdicts come from the one farAssessment the audit page, the
// Far count and the map call: "before" passes it the replaced arithmetic, "after" is the default.
const preClampEffective = (meters, accuracy) => Math.max(0, meters - (accuracy ?? 0));
const rank = (fa) => (fa ? SEVERITY_RANK[fa.severity] || 0 : 0);
const isFar = (fa) => !!fa && (fa.severity === 'med' || fa.severity === 'high');
const forgiven = (fa) => !!fa?.detail?.pinDowngraded;

const clampReport = async () => {
  const T = FLAG_THRESHOLDS;
  // Same rows both callers read: desk (via: 'bulk') rows are invisible to the audit by design.
  // `$lt: 0` can also match NaN, which JS's `< 0` then drops: a NaN radius is never far either way.
  const cursor = CanvassActivity.find(
    {
      ...(since ? { createdAt: { $gte: since } } : {}),
      via: { $ne: 'bulk' },
      $or: [{ 'location.accuracy': { $lt: 0 } }, { 'replaced.nearest.accuracy': { $lt: 0 } }],
    },
    '_id userId householdId timestamp location distanceFromHouseMeters replaced'
  )
    .lean()
    .cursor();

  const out = { candidates: 0, farRemoved: 0, severityDrops: 0, kpiFarDelta: 0, kpiForgivenDelta: 0 };
  const touched = new Set();
  const settle = async (batch) => {
    const ids = [...new Set(batch.map((r) => String(r.householdId)))];
    const households = await Household.find({ _id: { $in: ids } }, 'location coordSource correctedAt correctedBy').lean();
    const pinFixMap = buildPinFixMap(households);
    for (const row of batch) {
      const fix = pinFixMap.get(String(row.householdId));
      const before = farAssessment(row, fix, T, preClampEffective);
      const after = farAssessment(row, fix, T);
      // The Far count's raw-distance prefilter (farKpi.js) assumes accuracy only ever subtracts; a
      // negative one broke that before the clamp, which is why the two numbers could disagree.
      const kpiCandidate = row.distanceFromHouseMeters != null && row.distanceFromHouseMeters > T.FAR_WARN_M;
      const kpiBefore = kpiCandidate ? before : null;
      const kpiAfter = kpiCandidate ? after : null;
      if (before && !after) out.farRemoved += 1;
      if (rank(after) < rank(before)) out.severityDrops += 1;
      out.kpiFarDelta += Number(isFar(kpiAfter)) - Number(isFar(kpiBefore));
      out.kpiForgivenDelta += Number(forgiven(kpiAfter)) - Number(forgiven(kpiBefore));
      const changed =
        rank(after) !== rank(before) || isFar(kpiAfter) !== isFar(kpiBefore) || forgiven(kpiAfter) !== forgiven(kpiBefore);
      if (changed) touched.add(String(row.userId));
    }
  };

  let batch = [];
  for await (const row of cursor) {
    const a = row.location?.accuracy;
    const na = row.replaced?.nearest?.accuracy;
    if (!(a < 0) && !(na < 0)) continue;
    out.candidates += 1;
    batch.push(row);
    if (batch.length === 1000) {
      await settle(batch);
      batch = [];
    }
  }
  if (batch.length) await settle(batch);
  return { ...out, canvassers: touched.size };
};

// ── Frozen unknocks and pin fixes ─────────────────────────────────────────────────────────────
const frozenReport = async () => {
  const [r] = await UnknockRunChunk.aggregate([
    { $unwind: '$rows' },
    // A chunk frozen after a deploy holds older rows verbatim, so judge each row by its own date.
    ...sinceMatch('rows.createdAt'),
    {
      $group: {
        _id: null,
        scanned: { $sum: 1 },
        rows: count({
          $or: [unusableAcc('$rows.location.accuracy'), coordNonFinite('$rows.location'), coordOffEarth('$rows.location'), nullIsland('$rows.location')],
        }),
      },
    },
  ]);
  return r || { scanned: 0, rows: 0 };
};

const pinFixReport = async () => {
  // An aggregation, not countDocuments: Mongoose casts a query filter and refuses the NaN in $in.
  const [r] = await HouseholdLocationChange.aggregate([
    ...sinceMatch(),
    { $match: { source: 'gps' } },
    { $group: { _id: null, scanned: { $sum: 1 }, rows: count(unusableAcc('$accuracy')) } },
  ]);
  return r || { scanned: 0, rows: 0 };
};

// ── Report ────────────────────────────────────────────────────────────────────────────────────
const n = (x) => Number(x || 0).toLocaleString('en-US');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const scope = since ? 'created since then' : 'stored';

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log(`GPS stamp audit — ${since ? `rows created at or after ${sinceLabel}` : 'every stored row'}. Read-only.\n`);

  const ledgers = [
    ['Door results (CanvassActivity)', await ledgerReport(CanvassActivity, { snapshot: true })],
    ['Survey responses (SurveyResponse)', await ledgerReport(SurveyResponse)],
    ['Replaced survey answers (SurveyResponseArchive)', await ledgerReport(SurveyResponseArchive)],
  ];
  for (const [label, r] of ledgers) {
    console.log(`${label}: ${n(r.rows)} with an odd GPS stamp, of ${n(r.scanned)} ${scope}`);
    if (!r.rows) continue;
    console.log(`  accuracy negative ${n(r.accNegative)} · zero ${n(r.accZero)} · not finite ${n(r.accNonFinite)}`);
    if (r.zeros.length) {
      const months = r.zeros.reduce((m, z) => {
        const e = m.get(z._id.month) || { mock: 0, other: 0 };
        e[z._id.mocked ? 'mock' : 'other'] += z.n;
        return m.set(z._id.month, e);
      }, new Map());
      const parts = [...months].map(([month, e]) => `${month}: ${n(e.mock)} mock-location, ${n(e.other)} other`);
      console.log(`  zero accuracies by month: ${parts.join(' · ')}`);
    }
    console.log(`  coordinate not finite ${n(r.coordNonFinite)} · off the Earth ${n(r.coordOffEarth)} · exactly (0, 0) ${n(r.nullIsland)}`);
    if ('snapshotAcc' in r) console.log(`  replaced-entry snapshot with an unusable accuracy ${n(r.snapshotAcc)}`);
    console.log(`  created ${day(r.first)} to ${day(r.last)}`);
  }

  const c = await clampReport();
  console.log(`\nWhat the clamp changes (door results with a negative own or snapshot-nearest accuracy): ${n(c.candidates)} row(s)`);
  if (c.candidates) {
    const signed = (x) => (x > 0 ? `+${n(x)}` : n(x));
    console.log(`  audit far reasons removed ${n(c.farRemoved)} · flags whose severity drops ${n(c.severityDrops)}`);
    console.log(`  per-canvasser Far count ${signed(c.kpiFarDelta)} · forgiven ${signed(c.kpiForgivenDelta)} · canvassers affected ${n(c.canvassers)}`);
  }

  const frozen = await frozenReport();
  const pins = await pinFixReport();
  console.log(`\nUnknocked entries held for a revert: ${n(frozen.rows)} with an odd GPS stamp, of ${n(frozen.scanned)} ${scope}`);
  console.log(`GPS pin fixes with a zero, negative or non-finite accuracy: ${n(pins.rows)}, of ${n(pins.scanned)} ${scope}\n`);

  console.log('Nothing was changed. Before the clamp a negative accuracy added distance in the far check; now it gives no discount, which is all the section above measures.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
