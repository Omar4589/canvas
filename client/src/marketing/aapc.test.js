import { test } from 'node:test';
import assert from 'node:assert';
import { aapcPhase, aapcPhaseScript, AAPC } from './aapc.js';

const live = { ...AAPC, pageLive: true };
// Instants in the event's zone (Eastern): Nov 2026 is standard time, UTC−5.
const at = (isoLocal) => new Date(`${isoLocal}-05:00`);

test('the banner is off until /aapc is live, whatever the date', () => {
  assert.strictEqual(aapcPhase(at('2026-11-16T12:00:00'), { ...AAPC, pageLive: false }), 'off');
});

test('phases follow the configured days at midnight Eastern', () => {
  assert.strictEqual(aapcPhase(at('2026-11-13T23:59:00'), live), 'off');
  assert.strictEqual(aapcPhase(at('2026-11-14T00:00:00'), live), 'before');
  assert.strictEqual(aapcPhase(at('2026-11-17T23:59:00'), live), 'before');
  assert.strictEqual(aapcPhase(at('2026-11-18T00:00:00'), live), 'after');
  assert.strictEqual(aapcPhase(at('2026-11-24T23:59:00'), live), 'after');
  assert.strictEqual(aapcPhase(at('2026-11-25T00:00:00'), live), 'off');
});

test('the inline head script stamps the same phase as aapcPhase, hour by hour across the window', () => {
  const src = aapcPhaseScript(live);
  const RealDate = Date;
  for (let t = at('2026-11-12T00:00:00').getTime(); t <= at('2026-11-27T00:00:00').getTime(); t += 3_600_000) {
    let stamped = null;
    const fakeDocument = { documentElement: { setAttribute: (k, v) => { if (k === 'data-aapc') stamped = v; } } };
    // The script reads `new Date()` — give it this instant.
    const FixedDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } };
    new Function('document', 'Date', src)(fakeDocument, FixedDate);
    assert.strictEqual(stamped, aapcPhase(new RealDate(t), live), new RealDate(t).toISOString());
  }
});
