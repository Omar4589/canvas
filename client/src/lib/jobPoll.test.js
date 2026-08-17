import { test } from 'node:test';
import assert from 'node:assert';
import { jobPollInterval, jobPct } from './jobPoll.js';

test('jobPollInterval keeps polling until a terminal status, then stops', () => {
  assert.strictEqual(jobPollInterval(undefined), 1200); // no data yet — keep polling
  assert.strictEqual(jobPollInterval('waiting'), 1200);
  assert.strictEqual(jobPollInterval('active'), 1200);
  assert.strictEqual(jobPollInterval('delayed'), 1200);
  assert.strictEqual(jobPollInterval('completed'), false);
  assert.strictEqual(jobPollInterval('failed'), false);
  assert.strictEqual(jobPollInterval('active', 500), 500); // interval override
});

test('jobPct normalizes both BullMQ progress shapes', () => {
  assert.strictEqual(jobPct(0), 0); // fresh job — progress is the number 0
  assert.strictEqual(jobPct(42), 42);
  assert.strictEqual(jobPct({ phase: 'clustering', pct: 37 }), 37);
  assert.strictEqual(jobPct(undefined), undefined);
  assert.strictEqual(jobPct(null), undefined); // typeof null === 'object' — falls into ?.pct
});
