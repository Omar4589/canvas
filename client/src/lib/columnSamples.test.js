import { test } from 'node:test';
import assert from 'node:assert';
import { columnSamples, sampleWarning } from './columnSamples.js';

// Rows as the preview-headers peek returns them: one object per row, keyed by header.
const ROWS = [
  { Residence_Addresses_State: 'GA', Voters_StateVoterID: '08719967', Hamlet_Community_Area: '', City: 'ATLANTA CITY' },
  { Residence_Addresses_State: 'GA', Voters_StateVoterID: '05187273', Hamlet_Community_Area: '', City: 'ATLANTA CITY' },
  { Residence_Addresses_State: ' GA ', Voters_StateVoterID: '12453551', Hamlet_Community_Area: '  ', City: 'SANDY SPRINGS CITY' },
  { Residence_Addresses_State: 'GA', Voters_StateVoterID: '12424136', Hamlet_Community_Area: '', City: 'ATLANTA CITY' },
];

test('columnSamples: distinct, trimmed, non-blank, in file order, capped', () => {
  assert.deepStrictEqual(columnSamples(ROWS, 'Residence_Addresses_State'), ['GA']);
  assert.deepStrictEqual(columnSamples(ROWS, 'Voters_StateVoterID'), ['08719967', '05187273', '12453551']);
  assert.deepStrictEqual(columnSamples(ROWS, 'Voters_StateVoterID', 2), ['08719967', '05187273']);
  assert.deepStrictEqual(columnSamples(ROWS, 'City'), ['ATLANTA CITY', 'SANDY SPRINGS CITY']);
});

test('columnSamples: a blank or missing column, or no rows, gives nothing', () => {
  assert.deepStrictEqual(columnSamples(ROWS, 'Hamlet_Community_Area'), []);
  assert.deepStrictEqual(columnSamples(ROWS, 'Not_A_Column'), []);
  assert.deepStrictEqual(columnSamples([], 'City'), []);
  assert.deepStrictEqual(columnSamples(undefined, 'City'), []);
});

test('columnSamples: numbers from an Excel sheet read as text', () => {
  assert.deepStrictEqual(columnSamples([{ Zip: 30342 }, { Zip: 0 }], 'Zip'), ['30342', '0']);
});

test('sampleWarning: a State column of voter IDs is flagged; codes and names are not', () => {
  assert.match(sampleWarning('state', ['08719967', '05187273']), /don’t look like states/);
  assert.equal(sampleWarning('state', ['GA']), null);
  assert.equal(sampleWarning('state', ['Georgia', 'florida']), null);
  // One odd value among real ones is a typo in the file, not the wrong column.
  assert.equal(sampleWarning('state', ['GA', '08719967']), null);
});

test('sampleWarning: ZIPs — five digits or ZIP+4 pass; a dropped leading zero does not', () => {
  assert.equal(sampleWarning('zipCode', ['30342']), null);
  assert.equal(sampleWarning('zipCode', ['30342-3611', '303423611']), null);
  assert.match(sampleWarning('zipCode', ['2134', '2138']), /don’t look like ZIP codes/);
  assert.match(sampleWarning('zipCode', ['3611', '1155']), /don’t look like ZIP codes/); // a ZIP+4 column
});

test('sampleWarning: only State and ZIP carry a shape; no samples, no warning', () => {
  assert.equal(sampleWarning('city', ['ATLANTA CITY']), null);
  assert.equal(sampleWarning('stateVoterId', ['GA']), null);
  assert.equal(sampleWarning('state', []), null);
});
