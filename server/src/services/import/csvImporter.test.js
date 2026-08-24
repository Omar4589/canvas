import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRows, SPREADSHEET_ERROR_RE,
  detectMembers, explodeRow, possibleMultiMemberWarning,
  memberTemplate, lowerHeaderIndex,
} from './csvImporter.js';

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

test('a SAME-STREET collapse — different house numbers on one dot — is a placeholder too', () => {
  // The County Rd 78 shape: the vendor stamped its unplaceable addresses onto one point ON
  // the same road. Keyed by street name these impersonate a building; keyed by base address
  // (number kept, unit stripped) they are different homes on one dot.
  const rows = [
    at('A', '1644 County Rd 78', 26.75, -81.44),
    at('B', '2282 County Rd 78', 26.75, -81.44),
    at('C', '3530 County Rd 78', 26.75, -81.44),
    at('D', '4847 County Rd 78', 26.75, -81.44),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.placeholderPins, 1);
  assert.equal(r.placeholderPinDoors, 4);
});

test('a lot community — ONE house number, many lots — is still a real building', () => {
  const rows = [
    at('A', '813 E El Paso Ave Lot 40', 26.75, -81.44),
    at('B', '813 E El Paso Ave Lot 43', 26.75, -81.44),
    at('C', '813 E El Paso Ave Lot 51', 26.75, -81.44),
  ];
  const r = validateRows(rows, MAPPING, HEADERS);
  assert.equal(r.placeholderPins, 0);
  assert.equal(r.placeholderPinDoors, 0);
});

// ── Multi-member detection: templates, the name rail, the loud miss ──────────
//
// detectMembers is anchored on the stateVoterId column having numbered siblings;
// memberTemplate generalizes the naming to a column template (suffix, prefix,
// infix, case drift). When detection does NOT fire but the headers still look
// multi-voter, possibleMultiMemberWarning is the loud miss — the thing that keeps
// a 40%-of-the-file loss from completing green.

// A "resolved" mapping in these tests is just canonical field → the file's ACTUAL header.

test('the FL shape still detects 4 members (suffix + unsuffixed member 1)', () => {
  const headers = ['FLVoterId', 'FLVoterId2', 'FLVoterId3', 'FLVoterId4',
    'FirstName1', 'FirstName2', 'FirstName3', 'FirstName4',
    'LastName1', 'LastName2', 'LastName3', 'LastName4',
    'Address1', 'Address2', 'Address3', 'Mail1', 'Mail2', 'Mail3',
    'Party', 'Gender', 'PrecinctMain', 'Congress', 'Senate', 'House'];
  const resolved = { stateVoterId: 'FLVoterId', firstName: 'FirstName1', lastName: 'LastName1',
    party: 'Party', gender: 'Gender', precinct: 'PrecinctMain',
    congressionalDistrict: 'Congress', stateSenateDistrict: 'Senate', stateHouseDistrict: 'House',
    addressLine1: 'Address1', addressLine2: 'Address2' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.maxMembers, 4);
  assert.equal(m.idTpl.make(3), 'FLVoterId3');
  assert.equal(m.perMember.firstName.tpl.make(2), 'FirstName2');
  // Single-column personal fields have no template — they stay member 1's alone.
  assert.equal(m.perMember.party, undefined);
  assert.equal(m.perMember.gender, undefined);
});

test('prefix convention Voter1_*/Voter2_* detects', () => {
  const headers = ['Voter1_FirstName', 'Voter1_LastName', 'Voter1_StateVoterID',
    'Voter2_FirstName', 'Voter2_LastName', 'Voter2_StateVoterID', 'Address', 'City', 'State', 'Zip'];
  const resolved = { stateVoterId: 'Voter1_StateVoterID', firstName: 'Voter1_FirstName',
    lastName: 'Voter1_LastName', addressLine1: 'Address', city: 'City', state: 'State', zipCode: 'Zip' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.maxMembers, 2);
  assert.equal(m.idTpl.make(2), 'Voter2_StateVoterID');
});

test('underscore/infix convention ID_1/ID_2 detects', () => {
  const headers = ['ID_1', 'ID_2', 'FN_1', 'FN_2', 'LN_1', 'LN_2', 'Addr'];
  const resolved = { stateVoterId: 'ID_1', firstName: 'FN_1', lastName: 'LN_1', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.maxMembers, 2);
  assert.equal(m.perMember.lastName.tpl.make(2), 'LN_2');
});

test('case drift between siblings detects, and make(n) returns the REAL casing', () => {
  const headers = ['VoterID', 'VoterId2', 'FirstName1', 'Firstname2', 'LastName1', 'Lastname2'];
  const resolved = { stateVoterId: 'VoterID', firstName: 'FirstName1', lastName: 'LastName1' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.maxMembers, 2);
  assert.equal(m.idTpl.make(2), 'VoterId2'); // the file's casing, not the constructed one
  assert.equal(m.perMember.firstName.tpl.make(2), 'Firstname2');
});

test('Address1/2/3 + Mail1/2/3 with one unnumbered ID: NOT detected and NOT warned', () => {
  // The false-positive guard, drawn straight from the FL file: numbered HOUSEHOLD
  // columns (address lines) and unmapped Mail columns must never read as members.
  const headers = ['VoterID', 'FirstName', 'LastName', 'Address1', 'Address2', 'Address3',
    'Mail1', 'Mail2', 'Mail3', 'City', 'State', 'Zip'];
  const resolved = { stateVoterId: 'VoterID', firstName: 'FirstName', lastName: 'LastName',
    addressLine1: 'Address1', addressLine2: 'Address2', city: 'City', state: 'State', zipCode: 'Zip' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false });
  assert.equal(possibleMultiMemberWarning(headers, resolved, m), null);
});

test('ID siblings but no name siblings: name rail blocks the explode, warns variant (a)', () => {
  // Exploding here would manufacture blank-name members that all fail validation.
  // The rail reports idSiblings so the warning can say the ID columns WERE found.
  const headers = ['VoterID1', 'VoterID2', 'DOB1', 'DOB2', 'FirstName', 'LastName', 'Addr'];
  const resolved = { stateVoterId: 'VoterID1', dateOfBirth: 'DOB1',
    firstName: 'FirstName', lastName: 'LastName', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false, idSiblings: true });
  const w = possibleMultiMemberWarning(headers, resolved, m);
  assert.equal(w.type, 'possible_multi_member');
  assert.equal(w.field, 'stateVoterId');
  assert.equal(w.column, 'VoterID1');
  // Variant (a): renameable — and it names the actual offending columns.
  assert.match(w.detail, /Rename the extra columns to end in 2, 3/);
  assert.match(w.detail, /VoterID2/);
  assert.match(w.detail, /DOB2/);
  assert.match(w.detail, /Fewer doors than file rows\?/);
});

test('name siblings without ID siblings: warns variant (b) — a vendor request, not a mapping fix', () => {
  const headers = ['VoterID', 'FirstName1', 'FirstName2', 'LastName1', 'LastName2', 'Addr'];
  const resolved = { stateVoterId: 'VoterID', firstName: 'FirstName1', lastName: 'LastName1', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false });
  const w = possibleMultiMemberWarning(headers, resolved, m);
  assert.equal(w.type, 'possible_multi_member');
  assert.equal(w.field, 'firstName');
  assert.equal(w.column, 'FirstName1');
  assert.match(w.detail, /cannot be imported/);
  assert.match(w.detail, /Ask your vendor/);
  assert.match(w.detail, /FirstName2/);
  assert.match(w.detail, /Fewer doors than file rows\?/);
});

test('only ONE voter field with siblings: below threshold, no warning', () => {
  // Two mapped phone columns are the classic stray: phone → Phone1 sees Phone2 as
  // a sibling, but nothing corroborates, so it never nags.
  const headers = ['VoterID', 'FirstName', 'LastName', 'Phone1', 'Phone2', 'Addr'];
  const resolved = { stateVoterId: 'VoterID', firstName: 'FirstName', lastName: 'LastName',
    phone: 'Phone1', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false });
  assert.equal(possibleMultiMemberWarning(headers, resolved, m), null);
});

test('slot-numbered contact columns on a single-voter file: two sibling fields, still no warning', () => {
  // The identity gate. Ranked phone slots number SEVERAL contact fields in
  // lockstep (Phone1/Phone2 + PhoneType1/PhoneType2 — a shape suggestMapping
  // auto-maps with zero operator error), so the two-field threshold alone would
  // red-flag a healthy one-voter-per-row export. Neither names nor IDs have
  // siblings here, so nothing is describing people — silence.
  const headers = ['VoterID', 'FirstName', 'LastName', 'Phone1', 'Phone2',
    'PhoneType1', 'PhoneType2', 'Address1', 'Address2', 'City', 'State', 'Zip'];
  const resolved = { stateVoterId: 'VoterID', firstName: 'FirstName', lastName: 'LastName',
    phone: 'Phone1', phoneType: 'PhoneType1',
    addressLine1: 'Address1', addressLine2: 'Address2', city: 'City', state: 'State', zipCode: 'Zip' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false });
  assert.equal(possibleMultiMemberWarning(headers, resolved, m), null);
  // Same story for phone + cellPhone slots (Phone1/2 + Cell1/2, also auto-mapped).
  const headers2 = ['VoterID', 'FirstName', 'LastName', 'Phone1', 'Phone2', 'Cell1', 'Cell2', 'Addr'];
  const resolved2 = { stateVoterId: 'VoterID', firstName: 'FirstName', lastName: 'LastName',
    phone: 'Phone1', cellPhone: 'Cell1', addressLine1: 'Addr' };
  const m2 = detectMembers(headers2, resolved2);
  assert.equal(possibleMultiMemberWarning(headers2, resolved2, m2), null);
});

test('two voter fields on the SAME column never name a sibling twice in the warning', () => {
  // resolveMapping permits phone and cellPhone both → Phone1; without the dedupe
  // the offenders list read "Phone2, Phone2" and the red banner looked broken.
  const headers = ['VoterID1', 'VoterID2', 'FirstName', 'LastName', 'Phone1', 'Phone2', 'Addr'];
  const resolved = { stateVoterId: 'VoterID1', firstName: 'FirstName', lastName: 'LastName',
    phone: 'Phone1', cellPhone: 'Phone1', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  const w = possibleMultiMemberWarning(headers, resolved, m);
  assert.match(w.detail, /columns like Phone2, VoterID2\)/);
});

test('the offenders list is member-major, capped at 4 headers, and ends in an ellipsis', () => {
  // Three sibling-bearing voter fields across three members: all of member 2's
  // columns first (in field-scan order), then member 3's — cut at four so a
  // 20-member file never prints eighty headers.
  const headers = ['VoterID1', 'VoterID2', 'VoterID3', 'DOB1', 'DOB2', 'DOB3',
    'Phone1', 'Phone2', 'Phone3', 'FirstName', 'LastName', 'Addr'];
  const resolved = { stateVoterId: 'VoterID1', dateOfBirth: 'DOB1', phone: 'Phone1',
    firstName: 'FirstName', lastName: 'LastName', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false, idSiblings: true }); // name rail — variant (a)
  const w = possibleMultiMemberWarning(headers, resolved, m);
  assert.equal(w.field, 'stateVoterId');
  assert.match(w.detail, /columns like Phone2, DOB2, VoterID2, Phone3, …\)/);
  // Member 3's later columns fell past the cap.
  assert.doesNotMatch(w.detail, /DOB3/);
  assert.doesNotMatch(w.detail, /VoterID3/);
});

test('non-contiguous member columns stop at the gap: ID2 present, ID3 missing, ID4 present → 2', () => {
  const headers = ['VoterID1', 'VoterID2', 'VoterID4', 'FirstName1', 'FirstName2', 'LastName1', 'LastName2'];
  const resolved = { stateVoterId: 'VoterID1', firstName: 'FirstName1', lastName: 'LastName1' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.maxMembers, 2);
});

test('member-prefix files with ranked phone slots: the member run wins, never the slot run', () => {
  // "Voter1_Phone1" holds two digit runs. Varying the RIGHTMOST (the slot) to 2
  // yields the existing "Voter1_Phone2" — member 1's OTHER phone — so the old
  // rightmost-first order silently wrote it into member 2's row. Member index
  // leads in every real prefix convention; the leftmost 1-run must win.
  const headers = ['Voter1_ID', 'Voter2_ID', 'Voter1_FirstName', 'Voter2_FirstName',
    'Voter1_LastName', 'Voter2_LastName',
    'Voter1_Phone1', 'Voter1_Phone2', 'Voter2_Phone1', 'Voter2_Phone2', 'Addr'];
  const resolved = { stateVoterId: 'Voter1_ID', firstName: 'Voter1_FirstName',
    lastName: 'Voter1_LastName', phone: 'Voter1_Phone1', cellPhone: 'Voter1_Phone2',
    addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.perMember.phone.tpl.make(2), 'Voter2_Phone1');
  assert.equal(m.perMember.cellPhone.tpl.make(2), 'Voter2_Phone2');
  const rows = [];
  explodeRow({ Voter1_ID: 'A', Voter2_ID: 'B', Voter1_FirstName: 'Al', Voter2_FirstName: 'Bo',
    Voter1_LastName: 'Ax', Voter2_LastName: 'Bx',
    Voter1_Phone1: '111-1111', Voter1_Phone2: '111-2222',
    Voter2_Phone1: '222-1111', Voter2_Phone2: '222-2222', Addr: '1 Main St' },
  resolved, m, (r) => rows.push(r));
  // Member 2's OWN phones — not member 1's second phone.
  assert.equal(rows[1].Voter1_Phone1, '222-1111');
  assert.equal(rows[1].Voter1_Phone2, '222-2222');
});

test('a ranked slot column (Phone3) never templates — member 2 gets a blank, not a sibling slot', () => {
  // The value-1 rail: varying Phone3's run to 2 hits "Phone2" — member 1's other
  // phone, not member 2's anything — and make(2)'s self-guard can't catch a
  // collision with a SIBLING. Only a run reading 1 can be member 1's own index.
  const headers = ['ID1', 'ID2', 'FN1', 'FN2', 'LN1', 'LN2', 'Phone1', 'Phone2', 'Phone3', 'Addr'];
  assert.equal(memberTemplate('Phone3', lowerHeaderIndex(headers)), null);
  const resolved = { stateVoterId: 'ID1', firstName: 'FN1', lastName: 'LN1',
    phone: 'Phone1', cellPhone: 'Phone3', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.equal(m.detected, true);
  assert.equal(m.perMember.cellPhone, undefined); // no template — stays member 1's alone
  const rows = [];
  explodeRow({ ID1: 'A', ID2: 'B', FN1: 'Al', FN2: 'Bo', LN1: 'Ax', LN2: 'Bx',
    Phone1: 'p1', Phone2: 'p2', Phone3: 'p3', Addr: '1 Main St' }, resolved, m, (r) => rows.push(r));
  assert.equal(rows[1].Phone3, undefined); // blank rather than fabricated from a slot
});

test('stateVoterId mis-mapped onto a non-first member column declines instead of duplicating member 1', () => {
  // With ID3 as the anchor, the old code minted a template whose make(3) was ID3
  // ITSELF — member 3 duplicated member 1 (hidden by the in-file dup drop) and
  // ID1's person silently vanished. The rail makes it decline, like it used to.
  const headers = ['ID1', 'ID2', 'ID3', 'ID4', 'FN1', 'FN2', 'FN3', 'FN4',
    'LN1', 'LN2', 'LN3', 'LN4', 'Addr'];
  const resolved = { stateVoterId: 'ID3', firstName: 'FN1', lastName: 'LN1', addressLine1: 'Addr' };
  const m = detectMembers(headers, resolved);
  assert.deepEqual(m, { detected: false });
  // The name siblings still trip the loud miss, so the mis-mapping isn't silent.
  const w = possibleMultiMemberWarning(headers, resolved, m);
  assert.equal(w.type, 'possible_multi_member');
});

// Shared fixture for the explode tests: two members, single-column party/gender
// and address-level fields, per-member names and IDs.
const EXPLODE_HEADERS = ['ID1', 'ID2', 'FN1', 'FN2', 'LN1', 'LN2',
  'Party', 'Gender', 'Precinct', 'Congress', 'Senate', 'House', 'Addr', 'City', 'ST', 'Zip'];
const EXPLODE_RESOLVED = { stateVoterId: 'ID1', firstName: 'FN1', lastName: 'LN1',
  party: 'Party', gender: 'Gender', precinct: 'Precinct',
  congressionalDistrict: 'Congress', stateSenateDistrict: 'Senate', stateHouseDistrict: 'House',
  addressLine1: 'Addr', city: 'City', state: 'ST', zipCode: 'Zip' };
const EXPLODE_ROW = { ID1: 'A', ID2: 'B', FN1: 'Al', FN2: 'Bo', LN1: 'Ax', LN2: 'Bx',
  Party: 'REP', Gender: 'F', Precinct: '12', Congress: '27', Senate: '8', House: '110',
  Addr: '1 Main St', City: 'Townsville', ST: 'FL', Zip: '33001' };

const runExplode = (row, headers = EXPLODE_HEADERS, resolved = EXPLODE_RESOLVED) => {
  const members = detectMembers(headers, resolved);
  assert.equal(members.detected, true);
  const outRows = [];
  explodeRow(row, resolved, members, (r) => outRows.push(r));
  return outRows;
};

test('exploded member 2 carries precinct + districts, and NO party or gender', () => {
  const rows = runExplode(EXPLODE_ROW);
  assert.equal(rows.length, 2);
  const m2 = rows[1];
  // Member 2's own identity, written under member 1's column keys.
  assert.equal(m2.ID1, 'B');
  assert.equal(m2.FN1, 'Bo');
  // Address-level facts fill down — everyone at the door shares them.
  assert.equal(m2.Precinct, '12');
  assert.equal(m2.Congress, '27');
  assert.equal(m2.Senate, '8');
  assert.equal(m2.House, '110');
  // Personal facts never do.
  assert.equal(m2.Party, undefined);
  assert.equal(m2.Gender, undefined);
  // Household columns shared as before.
  assert.equal(m2.Addr, '1 Main St');
});

test('a file that numbers its districts reads them per-member, never copied from member 1', () => {
  const headers = ['ID1', 'ID2', 'FN1', 'FN2', 'LN1', 'LN2', 'Congress1', 'Congress2', 'Addr'];
  const resolved = { stateVoterId: 'ID1', firstName: 'FN1', lastName: 'LN1',
    congressionalDistrict: 'Congress1', addressLine1: 'Addr' };
  const row = { ID1: 'A', ID2: 'B', FN1: 'Al', FN2: 'Bo', LN1: 'Ax', LN2: 'Bx',
    Congress1: '27', Congress2: '9', Addr: '1 Main St' };
  const rows = runExplode(row, headers, resolved);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].Congress1, '9'); // member 2's own district, not member 1's 27
});

test('explodeRow emits member 1 as-is and skips empty-ID members', () => {
  // ID2 blank, ID3 filled: member 2 is skipped, member 3 still comes through.
  const headers = ['ID1', 'ID2', 'ID3', 'FN1', 'FN2', 'FN3', 'LN1', 'LN2', 'LN3', 'Addr'];
  const resolved = { stateVoterId: 'ID1', firstName: 'FN1', lastName: 'LN1', addressLine1: 'Addr' };
  const row = { ID1: 'A', ID2: '', ID3: 'C', FN1: 'Al', FN2: '', FN3: 'Cy',
    LN1: 'Ax', LN2: '', LN3: 'Cx', Addr: '1 Main St' };
  const rows = runExplode(row, headers, resolved);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], row); // member 1 is the raw row object itself
  assert.equal(rows[1].ID1, 'C');
  assert.equal(rows[1].FN1, 'Cy');
});
