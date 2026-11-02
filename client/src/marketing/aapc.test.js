import { test } from 'node:test';
import assert from 'node:assert';
import { aapcPhase, aapcEventPhase, aapcPhaseScript, AAPC } from './aapc.js';

const live = { ...AAPC, pageLive: true };
// Instants in the event's zone (Eastern): Nov 2026 is standard time, UTC−5; Oct 31 is still daylight, UTC−4.
const at = (isoLocal) => new Date(`${isoLocal}-05:00`);

test('the banner is off until /aapc is live, whatever the date', () => {
  assert.strictEqual(aapcPhase(at('2026-11-16T12:00:00'), { ...AAPC, pageLive: false }), 'off');
});

test('banner phases follow the configured days at midnight Eastern', () => {
  assert.strictEqual(aapcPhase(new Date('2026-10-31T23:59:00-04:00'), live), 'off');
  assert.strictEqual(aapcPhase(at('2026-11-01T00:00:00'), live), 'before');
  assert.strictEqual(aapcPhase(at('2026-11-17T23:59:00'), live), 'before');
  assert.strictEqual(aapcPhase(at('2026-11-18T00:00:00'), live), 'after');
  assert.strictEqual(aapcPhase(at('2026-11-24T23:59:00'), live), 'after');
  assert.strictEqual(aapcPhase(at('2026-11-25T00:00:00'), live), 'off');
});

test('the event phase has no window: before through Nov 17, after from Nov 18, for good', () => {
  assert.strictEqual(aapcEventPhase(new Date('2026-10-20T12:00:00-04:00'), live), 'before');
  assert.strictEqual(aapcEventPhase(at('2026-11-17T23:59:00'), live), 'before');
  assert.strictEqual(aapcEventPhase(at('2026-11-18T00:00:00'), live), 'after');
  assert.strictEqual(aapcEventPhase(at('2026-12-31T12:00:00'), live), 'after', 'after the banner is gone, /aapc still reads after');
});

test('the inline head script stamps both attributes exactly as the functions do, hour by hour', () => {
  const src = aapcPhaseScript(live);
  const RealDate = Date;
  for (let t = new RealDate('2026-10-30T00:00:00-04:00').getTime(); t <= at('2026-11-28T00:00:00').getTime(); t += 3_600_000) {
    const stamped = {};
    const fakeDocument = { documentElement: { setAttribute: (k, v) => { stamped[k] = v; } } };
    // The script reads `new Date()` — give it this instant.
    const FixedDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } };
    new Function('document', 'Date', src)(fakeDocument, FixedDate);
    const when = new RealDate(t);
    assert.strictEqual(stamped['data-aapc'], aapcPhase(when, live), `data-aapc at ${when.toISOString()}`);
    assert.strictEqual(stamped['data-aapc-event'], aapcEventPhase(when, live), `data-aapc-event at ${when.toISOString()}`);
  }
});
