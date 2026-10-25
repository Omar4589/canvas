import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveDeletionNotice, takeDeletionNotice } from './deletionNotice.js';

// The profile that deleted an account leaves the Users list one notice; the list reads it on focus.

test('the notice shows once: taking it clears it', () => {
  assert.equal(takeDeletionNotice(), null);
  leaveDeletionNotice("Sam Rivera's account was deleted.");
  assert.equal(takeDeletionNotice(), "Sam Rivera's account was deleted.");
  assert.equal(takeDeletionNotice(), null, 'a second focus shows nothing');
});

test('a newer notice replaces one nobody read, and an empty one clears it', () => {
  leaveDeletionNotice("Sam Rivera's account was deleted.");
  leaveDeletionNotice("Jordan Lee's account was deleted.");
  assert.equal(takeDeletionNotice(), "Jordan Lee's account was deleted.");
  leaveDeletionNotice('Waiting');
  leaveDeletionNotice('');
  assert.equal(takeDeletionNotice(), null);
});
