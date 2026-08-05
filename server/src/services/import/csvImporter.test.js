import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRows, SPREADSHEET_ERROR_RE } from './csvImporter.js';

// Header names deliberately differ from canonical keys — the mapping is doing work.
const MAPPING = {
  stateVoterId: 'ID',
  firstName: 'FN',
  lastName: 'LN',
  addressLine1: 'ADDR',
  city: 'CITY',
  state: 'ST',
  zipCode: 'ZIP',
  latitude: 'LAT',
  longitude: 'LNG',
};
const HEADERS = Object.values(MAPPING);

// All rows carry valid coords so bad_coords never muddies these tests
// (GEOCODE_ENABLED is unset under `node --test`).
const row = (id, n, addr = `${n} Main St`) => ({
  ID: id, FN: `First${n}`, LN: `Last${n}`,
  ADDR: addr, CITY: 'Townsville', ST: 'FL', ZIP: '33001',
  LAT: '26.1', LNG: '-80.2',
});

test('SPREADSHEET_ERROR_RE — error literals match, real IDs never do', () => {
  const literals = ['=#NUM!', '#NUM!', '#REF!', '#N/A', '=#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#SPILL!', '#CALC!', '=#ref!'];
  for (const v of literals) assert.equal(SPREADSHEET_ERROR_RE.test(v), true, v);
  const ids = ['123456789', '120049565', 'AB-123', 'CSP12345', '=123', '#HASHTAG', 'N/A0', ''];
  for (const v of ids) assert.equal(SPREADSHEET_ERROR_RE.test(v), false, v);
});

test('error literals in the ID column are spreadsheet_error rows, never duplicates', () => {
  // The FL-22 failure shape in miniature: several rows share the SAME error
  // literal. Before the fix they collapsed into one voter + "1 duplicate".
  const rows = [
    row('=#NUM!', 1),
    row('=#NUM!', 2),
    row('#REF!', 3),
    row('120049565', 4),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.totalRows, 4);
  assert.equal(r.validCount, 1);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].voter.stateVoterId, '120049565');
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.every((e) => e.code === 'spreadsheet_error'));
  assert.equal(r.dupRows, 0);
  assert.equal(r.dupSvids.size, 0);
  // Dropped rows must not leave ghost doors behind.
  assert.equal(r.householdMap.size, 1);
});

test('duplicateInFile counts dropped ROWS; dupSvids maps value → dropped count', () => {
  const rows = [
    row('X', 1, '1 Elm St'),
    row('X', 2, '2 Elm St'),
    row('X', 3, '3 Elm St'),
    row('X', 4, '4 Elm St'),
    row('Y', 5, '5 Elm St'),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.validCount, 2);
  assert.equal(r.dupRows, 3); // 4 X-rows → first kept, 3 dropped
  assert.equal(r.dupSvids.get('X'), 3);
  assert.equal(r.dupSvids.has('Y'), false);
  assert.equal(r.errors.length, 0);
  // First occurrence wins.
  assert.equal(r.validRows.find((v) => v.voter.stateVoterId === 'X').voter.firstName, 'First1');
  // Only the kept rows' doors exist.
  assert.equal(r.householdMap.size, 2);
});

test('every source row is accounted for: valid + errors + dupRows === totalRows', () => {
  const rows = [
    row('=#NUM!', 1), row('=#NUM!', 2), row('=#NUM!', 3), // spreadsheet errors
    row('A', 4), row('A', 5),                             // one dup drop
    row('B', 6),
    { ...row('C', 7), FN: '' },                           // missing required
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.validCount + r.errors.length + r.dupRows, r.totalRows);
  assert.equal(r.validCount, 2); // A (first) + B
  assert.equal(r.dupRows, 1);
  assert.equal(r.errors.filter((e) => e.code === 'spreadsheet_error').length, 3);
  assert.equal(r.errors.filter((e) => e.code === 'missing_required').length, 1);
});
