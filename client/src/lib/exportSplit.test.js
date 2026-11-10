import { test } from 'node:test';
import assert from 'node:assert';
import { knockSplitLine } from './exportSplit.js';

test('knockSplitLine: per-knock files only, knocks = rows − survey rows', () => {
  assert.strictEqual(knockSplitLine({ onePerKnock: true }, { rows: 4697, surveyRows: 14 }), '4,683 knocks + 14 more people surveyed');
  assert.strictEqual(knockSplitLine({ onePerKnock: true }, { rows: 2, surveyRows: 1 }), '1 knock + 1 more person surveyed');
  assert.strictEqual(knockSplitLine({ onePerKnock: true, perVoterRows: true }, { rows: 9000, surveyRows: 14 }), 'includes 14 more people surveyed');
  // No survey rows → nothing to explain; a plain file → never (its rows are entries, not knocks).
  assert.strictEqual(knockSplitLine({ onePerKnock: true }, { rows: 4683, surveyRows: 0 }), null);
  assert.strictEqual(knockSplitLine({}, { rows: 4707, surveyRows: 14 }), null);
  assert.strictEqual(knockSplitLine(undefined, undefined), null);
});
