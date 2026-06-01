import { geometricSubdivide } from './geometricCut.js';

// Attribute key -> the denormalized Household column it groups by.
export const ATTR_COLUMN = {
  precinct: 'precinctValue',
  congressional: 'congressionalValue',
  stateSenate: 'stateSenateValue',
  stateHouse: 'stateHouseValue',
  city: 'cityValue',
  zip: 'zipValue',
  county: 'countyValue',
};

const SUBBOOK_SUFFIX = (i) => {
  // A, B, ... Z, AA, AB ...
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

// One book per distinct attribute value. Missing/blank values (and households
// flagged in cutConflicts) land in a surfaced "Unassigned" book. When capN is
// set, oversized groups are geometrically subdivided into balanced sub-books
// that stay within the attribute value.
export function attributeCut(households, { attribute, capN = null } = {}) {
  const col = ATTR_COLUMN[attribute];
  if (!col) throw new Error(`Unknown attribute: ${attribute}`);

  const groups = new Map();
  for (const h of households) {
    const key = h[col] || '__UNASSIGNED__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  const books = [];
  for (const [value, members] of groups) {
    if (value === '__UNASSIGNED__') {
      books.push({ name: 'Unassigned', households: members, unassigned: true });
      continue;
    }
    if (capN && members.length > capN) {
      const sub = geometricSubdivide(members, capN);
      sub.forEach((chunk, i) => books.push({ name: `${value} ${SUBBOOK_SUFFIX(i)}`, households: chunk }));
    } else {
      books.push({ name: String(value), households: members });
    }
  }
  return books;
}
