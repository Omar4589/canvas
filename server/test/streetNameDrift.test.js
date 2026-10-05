import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as server from '../src/utils/streetName.js';
import { STREET_WORDS as SERVER_STREET_WORDS } from '../src/utils/normalizeAddress.js';

// The same-street-address key (docs/PROPOSAL_PLACEHOLDER_PINS.md §D). The server copy decides what a
// shared map spot is, what "Whole building" moves and what Remove apartments takes; the web copy groups
// Pin Fixes rows the same way. The web file is plain ESM with no React imports, so it loads in node
// (the metricHelp.test.js pattern). The case table is the measured reference: 130 stackBaseOf cases,
// 55 isUnitAddress cases and 25 homeKeyOf pairs, checked across the eleven voter files on disk.
const here = path.dirname(fileURLToPath(import.meta.url));
const web = await import(path.resolve(here, '../../client/src/lib/streetName.js'));

const L1 = (l, e) => [{ addressLine1: l }, e];
const H = (a1, a2) => ({ addressLine1: a1, addressLine2: a2 });

const cases = [
 // revision 3's 46 cases, unchanged
 ['5001 E Monte Penne Way','5001 EAST MONTE PENNE WAY'], ['1801 Crawford Way Spc 205','1801 CRAWFORD WAY'], ['1801 Crawford Way Side B17','1801 CRAWFORD WAY'],
 ['100 Main St Bldg 3 Apt 101','100 MAIN STREET'], ['100 Main St Apt 5 B','100 MAIN STREET'], ['100 Main St Apt5','100 MAIN STREET'], ['100 Main St PH 2','100 MAIN STREET'],
 ['100 Main St Rear','100 MAIN STREET'], ['100 Main St Uppr','100 MAIN STREET'], ['100 Main St Lbby K25','100 MAIN STREET'], ['100 Main St Sp 12','100 MAIN STREET'],
 ['100 Main St Space 12','100 MAIN STREET'], ['100 Lake Side Dr','100 LAKE SIDE DRIVE'], ['100 Space Center Blvd','100 SPACE CENTER BOULEVARD'], ['100 Main Street','100 MAIN STREET'],
 ['123 N Main St','123 NORTH MAIN STREET'], ['123 North Main Street','123 NORTH MAIN STREET'], ['123A Main St','123 MAIN STREET'], ['123 1/2 Main St','123 MAIN STREET'],
 ['100 Main St #4','100 MAIN STREET'], ['1101 S Nevada Highway 160 Unit 627','1101 SOUTH NEVADA HIGHWAY 160'], ['1101 S Nevada Highway 160 Ste 477','1101 SOUTH NEVADA HIGHWAY 160'],
 ['4621 N Oak St','4621 NORTH OAK STREET'], ['100 Front St','100 FRONT STREET'], ['100 Rear Rd','100 REAR ROAD'], ['5870 Homestead Rd Side 60','5870 HOMESTEAD ROAD'], ['1 Sp Rd','1 SP ROAD'],
 ['100 Main St Unit B','100 MAIN STREET'], ['100 Main St Apt B-2','100 MAIN STREET'], ['200 Ocean Front','200 OCEAN FRONT'],
 ['12-A Oak Ct','12 OAK COURT'], ['12-B Oak Ct','12 OAK COURT'], ['12 - A Oak Ct','12 OAK COURT'], ['123-45 Main St','123-45 MAIN STREET'], ['12 A St','12 A STREET'],
 ['100 Main St#4','100 MAIN STREET'], ['123 Main St # 4','123 MAIN STREET'], ['100 W Side','100 WEST SIDE'], ['100 Main St Side','100 MAIN STREET SIDE'],
 ['100 Cedar Fls','100 CEDAR FLS'], ['100 Unity','100 UNITY'], ['100 Front','100 FRONT'], ['100 Pier Ave','100 PIER AVENUE'], ['100 Harbor Dr Slip 12','100 HARBOR DRIVE'],
 ['100 Airport Rd Hngr 5','100 AIRPORT ROAD'], ['100 Main St Dept 4','100 MAIN STREET'],
 // round 3: unit ids today's code accepts (R3-5)
 ['100 Main St Apt Upper','100 MAIN STREET'], ['100 Main St Apt PH2','100 MAIN STREET'], ['100 Main St Unit AB12','100 MAIN STREET'], ['100 Main St Unit 9/9','100 MAIN STREET'],
 ['100 Main St Lot AB','100 MAIN STREET'], ['100 Main St Apt 104AB','100 MAIN STREET'], ['100 Main St Apt B2-104','100 MAIN STREET'], ['100 Main St Unit 104-1-A','100 MAIN STREET'],
 ['100 Main St Apt 12C1','100 MAIN STREET'], ['100 Main St Apt N','100 MAIN STREET'],
 // round 3: streets that look like units (R3-5 and the street-type id guard)
 ['1234 RM 2222','1234 RM 2222'], ['100 Lot Rd','100 LOT ROAD'], ['100 Forest Floor Dr','100 FOREST FLOOR DRIVE'], ['100 Lake Lot Dr Apt 5','100 LAKE LOT DRIVE'], ['100 Elbow Room Rd','100 ELBOW ROOM ROAD'],
 // round 3: every with-id word, every glued form, ½, punctuation (R3-23)
 ['100 Main St Apartment 5','100 MAIN STREET'], ['100 Main St Suite 200','100 MAIN STREET'], ['100 Main St Building C','100 MAIN STREET'], ['900 Aqua Isles Blvd Lot 12','900 AQUA ISLES BOULEVARD'],
 ['5001 Hwy 160 Trlr 4','5001 HIGHWAY 160'], ['5001 Hwy 160 Trailer 4','5001 HIGHWAY 160'], ['100 Main St Rm 12','100 MAIN STREET'], ['100 Main St Room 12','100 MAIN STREET'],
 ['100 Main St Fl 3','100 MAIN STREET'], ['100 Main St Floor 3','100 MAIN STREET'],
 ['100 Main St Unit3B','100 MAIN STREET'], ['100 Main St Ste4','100 MAIN STREET'], ['1801 Crawford Way Spc12','1801 CRAWFORD WAY'], ['900 Aqua Isles Blvd Lot7','900 AQUA ISLES BOULEVARD'], ['100 Main St Bldg2','100 MAIN STREET'],
 ['123½ Main St','123 MAIN STREET'], ['100 Main St., Apt. 5','100 MAIN STREET'],
 // round 3: the folds, the character class, the standalone forms (R3-22, R3-38)
 ['123A Ocean Front','123 OCEAN FRONT'], ['12-A Ocean Front','12 OCEAN FRONT'], ['123 1/2 Ocean Front','123 OCEAN FRONT'], ['123½ Ocean Front','123 OCEAN FRONT'],
 ['5B Lake Front','5 LAKE FRONT'], ['100A Front','100 FRONT'], ['123A Main St Rear','123 MAIN STREET'], ['100 Cedar Loop Rear','100 CEDAR LOOP'],
 ['123 Calle Peña Apt 5','123 CALLE PE A'], ['100 Broadway PH 2','100 BROADWAY'], ['200 Ocean Front 5','200 OCEAN'],
 // round 4: '#' after a designator, hyphen-glued, bare designators, 'Rear Apt', ordinal floors (R4-15)
 ['412 Elm St Apt #5','412 ELM STREET'], ['412 Elm St Apt#5','412 ELM STREET'], ['412 Elm St Apt # 5','412 ELM STREET'], ['412 Elm St Unit #3','412 ELM STREET'],
 ['412 Elm St Ste #200','412 ELM STREET'], ['900 Aqua Isles Blvd Lot #12','900 AQUA ISLES BOULEVARD'], ['1801 Crawford Way Spc #205','1801 CRAWFORD WAY'],
 ['412 Elm St Apt','412 ELM STREET'], ['412 Elm St Apt-5','412 ELM STREET'], ['412 Elm St Rear Apt','412 ELM STREET'], ['412 Elm St 2nd Floor','412 ELM STREET'],
 ['412 Elm St 3rd Fl','412 ELM STREET'], ['100 Ocean Front Apt','100 OCEAN FRONT'],
 ['100 Parking Lot','100 PARKING LOT'], ['100 County Lot','100 COUNTY LOT'], ['100 Lot','100 LOT'],
 // round 5: every with-id word glued by '-', '/' or '.', the street-type id after a street ending, a leading '#', marina slips (R5-17, R5-18, R5-31)
 ['412 Elm St Apt-B','412 ELM STREET'], ['412 Elm St Unit-A','412 ELM STREET'], ['412 Elm St Bldg-C','412 ELM STREET'], ['412 Elm St Lot-A12','412 ELM STREET'],
 ['412 Elm St Suite-200','412 ELM STREET'], ['412 Elm St Trlr-5','412 ELM STREET'], ['412 Elm St Rm-5','412 ELM STREET'], ['412 Elm St Fl-2','412 ELM STREET'],
 ['412 Elm St Apartment-5','412 ELM STREET'], ['412 Elm St Apt-12-3','412 ELM STREET'], ['412 Elm St Apt/5','412 ELM STREET'], ['412 Elm St Apt.-5','412 ELM STREET'],
 ['412 Elm St Ste/5','412 ELM STREET'], ['412 Elm St Apt-12-B','412 ELM STREET'],
 ['1234 NW 5th Ln Apt Pt','1234 NORTHWEST 5TH LANE'], ['1234 NW 5th Ct Apt Ct','1234 NORTHWEST 5TH COURT'], ['1234 Old Mill Way Fl Way','1234 OLD MILL WAY'],
 ['1234 SW 9th Apt St','1234 SOUTHWEST 9TH APT STREET'],
 ['#5 412 Elm St','5 412 ELM STREET'],
 ['200 Harbor Dr Slip 12','200 HARBOR DRIVE'], ['100 Slip 5','100 SLIP 5'], ['100 Truck Stop Rd','100 TRUCK STOP ROAD'], ['100 Pier A','100 PIER A'],
 // round 6: two joined designators on one line (R6-18)
 ['100 Main St Bldg-3 Apt-B','100 MAIN STREET'], ['100 Main St Bldg-C Unit-A','100 MAIN STREET'],
];

test('stackBaseOf: the 130-case table, on the server and the web copy alike', () => {
  assert.equal(cases.length, 130);
  for (const [line, want] of cases) {
    assert.equal(server.stackBaseOf(line), want, `server: ${line}`);
    assert.equal(web.stackBaseOf(line), want, `web: ${line}`);
  }
});

test('the web copy reads the same word lists and street table as the server', () => {
  assert.deepEqual(web.STREET_WORDS, SERVER_STREET_WORDS);
  for (const name of ['DIRECTIONALS', 'EXTRA_STREET_TYPES', 'WITH_ID', 'GUARDED', 'STANDALONE']) {
    assert.deepEqual(web[name], server[name], name);
  }
});

test('one probe per street-word abbreviation reads the same on both tiers', () => {
  for (const abbr of Object.keys(SERVER_STREET_WORDS)) {
    for (const line of [`100 Oak ${abbr}`, `100 ${abbr} Oak St Apt 4`, `100 Oak ${abbr} Unit 2B`]) {
      assert.equal(web.stackBaseOf(line), server.stackBaseOf(line), line);
      assert.deepEqual(web.stripUnits(line), server.stripUnits(line), line);
    }
  }
});

const units = [
  // revision 3's 16
  L1('123 Main St # 4',true), L1('100 Main St#4',true), L1('100 Main St Apt 2',true), L1('100 Main St Spc 5',true), L1('100 Main St PH 2',true), L1('100 Main St Rear',true), L1('100 Airport Rd Hngr 5',true), L1('100 Main St Dept 4',true),
  L1('5001 E Monte Penne Way',false), L1('100 Rear Rd',false), L1('100 Front St',false), L1('100 Lake Side Dr',false), L1('200 Ocean Front',false), L1('100 Pier Ave',false), L1('12-A Oak Ct',false), L1('100 Unity',false),
  // round 3: line 2 (R3-23)
  [{ addressLine1: '100 Main St', addressLine2: 'Apt 4' }, true], [{ addressLine1: '100 Main St', addressLine2: '   ' }, false],
  // round 3: folds are not units (R3-22, R3-38)
  L1('123A Ocean Front',false), L1('12-A Ocean Front',false), L1('123 1/2 Ocean Front',false), L1('123½ Ocean Front',false), L1('5B Lake Front',false), L1('100A Front',false),
  L1('5B Lower',false), L1('5B Lake Office',false), L1('5B Penthouse',false), L1('123A Main St Rear',true), L1('100 Cedar Loop Rear',true),
  // round 3: ids today's code accepts, and streets that look like units (R3-5)
  L1('100 Main St Apt Upper',true), L1('100 Main St Apt B2-104',true), L1('100 Main St Unit 104-1-A',true), L1('100 Main St Lot AB',true),
  L1('1234 RM 2222',false), L1('100 Lot Rd',false), L1('100 Forest Floor Dr',false), L1('100 Elbow Room Rd',false),
  // round 4 (R4-15)
  L1('412 Elm St Apt #5',true), L1('412 Elm St Apt-B',true), L1('412 Elm St Suite-200',true), L1('412 Elm St Apt/5',true), L1('1234 NW 5th Ln Apt Pt',true), L1('1234 SW 9th Apt St',false),
  L1('#5 412 Elm St',true), L1('200 Harbor Dr Slip 12',true), L1('100 Slip 5',false), L1('100 Pier A',false), L1('412 Elm St Apt',true), L1('412 Elm St Apt-5',true), L1('412 Elm St Rear Apt',true), L1('412 Elm St 2nd Floor',true),
  L1('100 Ocean Front Apt',true), L1('100 Parking Lot',false), L1('100 County Lot',false),
  // round 6 (R6-18)
  L1('100 Main St Bldg-3 Apt-B',true),
];

test('isUnitAddress: the 55-case table (server only)', () => {
  assert.equal(units.length, 55);
  for (const [h, want] of units) assert.equal(server.isUnitAddress(h), want, JSON.stringify(h));
});

const same = [
  [H('12 Pine St'), H('12 Pine Street')], [H('100 Main St Apt 5'), H('100 Main Street', 'Apt 5')], [H('100 Main St Apt 5'), H('100 Main St #5')],
  [H('100 Main St Apt 5'), H('100 Main St Unit 5')], [H('100 Main St Apt 5'), H('100 Main St Apt-5')], [H('12-A Oak Ct'), H('12A Oak Ct')],
  [H('123 1/2 Main St'), H('123½ Main St')], [H('100 Main St Bldg-3 Apt-B'), H('100 Main St Bldg 3', 'Apt B')], [H('1801 Crawford Way Spc 205'), H('1801 Crawford Way Space 205')],
  [H('5001 E Monte Penne Way'), H('5001 East Monte Penne Way')], [H('200 Oak St Apt A'), H('200 Oak Street Apt A')],
  [H('100 Main St Bldg 1-101'), H('100 Main St Bldg 1 Apt 101')], [H('100 Main St Apt 5B'), H('100 Main St Apt 5 B')], [H('100 Main St Apt 5B'), H('100 Main St Apt 5-B')],
];
const differ = [
  [H('100 Main St Apt 5'), H('100 Main St Apt 6')], [H('12-A Oak Ct'), H('12-B Oak Ct')], [H('123 Main St'), H('123 1/2 Main St')], [H('123 Main St'), H('123A Main St')],
  [H('100 Main St'), H('100 Main St Rear')], [H('100 Main St'), H('100 Main St Apt 1')], [H('5001 E Monte Penne Way'), H('5011 E Monte Penne Way')],
  [H('100 Main St PH 2'), H('100 Main St Apt 2')], [H('100 Main St Bldg 3 Apt 1'), H('100 Main St Bldg 4 Apt 1')],
  [H('100 W Main Rd 12 Lot 1-23'), H('100 W Main Rd 12 Lot 12-3')], [H('100 Main St Apt 1-101'), H('100 Main St Apt 11-01')],
];

test('homeKeyOf: one home across re-spellings; different units and houses stay apart', () => {
  assert.equal(same.length + differ.length, 25);
  for (const [a, b] of same) assert.equal(server.homeKeyOf(a), server.homeKeyOf(b), `${JSON.stringify(a)} = ${JSON.stringify(b)}`);
  for (const [a, b] of differ) assert.notEqual(server.homeKeyOf(a), server.homeKeyOf(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  // A home never spans two street addresses: its key starts with its stackBaseOf.
  for (const [a] of [...same, ...differ]) assert.ok(server.homeKeyOf(a).startsWith(`${server.stackBaseOf(a.addressLine1)}|`));
});

test('the old unit regex is untouched (packets and the repair script read it)', () => {
  assert.equal(web.UNIT_SUFFIX.source, server.UNIT_SUFFIX.source);
  assert.equal(server.baseAddressOf('1801 Crawford Way Spc 205'), '1801 Crawford Way Spc 205');
});
