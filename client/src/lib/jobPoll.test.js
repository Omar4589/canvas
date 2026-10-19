import { test } from 'node:test';
import assert from 'node:assert';
import { jobPollInterval, jobPct, RUN_TERMINAL } from './jobPoll.js';

test('jobPollInterval keeps polling until a terminal status, then stops', () => {
  assert.strictEqual(jobPollInterval(undefined), 1200); // no data yet — keep polling
  assert.strictEqual(jobPollInterval('waiting'), 1200);
  assert.strictEqual(jobPollInterval('active'), 1200);
  assert.strictEqual(jobPollInterval('delayed'), 1200);
  assert.strictEqual(jobPollInterval('completed'), false);
  assert.strictEqual(jobPollInterval('failed'), false);
  assert.strictEqual(jobPollInterval('active', 500), 500); // interval override
});

test('a conversion run stops polling once it rests, including an undo that stopped part-way', () => {
  for (const s of ['completed', 'failed', 'reverted', 'revert_failed', 'open']) {
    assert.strictEqual(jobPollInterval(s, 1200, RUN_TERMINAL), false, s);
  }
  for (const s of ['pending', 'running', 'reverting']) {
    assert.strictEqual(jobPollInterval(s, 1200, RUN_TERMINAL), 1200, s);
  }
});

test('jobPct normalizes both BullMQ progress shapes', () => {
  assert.strictEqual(jobPct(0), 0); // fresh job — progress is the number 0
  assert.strictEqual(jobPct(42), 42);
  assert.strictEqual(jobPct({ phase: 'clustering', pct: 37 }), 37);
  assert.strictEqual(jobPct(undefined), undefined);
  assert.strictEqual(jobPct(null), undefined); // typeof null === 'object' — falls into ?.pct
});
