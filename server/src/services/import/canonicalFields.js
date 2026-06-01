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
  // Household coordinates (required — rows without coords are rejected)
  { key: 'latitude', label: 'Latitude', required: true, group: 'household' },
  { key: 'longitude', label: 'Longitude', required: true, group: 'household' },
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

// Normalized aliases used to auto-suggest a mapping from a vendor's headers.
const FIELD_ALIASES = {
  stateVoterId: ['statevoterid', 'voterid', 'sosvoterid', 'statefileid', 'voterfileid'],
  firstName: ['firstname', 'first', 'fname', 'givenname'],
  lastName: ['lastname', 'last', 'lname', 'surname'],
  uid: ['uid', 'id', 'personid'],
  phone: ['phone', 'homephone', 'landline', 'phonenumber'],
  phoneType: ['phonetype'],
  cellPhone: ['cellphone', 'cell', 'mobile', 'mobilephone'],
  party: ['party', 'partyaffiliation', 'politicalparty'],
  gender: ['gender', 'sex'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday'],
  registrationStatus: ['registrationstatus', 'regstatus', 'voterstatus'],
  registeredState: ['registeredstate', 'regstate', 'votingstate'],
  congressionalDistrict: ['congressionaldistrict', 'congressionaldistricts', 'cd', 'uscongress'],
  stateSenateDistrict: ['statesenatedistrict', 'statesenatedistricts', 'sd', 'senatedistrict'],
  stateHouseDistrict: ['statehousedistrict', 'statehousedistricts', 'hd', 'housedistrict', 'assemblydistrict'],
  precinct: ['precinct', 'precinctname', 'precinctid', 'pct'],
  addressLine1: ['address', 'addressline1', 'streetaddress', 'residentialaddress', 'address1'],
  addressLine2: ['addressline2', 'address2', 'unit', 'apt', 'apartment'],
  city: ['city', 'residentialcity', 'town'],
  state: ['state', 'residentialstate', 'registeredstate'],
  zipCode: ['zipcode', 'zip', 'zip5', 'postalcode', 'residentialzip'],
  county: ['county', 'countyname', 'residentialcounty'],
  latitude: ['latitude', 'lat', 'platitude', 'ylat', 'geolat'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'plongitude', 'xlong', 'geolng'],
};

/**
 * Given a vendor's column headers, propose a { canonicalField: header } mapping.
 * Exact normalized matches win; otherwise the first alias substring match.
 */
export function suggestMapping(headers = []) {
  const normedHeaders = headers.map((h) => ({ header: h, n: norm(h) }));
  const mapping = {};
  for (const field of CANONICAL_FIELDS) {
    const aliases = FIELD_ALIASES[field.key] || [norm(field.label)];
    let match =
      normedHeaders.find((h) => aliases.includes(h.n)) ||
      normedHeaders.find((h) => aliases.some((a) => h.n === a)) ||
      normedHeaders.find((h) => aliases.some((a) => h.n.includes(a) || a.includes(h.n)));
    if (match) mapping[field.key] = match.header;
  }
  return mapping;
}
