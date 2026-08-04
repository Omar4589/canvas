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
