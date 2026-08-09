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

// ── Disagreeing coordinates across rows for one household ────────────────────
//
// Several voters share an address, so several rows collapse into one Household. The old
// rule was "first row with valid coords wins", silently — one bad row that sorted first
// pinned the door miles away with no error and no counter, and the geocoder never
// re-checks a door that already has coordinates.

// Same address, distinct voter ids, per-row coordinates. FL bounds so inStateBounds
// (which fails open on unknown codes) is actually exercised.
const coordRow = (id, lat, lng, st = 'FL') => ({
  ID: id, FN: `First${id}`, LN: `Last${id}`,
  ADDR: '100 Main St', CITY: 'Townsville', ST: st, ZIP: '33001',
  LAT: String(lat), LNG: String(lng),
});

const onlyDoor = (r) => [...r.householdMap.values()][0];

test('rows that agree on a pin are not a conflict', () => {
  const r = validateRows([coordRow('A', 26.1, -80.2), coordRow('B', 26.1, -80.2)], MAPPING, HEADERS);
  assert.equal(r.householdMap.size, 1);
  assert.equal(r.coordConflicts, 0);
  assert.equal(r.coordConflictTies, 0);
  assert.equal(onlyDoor(r).latitude, 26.1);
});

test('rooftop-vs-parcel noise is not a conflict — under the 150m tolerance', () => {
  // ~55m north. Real files disagree at this scale constantly; it is not a disagreement.
  const r = validateRows([coordRow('A', 26.1, -80.2), coordRow('B', 26.1005, -80.2)], MAPPING, HEADERS);
  assert.equal(r.coordConflicts, 0);
  assert.equal(onlyDoor(r).latitude, 26.1); // first pin kept, unchanged behavior
});

test('a majority of rows outvotes row order — the fix for first-row-wins', () => {
  // The bad pin sorts FIRST and would have won under the old rule.
  const r = validateRows(
    [coordRow('A', 26.9, -80.9), coordRow('B', 26.1, -80.2), coordRow('C', 26.1, -80.2)],
    MAPPING, HEADERS
  );
  assert.equal(r.coordConflicts, 1);
  assert.equal(r.coordConflictTies, 0);
  const d = onlyDoor(r);
  assert.equal(d.latitude, 26.1);
  assert.equal(d.longitude, -80.2);
  assert.ok(!d.coordConflict);
});

test('an out-of-state candidate loses to an in-state one even at 1-1', () => {
  // Colorado coordinates on a Florida address — the gross case a state check catches.
  const r = validateRows([coordRow('A', 39.7, -104.9), coordRow('B', 26.1, -80.2)], MAPPING, HEADERS);
  assert.equal(r.coordConflicts, 1);
  assert.equal(r.coordConflictTies, 0);
  assert.equal(onlyDoor(r).latitude, 26.1);
});

test('a genuine tie keeps the first pin and is RECORDED, never nulled', () => {
  // Two in-state pins, one row each, miles apart — the exact shape of the mis-pinned
  // Nebraska doors. Nothing can settle it from the file alone.
  const r = validateRows([coordRow('A', 26.1, -80.2), coordRow('B', 26.5, -80.6)], MAPPING, HEADERS);
  assert.equal(r.coordConflicts, 1);
  assert.equal(r.coordConflictTies, 1);
  const d = onlyDoor(r);
  assert.equal(d.coordConflict, true);
  // NEVER nulled: a household the geocoder can't place is dropped along with its voters,
  // and losing a door is worse than a suspect pin.
  assert.equal(d.latitude, 26.1);
  assert.equal(d.longitude, -80.2);
});

test('a later row still FILLS a missing pin (unchanged behavior)', () => {
  const noCoords = { ...coordRow('A', 0, 0), LAT: '', LNG: '' };
  const r = validateRows([noCoords, coordRow('B', 26.1, -80.2)], MAPPING, HEADERS);
  // GEOCODE_ENABLED is unset under `node --test`, so the coordless row errors out and
  // never reaches grouping — the door is built from the row that has coordinates.
  assert.equal(onlyDoor(r).latitude, 26.1);
  assert.equal(r.coordConflicts, 0);
});

test('candidate tracking is bounded — many distinct pins never grow without limit', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) rows.push(coordRow(`V${i}`, 26.1 + i * 0.01, -80.2));
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.householdMap.size, 1);
  assert.equal(r.coordConflicts, 1);
  // Resolved deterministically without holding all 40 candidates.
  assert.ok(onlyDoor(r).latitude != null);
});

test('separate addresses never pool their coordinates', () => {
  const r = validateRows(
    [coordRow('A', 26.1, -80.2), { ...coordRow('B', 26.9, -80.9), ADDR: '200 Oak St' }],
    MAPPING, HEADERS
  );
  assert.equal(r.householdMap.size, 2);
  assert.equal(r.coordConflicts, 0);
});

// ── Placeholder pins: many DIFFERENT streets on one exact coordinate ─────────
//
// A vendor that can't place an address stamps a ZIP/area centroid, so unrelated streets
// pile onto one dot. Detection only — the coords are never nulled (nulling would hand
// the doors to the geocoder, which DROPS what it can't place, and placeholder-stamped
// addresses are exactly the ones geocoders fail on).

const at = (id, addr, lat, lng) => ({
  ID: id, FN: `F${id}`, LN: `L${id}`,
  ADDR: addr, CITY: 'Labelle', ST: 'FL', ZIP: '33935',
  LAT: String(lat), LNG: String(lng),
});

test('a placeholder pin is counted; the doors keep their coords and still import', () => {
  const rows = [
    at('A', '370 Mahogony Ct', 26.76, -81.45),
    at('B', '800 Gen Chesty Puller Ct', 26.76, -81.45),
    at('C', '2100 G Rd', 26.76, -81.45),
    at('D', '55 Solo St', 26.9, -81.2), // a normal lone door
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.placeholderPins, 1);
  assert.equal(r.placeholderPinDoors, 3);
  // Never nulled — a suspect pin walks, a dropped door doesn't.
  for (const h of r.householdMap.values()) assert.ok(h.latitude != null);
  assert.equal(r.householdMap.size, 4);
});

test('a real building — one street line, units in the address — is not a placeholder', () => {
  const rows = [
    at('A', '1000 Lely Palms Dr Apt 151', 26.1, -81.7),
    at('B', '1000 Lely Palms Dr Apt 152', 26.1, -81.7),
    at('C', '1000 Lely Palms Dr Apt 153', 26.1, -81.7),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.placeholderPins, 0);
  assert.equal(r.placeholderPinDoors, 0);
});

test('a dominant-street building with one stray counts only the stray', () => {
  const rows = [
    at('A', '900 Aqua Isles Blvd Lot 1', 26.76, -81.452),
    at('B', '900 Aqua Isles Blvd Lot 2', 26.76, -81.452),
    at('C', '900 Aqua Isles Blvd Lot 3', 26.76, -81.452),
    at('D', '19007 Broad Shore Walk', 26.76, -81.452), // the stray
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.placeholderPins, 0, 'the park is not a placeholder');
  assert.equal(r.placeholderPinDoors, 1, 'only the stray is suspect');
});

test('placeholder detection runs on RESOLVED coordinates — after the per-household vote', () => {
  // Two rows for one address disagree; majority resolves it AWAY from the shared spot, so
  // the resolved pin no longer stacks and no placeholder is counted. Order of operations
  // matters: judging pre-vote coords would report a placeholder that won't exist on disk.
  const rows = [
    at('A', '10 Vote St', 26.76, -81.45), // loses the vote
    at('B', '10 Vote St', 26.9, -81.2),
    at('C', '10 Vote St', 26.9, -81.2), // majority
    at('D', '20 Other Ave', 26.76, -81.45),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.coordConflicts, 1);
  assert.equal(r.placeholderPins, 0, 'after the vote, only one door remains at the shared spot');
});
