import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knockSplitLine as web } from './exportSplit.js';
// Cross-tree on purpose (the byPassFold.parity pattern): the web history and the phone's row count and
// history must say the same "N knocks + M more people surveyed" for the same file.
import { knockSplitLine as mobile } from '../../../mobile/lib/exportTypes.js';

test('knockSplitLine: the web and the phone say the same words', () => {
  for (const onePerKnock of [false, true]) {
    for (const perVoterRows of [false, true]) {
      for (const rows of [0, 1, 2, 999, 4697, 1234567]) {
        for (const surveyRows of [undefined, null, 0, 1, 14, 2500]) {
          const params = { onePerKnock, perVoterRows };
          const counts = { rows, surveyRows };
          assert.strictEqual(mobile(params, counts), web(params, counts), JSON.stringify({ params, counts }));
        }
      }
    }
  }
});
