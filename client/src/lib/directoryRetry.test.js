import { test } from 'node:test';
import assert from 'node:assert';
import { shouldRetryDirectory } from './directoryRetry.js';

// Errors as api/client.js throws them: an HTTP answer carries status + code; a fetch that never
// got a response (fetch's own TypeError) carries neither.
const blip = new TypeError('Failed to fetch');
const h12 = Object.assign(new Error('Request failed: 503'), { status: 503, code: null });
const timedOut = Object.assign(
  new Error('The voter directory took too long to load. Pick a campaign to narrow it, or try again.'),
  { status: 503, code: 'DIRECTORY_TIMEOUT' }
);
const forbidden = Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN_ROLE' });

test('shouldRetryDirectory: a network blip gets exactly one retry', () => {
  assert.equal(shouldRetryDirectory(0, blip), true);
  assert.equal(shouldRetryDirectory(1, blip), false);
  assert.equal(shouldRetryDirectory(2, blip), false);
});

test('shouldRetryDirectory: any HTTP answer is final, even on the first failure', () => {
  assert.equal(shouldRetryDirectory(0, h12), false); // Heroku's router gave up; re-running only doubles the wait
  assert.equal(shouldRetryDirectory(0, timedOut), false); // the server gave up on purpose — the page offers Try again
  assert.equal(shouldRetryDirectory(0, forbidden), false);
});

test('shouldRetryDirectory: no error object at all reads as a blip', () => {
  assert.equal(shouldRetryDirectory(0, undefined), true);
  assert.equal(shouldRetryDirectory(0, null), true);
  assert.equal(shouldRetryDirectory(1, undefined), false);
});
