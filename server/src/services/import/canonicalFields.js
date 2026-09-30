// The canonical internal schema that all vendor CSVs map into. Admins map each
// of these to a column in their export (i360, L2, a state file, …); required
// fields must be mapped or the import is rejected.

export const CANONICAL_FIELDS = [
  // Voter identity
  { key: 'stateVoterId', label: 'State Voter ID', required: true, group: 'voter' },
  { key: 'firstName', label: 'First Name', required: true, group: 'voter' },
  { key: 'lastName', label: 'Last Name', required: true, group: 'voter' },
  { key: 'uid', label: 'UID', required: false, group: 'voter' },
  // Voter contact / demographics
  { key: 'phone', label: 'Phone', required: false, group: 'voter' },
  { key: 'phoneType', label: 'Phone Type', required: false, group: 'voter' },
  { key: 'cellPhone', label: 'Cell Phone', required: false, group: 'voter' },
  { key: 'party', label: 'Party', required: false, group: 'voter' },
  { key: 'gender', label: 'Gender', required: false, group: 'voter' },
  { key: 'dateOfBirth', label: 'Date of Birth', required: false, group: 'voter' },
  { key: 'registrationStatus', label: 'Registration Status', required: false, group: 'voter' },
  { key: 'registeredState', label: 'Registered State', required: false, group: 'voter' },
  // Voter geography
  { key: 'congressionalDistrict', label: 'Congressional District', required: false, group: 'voter' },
  { key: 'stateSenateDistrict', label: 'State Senate District', required: false, group: 'voter' },
  { key: 'stateHouseDistrict', label: 'State House District', required: false, group: 'voter' },
  { key: 'precinct', label: 'Precinct', required: false, group: 'voter' },
  // Household address
  { key: 'addressLine1', label: 'Address', required: true, group: 'household' },
  { key: 'addressLine2', label: 'Address Line 2', required: false, group: 'household' },
  { key: 'city', label: 'City', required: true, group: 'household' },
  { key: 'state', label: 'State', required: true, group: 'household' },
  { key: 'zipCode', label: 'Zip Code', required: true, group: 'household' },
  { key: 'county', label: 'County', required: false, group: 'household' },
  // Household coordinates — OPTIONAL to map. A file with no coord columns is allowed through;
  // per-row, coords are either geocoded from the address (when GEOCODE_ENABLED) or the row is
  // skipped as bad_coords. (The per-row missingRequired check never required these anyway.)
  { key: 'latitude', label: 'Latitude', required: false, group: 'household' },
  { key: 'longitude', label: 'Longitude', required: false, group: 'household' },
];

export const REQUIRED_FIELDS = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.key);

// Built-in profile matching the original hardcoded importer (the current vendor
// file). Seeded per-org so existing imports keep working with zero mapping.
export const DEFAULT_PROFILE_MAPPING = {
  stateVoterId: 'State Voter ID',
  firstName: 'First Name',
  lastName: 'Last Name',
  uid: 'uid',
  phone: 'Phone',
  phoneType: 'Phone Type',
  cellPhone: 'Cell Phone',
  party: 'Party',
  gender: 'Gender',
  dateOfBirth: 'Date of Birth',
  registrationStatus: 'Registration Status',
  registeredState: 'Registered State',
  congressionalDistrict: 'Official Congressional Districts',
  stateSenateDistrict: 'Official State Senate Districts',
  stateHouseDistrict: 'Official State House District',
  precinct: 'Precinct',
  addressLine1: 'Address',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'Registered State',
  zipCode: 'Zip Code',
  county: 'County',
  latitude: 'p_Latitude',
  longitude: 'p_Longitude',
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Normalized aliases used to auto-suggest a mapping from a vendor's headers. ORDER IS PRIORITY:
// every pass takes the first alias that finds a header, so the most specific name leads — a
// residential column beats a bare one, a state-issued ID beats a generic 'voterid', and a
// landline beats 'phone' (which also sits inside 'Telephones' on a vendor's CELL column).
const FIELD_ALIASES = {
  stateVoterId: ['statevoterid', 'sosvoterid', 'statefileid', 'voterfileid', 'voterid'],
  firstName: ['firstname', 'first', 'fname', 'givenname'],
  lastName: ['lastname', 'last', 'lname', 'surname'],
  // Only an explicit `uid` header auto-maps. Generic `id`/`personid` columns are
  // deliberately NOT matched — a loose column landing in uid would let the
  // uid-first matcher merge unrelated people across vendors. uid is a cross-org
  // person key only when the ImportProfile also declares a uidSource.
  uid: ['uid'],
  phone: ['landline', 'homephone', 'phone', 'phonenumber'],
  phoneType: ['phonetype'],
  cellPhone: ['cellphone', 'mobilephone', 'cell', 'cellular', 'mobile'],
  party: ['party', 'partyaffiliation', 'politicalparty'],
  gender: ['gender', 'sex'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday'],
  registrationStatus: ['registrationstatus', 'regstatus', 'voterstatus'],
  registeredState: ['registeredstate', 'regstate', 'votingstate'],
  congressionalDistrict: ['congressionaldistrict', 'congressionaldistricts', 'cd', 'uscongress'],
  stateSenateDistrict: ['statesenatedistrict', 'statesenatedistricts', 'sd', 'senatedistrict'],
  stateHouseDistrict: ['statehousedistrict', 'statehousedistricts', 'hd', 'housedistrict', 'assemblydistrict'],
  precinct: ['precinct', 'precinctname', 'precinctid', 'pct'],
  addressLine1: ['residentialaddress', 'residenceaddress', 'streetaddress', 'addressline1', 'address1', 'address'],
  addressLine2: ['addressline2', 'address2', 'unitnumber', 'aptnumber', 'unit', 'apt', 'apartment'],
  city: ['residentialcity', 'residencecity', 'rescity', 'city', 'town'],
  state: ['residentialstate', 'residencestate', 'state', 'registeredstate'],
  zipCode: ['residentialzip', 'residencezipcode', 'residencezip', 'zipcode', 'zip5', 'zip', 'postalcode'],
  county: ['county', 'countyname', 'residentialcounty'],
  latitude: ['latitude', 'lat', 'platitude', 'ylat', 'geolat'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'plongitude', 'xlong', 'geolng'],
};

// Whole-header names only — never matched inside a longer header or from a fragment, and ranked
// ahead of every alias above. Two kinds. One vendor's exact column names: an L2 export's own
// `City` is the city-council DISTRICT ('ATLANTA CITY' — the door's city is
// Residence_Addresses_City), and its LALVOTERID is L2's ID where an early-vote list carries the
// state's number (Voters_StateVoterID). And phrases that mean something else as PART of a header:
// 'Voter Registration Date' and 'Voter Registration Status' are not the registration number.
const EXACT_ALIASES = {
  stateVoterId: ['votersstatevoterid', 'voterregistrationnumber', 'voterregistration', 'registrationnumber'],
  phone: ['votertelephoneslandlineformatted'],
  cellPhone: ['votertelephonescellphoneformatted'],
  party: ['partiesdescription'],
  registrationStatus: ['votersactive'],
  addressLine1: ['residenceaddressesaddressline'],
  city: ['residenceaddressescity'],
  state: ['residenceaddressesstate'],
  zipCode: ['residenceaddresseszip'],
};

const namesOf = (field) => [...(EXACT_ALIASES[field.key] || []), ...(FIELD_ALIASES[field.key] || [norm(field.label)])];
const EXACT_ONLY = new Set(Object.values(EXACT_ALIASES).flat());
const ALL_NAMES = CANONICAL_FIELDS.flatMap((f) => namesOf(f).map((name) => ({ key: f.key, name })));

// For each field's name: the longer names of OTHER fields that contain it, longest first. 'state'
// sits in Voters_StateVoterID only as part of 'statevoterid' — stateVoterId's hit, not State's.
const SHADOWS = new Map(
  ALL_NAMES.map(({ key, name }) => [
    `${key}|${name}`,
    ALL_NAMES.filter((o) => o.key !== key && o.name.length > name.length && o.name.includes(name))
      .map((o) => o.name)
      .sort((a, b) => b.length - a.length),
  ])
);

// Does `alias` still occur once every longer name belonging to another field is blanked out?
// Residence_Addresses_State keeps its 'state'; Voters_StateVoterID does not.
const hitsOutsideOtherFields = (n, fieldKey, alias) => {
  let rest = n;
  for (const longer of SHADOWS.get(`${fieldKey}|${alias}`) || []) rest = rest.split(longer).join('|');
  return rest.includes(alias);
};

// An alias this short must be whole words of the header: 'unit' in Hamlet_Community_Area, 'city'
// in Ethnicity and 'town' in Township are letters inside a word, not the word.
const WORD_ALIAS_MAX = 4;

// A header's words, split at separators, case changes and letter/digit edges:
// 'Hamlet_Community_Area' → hamlet·community·area, 'CellPhone2' → cell·phone·2, 'ZIP5' → zip·5.
const wordsOf = (header) =>
  String(header ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// Is `alias` one of the words, or a run of adjacent ones ('cellphone' = cell·phone)?
const isWordRun = (words, alias) => {
  for (let i = 0; i < words.length; i += 1) {
    let run = '';
    for (let j = i; j < words.length && run.length < alias.length; j += 1) {
      run += words[j];
      if (run === alias) return true;
    }
  }
  return false;
};

/**
 * Given a vendor's column headers, propose a { canonicalField: header } mapping.
 * Three passes; each walks the field's names in priority order and the first name
 * to find a header wins (headers are tried in file order):
 *   1. exact — the header IS the name.
 *   2. inside — the header contains an alias ('officialstatehousedistrict' ⊇
 *      'statehousedistrict'). The alias is ≥4 chars, and a 4-char one must be whole
 *      words of the header; the hit must not exist only inside another field's longer
 *      name; and a header that IS some field's name is never taken.
 *   3. fragment — the header is part of an alias ('congressionaldist' ⊂
 *      'congressionaldistrict'): ≥6 chars, and a fragment of ONE field's aliases only.
 * Exact-only names skip passes 2 and 3. Each guard answers a real wrong suggestion:
 * stateVoterId → STATE collapsed a file to one voter; state → Voters_StateVoterID on
 * an L2 export made each of 12,324 voters their own door, with zero errors.
 */
export function suggestMapping(headers = []) {
  const normedHeaders = headers.map((h) => ({ header: h, n: norm(h), words: wordsOf(h) }));
  // A header that IS some field's name belongs to that field alone — it must
  // never be substring-claimed by a different field ('STATE' vs stateVoterId).
  const exactlyClaimed = new Set();
  for (const field of CANONICAL_FIELDS) {
    const names = namesOf(field);
    for (const h of normedHeaders) if (names.includes(h.n)) exactlyClaimed.add(h.n);
  }
  // A fragment of two fields' aliases ('Residence' ⊂ residencecity, residencestate, …) says
  // nothing about which field it is.
  const fragmentOwners = (h) =>
    new Set(ALL_NAMES.filter((o) => !EXACT_ONLY.has(o.name) && o.name.includes(h.n)).map((o) => o.key));
  const mapping = {};
  for (const field of CANONICAL_FIELDS) {
    const names = namesOf(field);
    const firstByPriority = (hits) => {
      for (const a of names) {
        const h = normedHeaders.find((x) => hits(x, a));
        if (h) return h;
      }
      return null;
    };
    const match =
      firstByPriority((h, a) => h.n === a) ||
      firstByPriority(
        (h, a) =>
          !exactlyClaimed.has(h.n) &&
          !EXACT_ONLY.has(a) &&
          a.length >= 4 &&
          h.n.includes(a) &&
          (a.length > WORD_ALIAS_MAX || isWordRun(h.words, a)) &&
          hitsOutsideOtherFields(h.n, field.key, a)
      ) ||
      firstByPriority(
        (h, a) =>
          !exactlyClaimed.has(h.n) &&
          !EXACT_ONLY.has(a) &&
          h.n.length >= 6 &&
          a.includes(h.n) &&
          fragmentOwners(h).size === 1
      );
    if (match) mapping[field.key] = match.header;
  }
  return mapping;
}
