import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { farAssessment } from '../src/services/audit/flagDetection.js';
import { farVerdictForWire } from '../src/services/audit/farKpi.js';
import { FLAG_THRESHOLDS as SERVER_THRESHOLDS } from '../src/services/audit/flagThresholds.js';
import * as web from '../../client/src/lib/flags.js';

// The far label the admin panels print (client/src/lib/flags.js) against the audit's own far rule
// (farAssessment), and the two hand mirrors of the flag display module against each other
// (docs/PROPOSAL_GPS_UPGRADES.md §H.1). Nothing else enforces any of this: a threshold or wording
// changed on one side only now fails `npm test` here.
//
// mobile/lib/flags.js imports './geo' and './theme' with no extension, which Metro resolves and node's
// ESM loader refuses. This hook (mobile/lib/campaignHistory.test.js) retries such a relative import
// with '.js', so the test loads the phone's file as it ships. Registered before the dynamic import.
const RESOLVE_JS = `export const resolve = async (specifier, context, next) => {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || specifier.endsWith('.js')) throw err;
    return next(specifier + '.js', context);
  }
};`;
register(`data:text/javascript,${encodeURIComponent(RESOLVE_JS)}`);
const phone = await import('../../mobile/lib/flags.js');

const DISTANCES = [null, 0, 50, 74.9, 75, 75.0001, 76, 90, 100, 150, 175, 175.01, 250, 325, 326, 1000];
const ACCURACIES = [undefined, null, -1, 0, 0.5, 5, 15, 40, 100, 175, 250, 1000];
const row = (d, a) => ({
  _id: 'a1',
  userId: 'u1',
  timestamp: new Date('2026-10-01T15:00:00Z'),
  distanceFromHouseMeters: d,
  location: { lat: 38.2, lng: -85.7, ...(a === undefined ? {} : { accuracy: a }) },
});

test('the web far label agrees with the server far rule on all 192 boundary cases', () => {
  let cases = 0;
  for (const d of DISTANCES) {
    for (const a of ACCURACIES) {
      const server = farAssessment(row(d, a), undefined);
      // A row with no verdict is judged by the arithmetic; a ping carrying the server's verdict by it.
      assert.strictEqual(web.farLabelState(row(d, a)) === 'far', server != null, `arithmetic d=${d} a=${a}`);
      assert.strictEqual(web.farLabelState(web.farRowOf({ ...row(d, a), far: farVerdictForWire(server) })) === 'far', server != null, `verdict d=${d} a=${a}`);
      if (server) assert.strictEqual(Math.round(web.effectiveDistanceMeters(d, a)), server.detail.effectiveMeters, `remainder d=${d} a=${a}`);
      cases += 1;
    }
  }
  assert.strictEqual(cases, 192);
});

test('a flag entry is labelled from its own far reason, never the raw distance', () => {
  const far = (severity, detail = {}) => ({ type: 'far', severity, detail: { meters: 300, effectiveMeters: 290, accuracy: 10, ...detail } });
  assert.strictEqual(web.farLabelState({ distanceFromHouseMeters: 300, reasons: [far('med')] }), 'far');
  assert.strictEqual(web.farLabelState({ distanceFromHouseMeters: 300, reasons: [far('high')] }), 'far');
  assert.strictEqual(web.farLabelState({ distanceFromHouseMeters: 300, reasons: [far('low', { downgraded: true })] }), 'low');
  assert.strictEqual(web.farLabelState({ distanceFromHouseMeters: 300, reasons: [far('low', { pinDowngraded: true })] }), 'low');
  const weakOnly = { distanceFromHouseMeters: 394, location: { accuracy: 150 }, reasons: [{ type: 'weak_gps', severity: 'low', detail: { accuracy: 150 } }] };
  assert.strictEqual(web.farLabelState(weakOnly), null, 'no far reason: not far, even at a raw 394 m');
});

test('a ping uses its server verdict; without the key it falls back to the arithmetic', () => {
  assert.strictEqual(web.farLabelState(web.farRowOf({ ...row(300, 10), far: null })), null);
  assert.strictEqual(web.farLabelState(web.farRowOf({ ...row(300, 10), far: { severity: 'low', detail: { pinDowngraded: true } } })), 'low');
  assert.strictEqual(web.farLabelState(web.farRowOf(row(300, 10))), 'far');
  assert.strictEqual(web.farLabelState(web.farRowOf(row(80, 10))), null);
});

test('gpsAccuracyText: plain at or under 250 ft, the remainder when far, Not far when the radius explains it, Too imprecise past 330 ft', () => {
  const ft = web.formatDistanceImperial;
  assert.strictEqual(web.gpsAccuracyText(70, 10), `GPS accuracy ±${ft(10)}`);
  assert.strictEqual(web.gpsAccuracyText(null, 10), `GPS accuracy ±${ft(10)}`);
  assert.strictEqual(web.gpsAccuracyText(300, 40), `${ft(260)} after allowing for GPS accuracy (±${ft(40)})`);
  assert.strictEqual(web.gpsAccuracyText(120, 60), `Not far after allowing for GPS accuracy (±${ft(60)})`);
  assert.strictEqual(web.gpsAccuracyText(120, 100), `Not far after allowing for GPS accuracy (±${ft(100)})`);
  assert.strictEqual(web.gpsAccuracyText(120, 150), `Too imprecise to judge the distance (±${ft(150)})`);
  for (const a of [null, undefined, 0, -1, NaN]) assert.strictEqual(web.gpsAccuracyText(300, a), null, String(a));
  // On the 192 cases the line agrees with the server: a remainder exactly when the audit says far;
  // past ~250 ft and not far, "Not far" when the radius is at most ~330 ft, else "Too imprecise".
  for (const d of DISTANCES) {
    for (const a of ACCURACIES) {
      if (d == null || d <= SERVER_THRESHOLDS.FAR_WARN_M || !web.hasUsableAccuracy(a)) continue;
      const server = farAssessment(row(d, a), undefined);
      const want = server
        ? /^\S+ (ft|mi) after allowing for GPS accuracy/
        : a <= SERVER_THRESHOLDS.GPS_ACCURACY_WARN_M
          ? /^Not far after allowing for GPS accuracy/
          : /^Too imprecise to judge the distance/;
      assert.match(web.gpsAccuracyText(d, a), want, `d=${d} a=${a}`);
    }
  }
});

test('the web threshold mirror equals the server', () => {
  for (const k of ['FAR_WARN_M', 'FAR_CONFIRM_M', 'GPS_ACCURACY_WARN_M']) {
    assert.strictEqual(web.FLAG_THRESHOLDS[k], SERVER_THRESHOLDS[k], k);
  }
  assert.strictEqual(web.FAR_WARN_M, SERVER_THRESHOLDS.FAR_WARN_M);
});

test('web and phone flags.js agree on every shared constant; the web footer adds only the circle sentence', () => {
  assert.deepStrictEqual(web.FLAG_THRESHOLDS, phone.FLAG_THRESHOLDS);
  assert.deepStrictEqual(web.REASON_META, phone.REASON_META);
  assert.deepStrictEqual(web.FLAG_LEGEND, phone.FLAG_LEGEND);
  assert.deepStrictEqual(web.SEV_RANK, phone.SEV_RANK);
  for (const k of Object.keys(phone.SEVERITY_META)) {
    assert.strictEqual(web.SEVERITY_META[k].label, phone.SEVERITY_META[k].label, k);
    assert.strictEqual(web.SEVERITY_META[k].dot, phone.SEVERITY_META[k].dot, k);
  }
  assert.deepStrictEqual(Object.keys(web.SEVERITY_META), Object.keys(phone.SEVERITY_META));
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(web.REVIEW_STATUS_META).map(([k, v]) => [k, v.label])),
    Object.fromEntries(Object.entries(phone.REVIEW_STATUS_META).map(([k, v]) => [k, v.label]))
  );
  // Until the phone's admin map draws circles (§H.6), its footer must not describe them.
  assert.strictEqual(web.FLAG_LEGEND_FOOTER, `${phone.FLAG_LEGEND_FOOTER} ${web.ACCURACY_CIRCLE_CAPTION}`);
});

test('web and phone return identical text from every helper they share', () => {
  const t = (iso) => new Date(iso).toISOString();
  const reasons = [
    { type: 'far', severity: 'med', detail: { meters: 300, effectiveMeters: 290, accuracy: 10 } },
    { type: 'far', severity: 'low', detail: { meters: 300, effectiveMeters: 290, accuracy: 10, downgraded: true, priorActionType: 'not_home', priorMeters: 20, priorAccuracy: 8, minutesSincePrior: 12, nearestMeters: 20, minutesSinceNearest: 12 } },
    { type: 'far', severity: 'low', detail: { meters: 300, effectiveMeters: 290, accuracy: 10, pinDowngraded: true, pinCorrectedMeters: 20, pinCorrectedAt: t('2026-09-01T00:00:00Z') } },
    { type: 'far', severity: 'high', detail: { meters: 2000, effectiveMeters: 1990, accuracy: 10, pinMovedBySelf: true, pinCorrectedMeters: 30, pinCorrectedAt: t('2026-09-01T00:00:00Z') } },
    { type: 'weak_gps', severity: 'low', detail: { accuracy: 150 } },
    { type: 'weak_gps', severity: 'low', detail: { missing: true } },
    { type: 'weak_gps', severity: 'low', detail: { stale: true, fixAgeSec: 600 } },
    { type: 'weak_gps', severity: 'low', detail: { offline: true, accuracy: 8 } },
    { type: 'mock_gps', severity: 'high', detail: {} },
    { type: 'too_fast', severity: 'med', detail: { secondsBetween: 8, metersBetween: 400 } },
    { type: 'impossible_speed', severity: 'high', detail: { mph: 140, metersBetween: 9000, secondsBetween: 60 } },
  ];
  const entries = [
    { reasons: [] },
    ...reasons.map((r) => ({ reasons: [r], review: { status: 'reviewed', reviewedAt: t('2026-08-15T00:00:00Z') } })),
    { reasons: [reasons[0], reasons[4], reasons[8]] },
    { reasons: [reasons[2]], review: { status: 'reviewed', reviewedAt: t('2026-09-15T00:00:00Z') } },
  ];
  for (const r of reasons) {
    assert.strictEqual(web.reasonDetailText(r), phone.reasonDetailText(r), r.type);
    assert.strictEqual(web.reasonLabel(r.type), phone.reasonLabel(r.type), r.type);
    assert.strictEqual(web.reasonColor(r.type), phone.reasonColor(r.type), r.type);
  }
  for (const e of entries) {
    const label = JSON.stringify(e).slice(0, 80);
    assert.deepStrictEqual(web.primaryReason(e), phone.primaryReason(e), label);
    for (const fn of ['correctionContextText', 'pinCorrectionText', 'isDowngradedCorrection', 'isPinDowngraded', 'isSelfMovedPin', 'pinMovedAfterReview']) {
      assert.strictEqual(web[fn](e), phone[fn](e), `${fn} ${label}`);
    }
  }
});
