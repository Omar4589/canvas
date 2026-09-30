import { test } from 'node:test';
import assert from 'node:assert';
import { describeIdsInFile, zeroDirection, zeroMatchLine, zeroGateText, historySubtitle } from './idListPreview.js';

test('describeIdsInFile: plain count, extra spellings, and rows with no usable ID', () => {
  assert.equal(describeIdsInFile({ idsInFile: 1204, spellings: 1204, noId: 0 }), '1,204 IDs in file');
  assert.equal(describeIdsInFile({ idsInFile: 1, spellings: 1, noId: 0 }), '1 ID in file');
  assert.equal(describeIdsInFile({ idsInFile: 3, spellings: 4, noId: 0 }), '3 IDs in file (4 spellings)');
  assert.equal(describeIdsInFile({ idsInFile: 5, spellings: 6, noId: 1 }), '5 IDs in file · 1 row carried no usable ID');
  assert.equal(describeIdsInFile({ idsInFile: 5, spellings: 8, noId: 2 }), '5 IDs in file (6 spellings) · 2 rows carried no usable ID');
  assert.equal(describeIdsInFile({ idsInFile: 7 }), '7 IDs in file', 'older responses without the new counts still read');
});

test('zeroDirection names which side has the zeros', () => {
  assert.equal(zeroDirection({ file: '8719967', stored: '08719967' }), 'the file lost leading zeros the campaign has');
  assert.equal(zeroDirection({ file: '0001234567', stored: '1234567' }), 'the file carries leading zeros the campaign does not');
  assert.equal(zeroDirection(null), null);
  assert.equal(zeroDirection({ file: 'AB', stored: 'AB' }), null);
});

test('zeroMatchLine: nothing to say when nothing matched by zeros; the example pair when it did', () => {
  assert.equal(zeroMatchLine({ matchedViaZeros: 0 }), null);
  assert.equal(zeroMatchLine({}), null);
  assert.equal(
    zeroMatchLine({ matchedViaZeros: 1190, zeroMatchExample: { file: '8719967', stored: '08719967' } }),
    '1,190 matched only after ignoring leading zeros (e.g. 8719967 → 08719967). Same voters; nothing to fix.'
  );
  assert.equal(zeroMatchLine({ matchedViaZeros: 2 }), '2 matched only after ignoring leading zeros. Same voters; nothing to fix.');
});

test('zeroGateText: the refusal reconciles with the new-voters count and says which side to fix', () => {
  assert.equal(zeroGateText({ zeroOnlyMatches: 0, newVoters: 5 }), null);
  const t = zeroGateText({ zeroOnlyMatches: 12324, newVoters: 12324, example: { file: '8719967', stored: '08719967' } });
  assert.equal(t.title, '12,324 of the 12,324 "new" voters are already in this campaign under another spelling of the same ID.');
  assert.match(t.body, /e\.g\. file 8719967 → stored 08719967: the file lost leading zeros the campaign has/);
  assert.match(t.body, /second time, so this import is refused/);
  assert.match(t.body, /untouched export/);
  const one = zeroGateText({ zeroOnlyMatches: 1, newVoters: 1, example: { file: '0001234567', stored: '1234567' } });
  assert.equal(one.title, '1 of the 1 "new" voter is already in this campaign under another spelling of the same ID.');
  assert.match(one.body, /carries leading zeros the campaign does not/);
});

test('historySubtitle: column, zero count, state and outside-state, in that order; null when empty', () => {
  assert.equal(historySubtitle({}), null);
  assert.equal(historySubtitle({ idColumn: 'Voter ID' }), 'Voter ID');
  assert.equal(historySubtitle({ idColumn: 'Voters_StateVoterID', matchedViaZeros: 1190 }), 'Voters_StateVoterID · 1,190 by zeros');
  assert.equal(historySubtitle({ state: 'FL', idColumn: 'Voter ID', matchedViaZeros: 0, outsideState: 3 }), 'FL · Voter ID · 3 outside FL');
});
