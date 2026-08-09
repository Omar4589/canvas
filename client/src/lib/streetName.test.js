import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streetOf, UNIT_SUFFIX } from './streetName.js';
import { streetOf as serverStreetOf, UNIT_SUFFIX as serverUnitSuffix } from '../../../server/src/utils/streetName.js';

// DRIFT GUARD: this file mirrors server/src/utils/streetName.js. The server copy decides which
// stacked pins the pin-repair flags; this copy decides which stacks the door panel warns about.
// Same convention as the visibility evaluator's mirror test.
test('client streetOf is byte-identical to the server implementation', () => {
  assert.equal(UNIT_SUFFIX.source, serverUnitSuffix.source);
  assert.equal(UNIT_SUFFIX.flags, serverUnitSuffix.flags);
  const probes = [
    '845 Collier Ct Apt 104',
    '900 Aqua Isles Blvd Lot G1',
    '1000 Lely Palms Dr Apt 151',
    '940 Cape Marco Dr Unit 1806',
    '19007 Broad Shore Walk',
    '2960 N State Road 29',
    '123 Main St # 4',
    '  ',
    null,
  ];
  for (const p of probes) assert.equal(streetOf(p), serverStreetOf(p), String(p));
});

test('units baked into line1 collapse to one street — the case that misfired the panel warning', () => {
  // A real tower's raw lines all differ; its STREET is one. 6,344 rows in the FL-22 file.
  assert.equal(streetOf('845 Collier Ct Apt 104'), streetOf('889 Collier Ct Apt 205'));
  assert.equal(streetOf('845 Collier Ct Apt 104'), 'Collier Ct');
});

test('different streets stay different', () => {
  assert.notEqual(streetOf('370 Mahogony Ct'), streetOf('800 Gen Chesty Puller Ct'));
});
