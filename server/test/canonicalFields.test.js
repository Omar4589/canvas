// Pure mapping-suggestion tests — no DB, always run.
//
// The load-bearing case: a vendor file whose headers include a literal STATE
// column must NOT get stateVoterId auto-suggested from it ('statevoterid' ⊇
// 'state' under the old bidirectional substring rule). That suggestion, if
// accepted, collapses every row into one voter via the {campaignId,
// stateVoterId} unique key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMapping, DEFAULT_PROFILE_MAPPING } from '../src/services/import/canonicalFields.js';

// Headers from the real FL-22 CSP targeting file that triggered the trap.
const CSP_HEADERS = [
  'CSP_ID', 'FIRST_NAME', 'LAST_NAME', 'ADDRESS', 'CITY', 'COUNTY', 'STATE', 'ZIP',
  'AGE', 'GENDER', 'CELL_PHONE', 'LANDLINE', 'EMAIL', 'LATITUDE', 'LONGITUDE',
  'MARKET', 'TIER', 'MESSAGE_CELL', 'MESSAGE', 'CREATIVE_ROTATION', 'SERVE_DIGITAL',
  'TEXTABLE', 'PASS_2_GOTV', 'MAIL_HOUSEHOLD',
];

test('CSP-style headers: STATE maps to state, never to stateVoterId', () => {
  const m = suggestMapping(CSP_HEADERS);
  assert.equal(m.state, 'STATE');
  assert.equal(m.stateVoterId, undefined, 'stateVoterId must stay unmapped for hand-pick');
});

test('CSP-style headers: the useful columns still auto-map', () => {
  const m = suggestMapping(CSP_HEADERS);
  assert.equal(m.firstName, 'FIRST_NAME');
  assert.equal(m.lastName, 'LAST_NAME');
  assert.equal(m.addressLine1, 'ADDRESS');
  assert.equal(m.city, 'CITY');
  assert.equal(m.zipCode, 'ZIP');
  assert.equal(m.county, 'COUNTY');
  assert.equal(m.gender, 'GENDER');
  assert.equal(m.cellPhone, 'CELL_PHONE');
  assert.equal(m.phone, 'LANDLINE');
  assert.equal(m.latitude, 'LATITUDE');
  assert.equal(m.longitude, 'LONGITUDE');
});

test('CSP-style headers: vendor-only columns are not claimed by anything', () => {
  const m = suggestMapping(CSP_HEADERS);
  const claimed = new Set(Object.values(m));
  for (const h of ['MARKET', 'TIER', 'MESSAGE_CELL', 'MESSAGE', 'CREATIVE_ROTATION', 'SERVE_DIGITAL', 'TEXTABLE', 'PASS_2_GOTV', 'MAIL_HOUSEHOLD', 'CSP_ID', 'AGE']) {
    assert.ok(!claimed.has(h), `${h} should not be auto-claimed`);
  }
});

test('built-in profile headers still fully auto-map (no regression)', () => {
  const headers = [...new Set(Object.values(DEFAULT_PROFILE_MAPPING))];
  const m = suggestMapping(headers);
  for (const [field, header] of Object.entries(DEFAULT_PROFILE_MAPPING)) {
    assert.equal(m[field], header, `${field} should auto-map to "${header}"`);
  }
});

test('long header fragments of an alias still match; short generic ones do not', () => {
  // 'Congressional Dist' ⊂ 'congressionaldistrict' — legitimate fragment.
  assert.equal(suggestMapping(['Congressional Dist']).congressionalDistrict, 'Congressional Dist');
  // 'TIER' (4 chars) must not claim anything via the fragment rule.
  assert.equal(Object.keys(suggestMapping(['TIER'])).length, 0);
});

test('short aliases (cd/sd/hd/lat) match exactly but never inside other headers', () => {
  assert.equal(suggestMapping(['CD']).congressionalDistrict, 'CD');
  assert.equal(suggestMapping(['Lat', 'Long']).latitude, 'Lat');
  // 'Plat Book' contains 'lat' — must NOT be claimed as latitude.
  assert.equal(suggestMapping(['Plat Book']).latitude, undefined);
});

test('parseVoterIdList dependency: a real Voter ID header still maps', () => {
  assert.equal(suggestMapping(['Voter ID']).stateVoterId, 'Voter ID');
  assert.equal(suggestMapping(['State Voter ID']).stateVoterId, 'State Voter ID');
});

// The header row of a real L2 "CSV_SIMPLE" export (Fulton County, GA, 2026-09). Accepting the
// old suggestion for it produced 12,324 one-voter doors with zero errors: State → the voter's
// ID (State is part of every door's address key), City → L2's city-council DISTRICT column
// ('ATLANTA CITY'), Address Line 2 → Hamlet_Community_Area ('unit' inside 'community').
const L2_HEADERS = [
  'LALVOTERID', 'Voters_Active', 'Voters_StateVoterID', 'Voters_CountyVoterID', 'Voters_FirstName',
  'Voters_MiddleName', 'Voters_LastName', 'Voters_NameSuffix', 'VoterTelephones_LandlineFormatted',
  'VoterTelephones_LandlineConfidenceCode', 'VoterTelephones_CellPhoneFormatted',
  'VoterTelephones_CellConfidenceCode', 'Residence_Addresses_AddressLine',
  'Residence_Addresses_ExtraAddressLine', 'Residence_Addresses_City', 'Residence_Addresses_State',
  'Residence_Addresses_Zip', 'Residence_Addresses_ZipPlus4', 'Voters_SequenceZigZag',
  'Voters_SequenceOddEven', 'Residence_Families_FamilyID', 'Mailing_Addresses_AddressLine',
  'Mailing_Addresses_ExtraAddressLine', 'Mailing_Addresses_City', 'Mailing_Addresses_State',
  'Mailing_Addresses_Zip', 'Mailing_Addresses_ZipPlus4', 'Mailing_Families_FamilyID', 'Voters_Gender',
  'Voters_Age', 'Voters_BirthDate', 'Parties_Description', 'AbsenteeTypes_Description',
  'Voters_CalculatedRegDate', 'Ethnic_Description', 'EthnicGroups_EthnicGroup1Desc',
  'US_Congressional_District', 'State_Senate_District', 'State_House_District', 'County', 'Precinct',
  'County_Commissioner_District', 'County_Supervisorial_District', 'City',
  'City_Council_Commissioner_District', 'City_Ward', 'Town_District', 'Town_Ward', 'Town_Council',
  'Village', 'Village_Ward', 'Township', 'Township_Ward', 'Borough', 'Borough_Ward',
  'Hamlet_Community_Area',
];

test('L2 export: every field maps to the residence column and the state-issued ID', () => {
  assert.deepEqual(suggestMapping(L2_HEADERS), {
    // The state's number, not L2's LALVOTERID: an early-vote list keyed on the state's
    // registration number can only match voters imported under it.
    stateVoterId: 'Voters_StateVoterID',
    firstName: 'Voters_FirstName',
    lastName: 'Voters_LastName',
    phone: 'VoterTelephones_LandlineFormatted',
    cellPhone: 'VoterTelephones_CellPhoneFormatted',
    party: 'Parties_Description',
    gender: 'Voters_Gender',
    dateOfBirth: 'Voters_BirthDate',
    registrationStatus: 'Voters_Active',
    congressionalDistrict: 'US_Congressional_District',
    stateSenateDistrict: 'State_Senate_District',
    stateHouseDistrict: 'State_House_District',
    precinct: 'Precinct',
    // No Address Line 2: L2 keeps the unit in the address line ('4055 Northside Dr NW Apt 25'),
    // and its ExtraAddressLine only echoes that line's last word ('Bsmt') — never a unit column.
    addressLine1: 'Residence_Addresses_AddressLine',
    city: 'Residence_Addresses_City',
    state: 'Residence_Addresses_State',
    zipCode: 'Residence_Addresses_Zip',
    county: 'County',
  });
});

test("'state' found only inside another field's longer name is that field's hit", () => {
  // The only 'state' in this header is part of 'statevoterid' — the ID's, not the State's.
  const m = suggestMapping(['Official StateVoterID']);
  assert.equal(m.state, undefined);
  assert.equal(m.stateVoterId, 'Official StateVoterID');
  // A district column never lends its 'state' to State either…
  assert.equal(suggestMapping(['Official State Senate Districts']).state, undefined);
  // …while a real state column still reads as one.
  assert.equal(suggestMapping(['Voters_StateVoterID', 'Res State']).state, 'Res State');
});

test('four-letter aliases must be whole words of the header', () => {
  assert.equal(suggestMapping(['Hamlet_Community_Area']).addressLine2, undefined);
  assert.equal(suggestMapping(['Ethnicity']).city, undefined);
  assert.equal(suggestMapping(['Township']).city, undefined);
  // As words — or run together as their own alias — they still match.
  assert.equal(suggestMapping(['Unit Number']).addressLine2, 'Unit Number');
  assert.equal(suggestMapping(['UNITNUMBER']).addressLine2, 'UNITNUMBER');
  assert.equal(suggestMapping(['RESIDENCE_APT_UNIT_NBR']).addressLine2, 'RESIDENCE_APT_UNIT_NBR');
  assert.equal(suggestMapping(['Res_City']).city, 'Res_City');
  assert.equal(suggestMapping(['Cellular']).cellPhone, 'Cellular');
});

test('the more specific name wins over file order', () => {
  assert.equal(suggestMapping(['City', 'Residential City']).city, 'Residential City');
  assert.equal(suggestMapping(['Voter ID', 'State Voter ID']).stateVoterId, 'State Voter ID');
  // 'phone' also sits inside 'Telephones' on a CELL column; the landline outranks it.
  const m = suggestMapping(['Telephones_Cell', 'Telephones_Landline']);
  assert.equal(m.phone, 'Telephones_Landline');
});

test('a registration NUMBER is an ID; a registration date or status is not', () => {
  assert.equal(suggestMapping(['Voter Registration #']).stateVoterId, 'Voter Registration #');
  assert.equal(suggestMapping(['REGISTRATION_NUMBER']).stateVoterId, 'REGISTRATION_NUMBER');
  assert.equal(suggestMapping(['Voter Registration Date']).stateVoterId, undefined);
  const status = suggestMapping(['Voter Registration Status']);
  assert.equal(status.stateVoterId, undefined);
  assert.equal(status.registrationStatus, 'Voter Registration Status');
});

test('a header that is a fragment of several fields is claimed by none', () => {
  // 'residence' is part of residencecity, residencestate, residencezip, residenceaddress.
  assert.deepEqual(suggestMapping(['Residence']), {});
  // 'voters' is also part of L2's 'votersstatevoterid' — exact-only, so never the fragment's owner.
  assert.equal(suggestMapping(['Voters']).stateVoterId, undefined);
});

test('parseVoterIdList dependency: an early-vote list picks the state-issued ID column', () => {
  // L2 format: both IDs present — the one an L2 voter import now maps as State Voter ID.
  assert.equal(
    suggestMapping(['LALVOTERID', 'Voters_StateVoterID', 'Voters_FirstName']).stateVoterId,
    'Voters_StateVoterID'
  );
  // L2's ID alone is still found.
  assert.equal(suggestMapping(['LALVOTERID', 'Voters_FirstName']).stateVoterId, 'LALVOTERID');
});
