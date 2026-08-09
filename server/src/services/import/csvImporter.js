import fs from 'node:fs';
import readline from 'node:readline';
import Papa from 'papaparse';
import mongoose from 'mongoose';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { ImportJob } from '../../models/ImportJob.js';
import { normalizeAddress, haversineMeters } from '../../utils/normalizeAddress.js';
import { inStateBounds } from '../../utils/stateBounds.js';
import { baseAddressOf } from '../../utils/streetName.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { classifyStackedPins } from '../../utils/stackedPins.js';
import { DEFAULT_PROFILE_MAPPING } from './canonicalFields.js';
import { streamParse } from './parseUpload.js';
import { bumpLive } from '../platform/platformStats.js';
import { IDENTITY_FIELDS, identityEq } from '../person/propagateIdentity.js';
import { suppressedAddressSet } from '../dnc/doNotKnock.js';

const trimOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

function parseDob(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Excel date serial: a date cell with no date format comes through as a bare
  // integer (e.g. 19582). A real DOB string is never a bare 4–5 digit integer,
  // so converting here is safe for the CSV path too.
  if (/^\d{4,5}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial >= 3000 && serial <= 60000) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    }
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function parseCoord(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Resolve each canonical field's vendor column to the ACTUAL header in the file
// (case-insensitively), so mapRow can read raw[actualHeader] directly.
function resolveMapping(mapping, headers) {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const resolved = {};
  for (const [field, column] of Object.entries(mapping || {})) {
    if (!column) continue;
    const actual = byNorm.get(norm(column));
    if (actual) resolved[field] = actual;
  }
  return resolved;
}

function mapRow(raw, resolved) {
  const get = (field) => {
    const key = resolved[field];
    return key ? trimOrNull(raw[key]) : null;
  };

  const firstName = get('firstName');
  const lastName = get('lastName');

  const voter = {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    phone: get('phone'),
    phoneType: get('phoneType'),
    cellPhone: get('cellPhone'),
    party: get('party'),
    gender: get('gender'),
    dateOfBirth: parseDob(get('dateOfBirth')),
    registrationStatus: get('registrationStatus'),
    registeredState: get('registeredState'),
    congressionalDistrict: get('congressionalDistrict'),
    stateSenateDistrict: get('stateSenateDistrict'),
    stateHouseDistrict: get('stateHouseDistrict'),
    precinct: get('precinct'),
    stateVoterId: get('stateVoterId'),
    uid: get('uid'),
  };

  const rawLat = get('latitude');
  const rawLng = get('longitude');
  const lat = parseCoord(rawLat);
  const lng = parseCoord(rawLng);
  const hasValidCoords =
    lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const household = {
    addressLine1: get('addressLine1'),
    addressLine2: get('addressLine2'),
    city: get('city'),
    state: get('state'),
    zipCode: get('zipCode'),
    county: get('county'),
    latitude: hasValidCoords ? lat : null,
    longitude: hasValidCoords ? lng : null,
    // Did the source row carry BOTH coord columns (valid or not)? Distinguishes a
    // malformed-coords row (→ bad_coords) from a no-coords-column row (→ geocode).
    coordsProvided: rawLat != null && rawLng != null,
  };

  return { voter, household };
}

function missingRequired(mapped) {
  const missing = [];
  if (!mapped.voter.firstName) missing.push('First Name');
  if (!mapped.voter.lastName) missing.push('Last Name');
  if (!mapped.voter.stateVoterId) missing.push('State Voter ID');
  if (!mapped.household.addressLine1) missing.push('Address');
  if (!mapped.household.city) missing.push('City');
  if (!mapped.household.state) missing.push('State');
  if (!mapped.household.zipCode) missing.push('Zip Code');
  return missing;
}

// Excel error literals ("#NUM!", "#REF!", …, with or without the leading "=" some
// exports keep): a formula that failed in the source spreadsheet, frozen into text
// on export. In the ID column these are non-empty — so they pass the required check
// — and then thousands of rows carrying the SAME literal collapse into one
// "duplicate" voter (an i360 walk file lost 37,874 of 50,440 rows this way while
// the preview read "1 duplicate"). They get their own error code instead of ever
// reaching the dedup. Mirrored client-side in ImportPage.jsx — keep in sync.
export const SPREADSHEET_ERROR_RE = /^=?#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)$/i;

/**
 * Parse a CSV string with a field mapping, validate rows, and group households.
 * Pure (no DB). Returns { totalRows, errors, validRows, householdMap, dupSvids }.
 */
export function parseAndValidate(csvString, mapping) {
  const parsed = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return validateRows(parsed.data, mapping, parsed.meta?.fields || []);
}

/**
 * Validate already-parsed rows ({header: value} objects) against a mapping and
 * group households. Pure (no DB). Shared by the CSV path (parseAndValidate) and
 * the smart-import path (buildImportRows).
 */
export function validateRows(rows, mapping, headers) {
  const v = makeRowValidator(mapping, headers && headers.length ? headers : rows[0] ? Object.keys(rows[0]) : []);
  rows.forEach((raw) => v.push(raw));
  return v.finish();
}

/**
 * The per-row validation core, extracted so the streaming path can feed it one
 * row at a time (never holding a rows array). Semantics are identical to the old
 * validateRows loop; `sink` (optional) receives each valid row instead of the
 * validRows array — when provided, finish() reports validRows: null.
 */
// ── Disagreeing coordinates across rows for ONE household ─────────────────────
//
// Several voters normally share an address, so several rows collapse into one Household.
// They are supposed to carry the same pin — but files do disagree, and the old rule was
// "first row with valid coords wins", silently. One bad row that happened to sort first
// pinned the door miles away with no error, no counter, and no second look: the geocoder
// never re-checks a door that already HAS coordinates.
//
// What replaces row order, in order: rows that round to the same ~1.1m pin aren't a
// disagreement at all; an out-of-state candidate loses to an in-state one; otherwise the
// most-voted pin wins. A genuine TIE (the classic two-rows-two-places case) keeps the first
// pin and records a conflict — it is never nulled, because a household the geocoder can't
// place is DROPPED along with its voters, and losing a door is worse than a suspect pin.
// Ties are what `npm run repair:import-pins` adjudicates offline, where it can consult the
// geocoder without drop semantics.
const COORD_CANDIDATE_CAP = 6; // bounded — this runs on the 300k-row streaming path
const COORD_AGREE_M = 150; // rooftop vs. parcel centroid is not a disagreement

const coordKeyOf = (lat, lng) => `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}`;

// Nothing is allocated until a household actually disagrees with itself — the overwhelmingly
// common "every row agrees" path only bumps an integer.
function noteCoordCandidate(conflicts, normAddr, existing, incoming) {
  const kExisting = coordKeyOf(existing.latitude, existing.longitude);
  const kIncoming = coordKeyOf(incoming.latitude, incoming.longitude);
  const list = conflicts.get(normAddr);
  if (kExisting === kIncoming) {
    existing.coordVotes += 1;
    if (list) {
      const c = list.find((x) => x.key === kIncoming);
      if (c) c.n += 1;
    }
    return;
  }
  if (!list) {
    conflicts.set(normAddr, [
      { key: kExisting, lat: existing.latitude, lng: existing.longitude, n: existing.coordVotes },
      { key: kIncoming, lat: incoming.latitude, lng: incoming.longitude, n: 1 },
    ]);
    return;
  }
  const c = list.find((x) => x.key === kIncoming);
  if (c) c.n += 1;
  else if (list.length < COORD_CANDIDATE_CAP) {
    list.push({ key: kIncoming, lat: incoming.latitude, lng: incoming.longitude, n: 1 });
  }
}

// Returns { resolved, ties } — how many households had disagreeing rows, and how many of
// those could not be decided. Mutates the winning coordinates onto the household objects.
export function resolveCoordConflicts(householdMap, conflicts) {
  let resolved = 0;
  let ties = 0;
  for (const [normAddr, candidates] of conflicts) {
    const h = householdMap.get(normAddr);
    if (!h || candidates.length < 2) continue;

    // Within noise of each other → not a disagreement; leave the door alone.
    let maxGap = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const d = haversineMeters(candidates[i].lat, candidates[i].lng, candidates[j].lat, candidates[j].lng);
        if (d > maxGap) maxGap = d;
      }
    }
    if (maxGap <= COORD_AGREE_M) continue;

    resolved += 1;
    // A coordinate outside its own state is disqualified outright — but only when that
    // leaves something. inStateBounds fails open on unknown state codes, so this is
    // insurance against the gross case, never a gate.
    const inState = candidates.filter((c) => inStateBounds(h.state, c.lat, c.lng));
    const pool = inState.length > 0 && inState.length < candidates.length ? inState : candidates;

    let best = pool[0];
    let tied = false;
    for (const c of pool.slice(1)) {
      if (c.n > best.n) {
        best = c;
        tied = false;
      } else if (c.n === best.n) {
        tied = true;
      }
    }
    if (tied) {
      // No majority and no state test to break it. Keep the first pin (never null it) and
      // record the conflict so the preview says so and the repair script can adjudicate.
      ties += 1;
      h.coordConflict = true;
      continue;
    }
    h.latitude = best.lat;
    h.longitude = best.lng;
  }
  return { resolved, ties };
}

export function makeRowValidator(mapping, headers, { sink } = {}) {
  const resolved = resolveMapping(mapping, headers || []);
  const errors = [];
  const validRows = sink ? null : [];
  const seenSvids = new Set();
  const dupSvids = new Map(); // duplicated ID value → dropped-row count (first occurrence kept)
  const householdMap = new Map();
  // normalizedAddress → candidate pins, allocated ONLY when rows disagree.
  const coordConflicts = new Map();
  let totalRows = 0;
  let validCount = 0;
  let dupRows = 0; // total rows dropped as in-file duplicates — NOT dupSvids.size
  const geocodeEnabled = process.env.GEOCODE_ENABLED === 'true';

  const push = (raw) => {
    const i = totalRows;
    totalRows += 1;
    const mapped = mapRow(raw, resolved);
    const missing = missingRequired(mapped);
    if (missing.length) {
      errors.push({
        rowIndex: i + 2, // +1 header, +1 1-based
        code: 'missing_required',
        reason: `Missing required: ${missing.join(', ')}`,
        stateVoterId: mapped.voter.stateVoterId || null,
      });
      return;
    }
    if (SPREADSHEET_ERROR_RE.test(mapped.voter.stateVoterId)) {
      // Before the dedup, or every such row after the first reads as a "duplicate".
      errors.push({
        rowIndex: i + 2,
        code: 'spreadsheet_error',
        reason: `State Voter ID is a spreadsheet error value (${mapped.voter.stateVoterId})`,
        stateVoterId: mapped.voter.stateVoterId,
      });
      return;
    }
    if (mapped.household.latitude == null || mapped.household.longitude == null) {
      // Malformed coords (the row asserted coordinates but they're bad) → always an
      // error. Missing coords (no coord columns) survive to grouping ONLY when
      // geocoding is enabled — the geocode step then fills or drops them. With
      // geocoding off, behavior is byte-for-byte unchanged.
      if (mapped.household.coordsProvided || !geocodeEnabled) {
        errors.push({
          rowIndex: i + 2,
          code: 'bad_coords',
          reason: mapped.household.coordsProvided ? 'Invalid latitude/longitude' : 'Missing latitude/longitude',
          stateVoterId: mapped.voter.stateVoterId || null,
        });
        return;
      }
    }
    const svid = mapped.voter.stateVoterId;
    if (seenSvids.has(svid)) {
      dupSvids.set(svid, (dupSvids.get(svid) || 0) + 1);
      dupRows += 1;
      return; // first occurrence wins
    }
    seenSvids.add(svid);
    validCount += 1;
    // Group into unique households as rows arrive. A later row can only FILL a missing
    // pin here; when two rows assert different pins the decision is deferred to finish()
    // (see resolveCoordConflicts) rather than settled by row order.
    const normAddr = normalizeAddress(mapped.household);
    const existing = householdMap.get(normAddr);
    if (!existing) {
      householdMap.set(normAddr, {
        ...mapped.household,
        normalizedAddress: normAddr,
        // Rows backing the current pin. One integer per household; the candidate list is
        // only allocated if a row ever disagrees.
        coordVotes: mapped.household.latitude != null ? 1 : 0,
      });
    } else if (existing.latitude == null && mapped.household.latitude != null) {
      existing.latitude = mapped.household.latitude;
      existing.longitude = mapped.household.longitude;
      existing.coordVotes = 1;
    } else if (existing.latitude != null && mapped.household.latitude != null) {
      noteCoordCandidate(coordConflicts, normAddr, existing, mapped.household);
    }
    if (sink) sink(mapped);
    else validRows.push(mapped);
  };

  const finish = () => {
    const coordConflictStats = resolveCoordConflicts(householdMap, coordConflicts);
    // Placeholder-pin detection, CROSS-household: a vendor that can't place an address stamps
    // a ZIP/area centroid, so doors from many different streets pile onto one identical dot.
    // Runs after coordinate resolution so it judges the coords that will actually be written.
    // Detection only — the coords are never nulled here: nulling would hand these doors to the
    // geocoder, which DROPS what it can't place, and placeholder-stamped addresses (rural
    // routes, brand-new streets) are exactly the ones geocoders fail on. A suspect pin walks;
    // a dropped door doesn't. repair:import-pins adjudicates them after import, cache-first,
    // with no drop semantics.
    const pinDoors = [];
    for (const [normAddr, h] of householdMap) {
      if (h.latitude == null || h.longitude == null) continue;
      // Base address (number kept, unit stripped): one house number with many units is a
      // building; many house numbers on one dot is a placeholder — even on ONE street.
      pinDoors.push({ id: normAddr, street: baseAddressOf(h.addressLine1), pinKey: buildingKeyForCoords([h.longitude, h.latitude]) });
    }
    const stacked = classifyStackedPins(pinDoors);
    return {
      totalRows,
      errors,
      validRows,
      householdMap,
      dupSvids,
      dupRows,
      validCount,
      // Households whose rows disagreed on a pin, and how many of those were a tie the
      // file itself could not settle. Surfaced in the preview/diff and on ImportJob so a
      // silent first-row-wins can never happen again.
      coordConflicts: coordConflictStats.resolved,
      coordConflictTies: coordConflictStats.ties,
      // Placeholder coordinates: pins where no street holds a majority, plus stray doors
      // parked on some other street's building. suspects.size = every door worth a second
      // look. Same preview/ImportJob plumbing as coordConflicts.
      placeholderPins: stacked.placeholderPins,
      placeholderPinDoors: stacked.suspects.size,
    };
  };
  return { push, finish, resolved };
}

// ── Smart import: Excel parsing, multi-member explode, quality detection ──────

const VOTER_FIELDS = [
  'firstName', 'lastName', 'phone', 'phoneType', 'cellPhone', 'party', 'gender',
  'dateOfBirth', 'registrationStatus', 'stateVoterId', 'uid',
  'congressionalDistrict', 'stateSenateDistrict', 'stateHouseDistrict', 'precinct',
];
const HOUSEHOLD_FIELDS = [
  'addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'county', 'latitude', 'longitude',
];

const nonEmpty = (v) => v != null && String(v).trim() !== '';

// Given member 1's actual column (e.g. "FirstName1" or "FLVoterId"), return the
// base such that base+N is member N's column — or null if there is no member-2
// sibling. Handles the mixed vendor convention where member 1 may be unsuffixed
// ("FLVoterId") or suffixed ("FirstName1").
function memberBase(col1, headerSet) {
  if (!col1) return null;
  if (/1$/.test(col1)) {
    const b = col1.replace(/1$/, '');
    if (headerSet.has(`${b}2`)) return b;
  }
  if (headerSet.has(`${col1}2`)) return col1;
  return null;
}

// Detect a multi-voter-per-row file. Anchored on the IDENTITY column
// (stateVoterId) having numbered siblings — NOT any numbered column — so address
// LINES (Address1/2/3, a household field) are never mistaken for members.
function detectMembers(headers, resolved) {
  const headerSet = new Set(headers);
  const idBase = memberBase(resolved.stateVoterId, headerSet);
  if (!idBase) return { detected: false };
  let maxMembers = 1;
  for (let n = 2; n <= 20; n += 1) {
    if (headerSet.has(idBase + n)) maxMembers = n;
    else break;
  }
  if (maxMembers < 2) return { detected: false };
  const perMember = {};
  for (const f of VOTER_FIELDS) {
    const col1 = resolved[f];
    if (!col1) continue;
    const base = memberBase(col1, headerSet);
    if (base) perMember[f] = { col1, base };
  }
  return { detected: true, maxMembers, idBase, perMember };
}

// Explode ONE source row into one row per non-empty member. Per-member voter
// columns are pulled from member N and written under member 1's column key (so
// the validator reads them via the same mapping); household columns are shared;
// non-per-member voter fields (e.g. a Party only member 1 has) are left blank for
// members 2+ rather than fabricated. Per-row so the streaming path never holds
// the exploded set.
function explodeRow(row, resolved, members, out) {
  if (nonEmpty(row[resolved.stateVoterId])) out(row); // member 1: as-is
  for (let n = 2; n <= members.maxMembers; n += 1) {
    if (!nonEmpty(row[members.idBase + n])) continue;
    const nr = {};
    for (const hf of HOUSEHOLD_FIELDS) {
      const col = resolved[hf];
      if (col) nr[col] = row[col];
    }
    for (const info of Object.values(members.perMember)) {
      nr[info.col1] = row[info.base + n] ?? '';
    }
    out(nr);
  }
}

// Advisory quality warnings surfaced in the preview (no row mutation).
// `anyCoords` is accumulated during the streaming parse — this never re-reads rows.
function buildWarnings(resolved, cellMeta, format, anyCoords) {
  const warnings = [];
  if (format === 'xlsx') {
    for (const f of ['stateVoterId', 'zipCode']) {
      const col = resolved[f];
      if (col && cellMeta[col]?.numeric) {
        warnings.push({ type: 'leading_zero_risk', column: col, field: f,
          detail: `"${col}" was stored as a number in the spreadsheet; if any values had leading zeros they may already be lost in the file.` });
      }
    }
    const dob = resolved.dateOfBirth;
    if (dob && cellMeta[dob]?.numeric) {
      warnings.push({ type: 'date_serial', column: dob, field: 'dateOfBirth',
        detail: `"${dob}" looks like Excel date serials; they are converted to real dates on import.` });
    }
  }
  if (!anyCoords) {
    warnings.push({ type: 'missing_coordinates', column: null, field: 'latitude',
      detail: 'This file has no latitude/longitude. With geocoding enabled, the app looks up coordinates from each address during import; otherwise these rows are skipped (the app needs coordinates for map pins).' });
  }
  return warnings;
}

/**
 * Smart-import entry point: stream-parse a CSV or XLSX buffer, detect multi-member
 * files and quality issues, optionally explode multi-member rows, and validate —
 * all row-at-a-time. No rows array ever exists (the 299 MB live set that OOM'd
 * the worker's 384 MB heap on a 166k-row file).
 *
 * Returns the same shape as before plus `detection`. With { spill }, valid rows
 * are appended to that NDJSON file via appendFileSync and `validRows` comes back
 * null with `validCount` set — the processor then streams the spill in batches.
 *
 * One subtlety: member detection needs headers, which the streaming parse only
 *_learns at row 1 — so the explode transform is bound lazily on the first row.
 */
export async function buildImportRows(buffer, filename, mapping, { explode = true, spill = null, maxRows, maxCells } = {}) {
  const limits = {
    maxRows: maxRows ?? Number(process.env.MAX_IMPORT_ROWS || 300000),
    maxCells: maxCells ?? Number(process.env.MAX_IMPORT_CELLS || 8000000),
  };
  let validator = null;
  let resolved = null;
  let members = { detected: false };
  let sourceRows = 0;
  let explodedVoters = 0;
  let anyCoords = false;
  const sink = spill
    ? (mapped) => fs.appendFileSync(spill, `${JSON.stringify(mapped)}\n`)
    : null;

  const handleExploded = (raw) => {
    explodedVoters += 1;
    validator.push(raw);
  };

  const { headers, format, cellMeta, totalRows } = await streamParse(buffer, filename, {
    ...limits,
    onRow: (raw) => {
      if (!validator) {
        // First row: headers are now known — bind mapping, member detection, sink.
        resolved = resolveMapping(mapping, Object.keys(raw));
        members = detectMembers(Object.keys(raw), resolved);
        validator = makeRowValidator(mapping, Object.keys(raw), sink ? { sink } : {});
      }
      sourceRows += 1;
      if (!anyCoords && resolved.latitude && resolved.longitude &&
          nonEmpty(raw[resolved.latitude]) && nonEmpty(raw[resolved.longitude])) {
        anyCoords = true;
      }
      if (members.detected && explode) explodeRow(raw, resolved, members, handleExploded);
      else validator.push(raw);
    },
  });

  if (!validator) {
    // Empty file — bind against the parsed headers so the shape is consistent.
    resolved = resolveMapping(mapping, headers);
    members = detectMembers(headers, resolved);
    validator = makeRowValidator(mapping, headers, sink ? { sink } : {});
  }

  const detection = {
    format,
    warnings: buildWarnings(resolved, cellMeta, format, anyCoords),
    multiMember: members.detected
      ? { detected: true, memberCount: members.maxMembers, sourceRows, exploded: !!explode, explodedVoters: explode ? explodedVoters : null }
      : { detected: false },
  };
  void totalRows; // the validator's own count is authoritative (explode changes it)
  return { ...validator.finish(), detection };
}

/**
 * Stream an NDJSON spill file back as row batches. One batch in memory at a time —
 * this is what keeps the worker's heap flat in file size (validRows for a 166k-row
 * file is ~160 MB live; a 2000-row batch is ~2 MB).
 */
export async function* ndjsonBatches(file, size) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let batch = [];
  for await (const line of rl) {
    if (!line) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

async function* arrayBatches(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Distinct people (stateVoterId) in the org. Voter rows are per-campaign, so a raw row
// count would double-count a person imported into two campaigns — marketing's
// votersProcessed counts people, not rows.
async function countOrgPeople(orgId) {
  const [r] = await Voter.aggregate([
    { $match: { organizationId: orgId } },
    { $group: { _id: '$stateVoterId' } },
    { $count: 'n' },
  ]);
  return r?.n || 0;
}

/**
 * Upsert households + voters into the DB. Batched bulkWrites (safe past ~10k
 * rows). Voters are upserted by {campaignId, stateVoterId} — rows are
 * PER-CAMPAIGN, so an overlapping file imported into a sibling campaign inserts
 * that campaign's own rows and never re-houses this one's. Org isolation
 * (decision 13) holds transitively: a campaign belongs to exactly one org.
 * Counts are computed by countDocuments diff so they're correct even if the
 * job is retried.
 */
export async function applyImport({ campaign, orgId, validRows, validRowsFile = null, validCount = null, householdMap, batchSize = 2000, overwriteHandEdits = false, onProgress }) {
  const campaignId = campaign._id;
  // Rows arrive either as an in-memory array (small files, CLI, tests) or as an
  // NDJSON spill file (the worker's large-file path) — batches() reads whichever
  // exists, one batch in memory at a time. rowCount drives totals + progress.
  const rowCount = validRows ? validRows.length : validCount ?? 0;
  const batches = () => (validRows ? arrayBatches(validRows, batchSize) : ndjsonBatches(validRowsFile, batchSize));
  // Migration guard: the per-campaign upsert filter below can't match a legacy row (no
  // campaignId), so it would insert a duplicate for the old unique index to reject.
  // Fail with the fix instead of a cryptic E11000 mid-write.
  if (await Voter.exists({ organizationId: orgId, campaignId: { $exists: false } })) {
    throw new Error('Voter rows predate the per-campaign migration — run: npm run migrate:voter-campaigns -- --apply');
  }
  const beforeHouseholds = await Household.countDocuments({ campaignId });
  const beforeVoters = await Voter.countDocuments({ campaignId });
  const beforeOrgPeople = await countOrgPeople(orgId);

  // 1. Households.
  const householdValues = Array.from(householdMap.values());

  // 0.5. Pin shield (the household twin of the voter hand-edit shield below). A canvasser or admin
  // who drags a door's pin to where the house actually is stamps coordSource:'corrected'
  // (services/households/updateHouseholdLocation.js) — a field-verified fact the file can't know.
  // The blind $set below used to rewrite location/coordSource on EVERY re-import, silently
  // reverting those corrections to the file's (often worse) coordinates. Prefetch the corrected
  // addresses so the write can skip them. Same discipline as the voter shield: batched $in, a
  // narrow filter so only corrected rows come back, projection of just the key. Skipped entirely
  // when the admin asked for the file to win — overwriteHandEdits governs BOTH shields, so there's
  // one keep-or-overwrite decision, not two competing toggles.
  const correctedAddresses = new Set();
  if (!overwriteHandEdits) {
    const addrs = householdValues.map((h) => h.normalizedAddress);
    for (let i = 0; i < addrs.length; i += batchSize) {
      const corrected = await Household.find(
        { campaignId, normalizedAddress: { $in: addrs.slice(i, i + batchSize) }, coordSource: 'corrected' },
        { normalizedAddress: 1 }
      ).lean();
      for (const h of corrected) correctedAddresses.add(h.normalizedAddress);
    }
  }

  // Standing do-not-knock requests covering any address in this batch. A door imported into a
  // BRAND-NEW campaign must arrive already suppressed, not be knockable until something
  // recomputes it — the address request is org-wide and predates this campaign existing. Mirrors
  // how a flagged sibling's doNotContact subdoc is seeded onto newly inserted voter rows below.
  const suppressedAddresses = await suppressedAddressSet(
    orgId,
    householdValues.map((h) => h.normalizedAddress)
  );

  let keptPins = 0;
  const householdOps = householdValues.map((h) => {
    const set = {
      organizationId: orgId,
      addressLine1: h.addressLine1,
      addressLine2: h.addressLine2,
      city: h.city,
      state: h.state,
      zipCode: h.zipCode,
      county: h.county ?? null,
      // After the geocode step every kept household has coords; this guard just
      // forecloses a [null,null] Point ever being written.
      location: h.longitude != null && h.latitude != null ? { type: 'Point', coordinates: [h.longitude, h.latitude] } : null,
      coordSource: h.coordSource || (h.longitude != null && h.latitude != null ? 'file' : null),
      coordConfidence: h.coordConfidence ?? null,
    };
    const setOnInsert = {
      campaignId,
      normalizedAddress: h.normalizedAddress,
      status: 'unknocked',
      isActive: true,
    };
    // $setOnInsert ONLY, and never in `set` above: survival for an EXISTING door is by omission,
    // the same mechanism that protects surveyStatus and doNotContact from a re-import. If
    // doNotKnock ever appears in the $set spread, every re-import silently un-suppresses every
    // door we promised never to visit again.
    if (suppressedAddresses.has(h.normalizedAddress)) setOnInsert.doNotKnock = true;
    // Corrected pin: move the location trio to $setOnInsert. The existing row keeps its
    // human-placed pin; a row deleted between the prefetch and this write still inserts complete
    // coords. A field must never appear in both operators — Mongo rejects the conflict.
    if (correctedAddresses.has(h.normalizedAddress)) {
      keptPins += 1;
      for (const f of ['location', 'coordSource', 'coordConfidence']) {
        setOnInsert[f] = set[f];
        delete set[f];
      }
    }
    return {
      updateOne: {
        filter: { campaignId, normalizedAddress: h.normalizedAddress },
        update: { $set: set, $setOnInsert: setOnInsert },
        upsert: true,
      },
    };
  });
  const insertedHouseholdIds = [];
  for (let i = 0; i < householdOps.length; i += batchSize) {
    const res = await Household.bulkWrite(householdOps.slice(i, i + batchSize), { ordered: false });
    if (res?.upsertedIds) insertedHouseholdIds.push(...Object.values(res.upsertedIds));
    if (onProgress) {
      await onProgress({
        phase: 'households',
        processed: Math.min(i + batchSize, householdOps.length),
        total: householdOps.length,
      });
    }
  }

  // 2. Resolve normalizedAddress -> _id (within this campaign). Chunk the $in and use .lean() so a
  // very large import (tens/hundreds of thousands of unique addresses) never builds one giant query
  // document or hydrates every household — matching the batched discipline used everywhere else here.
  const addressToId = new Map();
  const addrValues = householdValues.map((h) => h.normalizedAddress);
  for (let i = 0; i < addrValues.length; i += batchSize) {
    const houses = await Household.find(
      { campaignId, normalizedAddress: { $in: addrValues.slice(i, i + batchSize) } },
      { normalizedAddress: 1 }
    ).lean();
    for (const h of houses) addressToId.set(h.normalizedAddress, h._id);
  }

  // 2.5. Hand-edit shield: fetch this CAMPAIGN's armed voters among the incoming ids. An admin's
  // hand edit (routes/admin/voters.js PATCH) arms the edited identity fields in
  // locallyEditedFields — and the blind $set below used to be the one writer that ignored it,
  // silently reverting door-confirmed corrections on every re-import. Campaign-scoped because
  // arming is per-row: a sibling campaign's armed row isn't the row this upsert touches (identity
  // coherence across siblings flows through the personId fan-out, not this shield). The
  // 'locallyEditedFields.0' filter keeps this tiny (only armed voters return, typically a handful
  // even on a 100k file); it rides the unique {campaignId, stateVoterId} index. Fetched here, not
  // threaded in from the caller, so the runImport CLI entry gets the same protection as the
  // worker path.
  const SHIELD_PROJ = { stateVoterId: 1, locallyEditedFields: 1 };
  for (const f of IDENTITY_FIELDS) SHIELD_PROJ[f] = 1;
  const shieldBySvid = new Map();
  // Svid-keyed prefetches (shield + DNC): batch the $in queries straight off the
  // row batches — the svid strings themselves are the only thing retained.
  const dncBySvid = new Map();
  for await (const batch of batches()) {
    const svids = batch.map((r) => r.voter.stateVoterId);
    const shieldDocs = await Voter.find(
      { campaignId, stateVoterId: { $in: svids }, 'locallyEditedFields.0': { $exists: true } },
      SHIELD_PROJ
    ).lean();
    for (const d of shieldDocs) shieldBySvid.set(d.stateVoterId, d);
    // 2.6. DNC seeding: "never contact this person" is an ORG-wide promise but rows are
    // per-campaign — a person flagged in a sibling campaign must arrive here already
    // flagged. Prefetch flagged rows org-wide by svid and copy the full subdoc onto
    // INSERTS only ($setOnInsert — existing rows keep import-survival-by-omission, and
    // the preserved uploadId keeps an upload's undo able to revert seeded copies too).
    const dncDocs = await Voter.find(
      { organizationId: orgId, stateVoterId: { $in: svids }, 'doNotContact.flagged': true },
      { stateVoterId: 1, doNotContact: 1 }
    ).lean();
    for (const d of dncDocs) dncBySvid.set(d.stateVoterId, d.doNotContact);
  }

  // 3. Voters (org-scoped upsert). For armed rows the admin's decision governs: default keeps the
  // hand-edited values (the file's values are moved to $setOnInsert — never written over an
  // existing row, but a row deleted between the prefetch and this write still inserts complete);
  // overwriteHandEdits writes the file AND disarms exactly the shielded fields so a later import
  // updates them normally. Counts are (voter, field) instances where the values actually differed
  // — the same definition the preview's handEditConflicts uses, so preview ≈ outcome.
  let keptHandEdits = 0;
  let overwrittenHandEdits = 0;
  const opForRow = (row) => {
    const householdId = addressToId.get(normalizeAddress(row.household));
    const set = { ...row.voter, householdId, campaignId, organizationId: orgId };
    const setOnInsert = { surveyStatus: 'not_surveyed' };
    // Seeded DNC (see 2.6): only ever in $setOnInsert, never $set — a field in both
    // operators is a Mongo conflict, and $set would break import-survival-by-omission.
    const seededDnc = dncBySvid.get(row.voter.stateVoterId);
    if (seededDnc) setOnInsert.doNotContact = seededDnc;
    const update = { $set: set, $setOnInsert: setOnInsert };
    const prior = shieldBySvid.get(row.voter.stateVoterId);
    if (prior) {
      const shielded = (prior.locallyEditedFields || []).filter((f) => IDENTITY_FIELDS.includes(f));
      if (shielded.length && overwriteHandEdits) {
        for (const f of shielded) if (!identityEq(set[f], prior[f])) overwrittenHandEdits += 1;
        update.$pull = { locallyEditedFields: { $in: shielded } };
      } else if (shielded.length) {
        for (const f of shielded) {
          if (!identityEq(set[f], prior[f])) keptHandEdits += 1;
          setOnInsert[f] = set[f];
          delete set[f];
        }
        // fullName coherence for legacy rows armed on a name part but not fullName: never emit a
        // fullName stitched from a kept first name and a file last name (or vice versa).
        if (('firstName' in setOnInsert || 'lastName' in setOnInsert) && 'fullName' in set) {
          set.fullName = [set.firstName ?? prior.firstName, set.lastName ?? prior.lastName]
            .filter(Boolean)
            .join(' ');
        }
      }
    }
    return {
      updateOne: {
        filter: { campaignId, stateVoterId: row.voter.stateVoterId },
        update,
        upsert: true,
      },
    };
  };
  const insertedVoterIds = [];
  const seededDncHouseholdIds = new Set();
  let processed = 0;
  for await (const batch of batches()) {
    const ops = batch.map(opForRow);
    const res = await Voter.bulkWrite(ops, { ordered: false });
    if (res?.upsertedIds) {
      insertedVoterIds.push(...Object.values(res.upsertedIds));
      // ops was mapped 1:1 from this batch, so idx points back at the source row —
      // that's how a seeded insert finds the door needing a fullyDnc recompute.
      for (const idx of Object.keys(res.upsertedIds)) {
        const row = batch[Number(idx)];
        if (row && dncBySvid.has(row.voter.stateVoterId)) {
          const hh = addressToId.get(normalizeAddress(row.household));
          if (hh) seededDncHouseholdIds.add(String(hh));
        }
      }
    }
    processed += batch.length;
    if (onProgress) {
      await onProgress({ phase: 'voters', processed, total: rowCount });
    }
  }

  const afterHouseholds = await Household.countDocuments({ campaignId });
  const afterVoters = await Voter.countDocuments({ campaignId });
  const newHouseholds = Math.max(0, afterHouseholds - beforeHouseholds);
  const newVoters = Math.max(0, afterVoters - beforeVoters);

  // Lifetime marketing counter: PEOPLE newly added to the platform this import — the
  // distinct-svid diff, not the row diff, so importing a person already in a sibling
  // campaign adds nothing (their row is new; the person isn't). Resolves internal
  // internally; no-op for demo orgs. Backfill recounts from rows as the source of truth.
  const afterOrgPeople = await countOrgPeople(orgId);
  await bumpLive('votersProcessed', Math.max(0, afterOrgPeople - beforeOrgPeople), { orgId });

  return {
    uniqueVoters: rowCount,
    uniqueHouseholds: householdMap.size,
    newHouseholds,
    // "New to this campaign" — a person imported from a sibling campaign counts as new
    // here (their row here is new) even though the org already knew them.
    newVoters,
    updatedVoters: Math.max(0, rowCount - newVoters),
    // Hand-edit outcome: (voter, field) instances where the file disagreed with an armed edit.
    keptHandEdits,
    overwrittenHandEdits,
    // Households whose human-corrected pin this import left alone (0 when overwriteHandEdits).
    keptPins,
    // Exact docs inserted this run (for "undo import"). Empty on an idempotent retry.
    insertedHouseholdIds,
    insertedVoterIds,
    // Doors that gained an import-seeded DNC flag (see 2.6) — the caller folds these into
    // its fullyDnc recompute so an all-DNC door drops immediately, not on the next nightly.
    seededDncHouseholdIds: [...seededDncHouseholdIds],
  };
}

/**
 * Synchronous, in-process import. Retained for CLI/tests; the HTTP path enqueues
 * a job and the worker calls parseAndValidate + applyImport instead.
 */
export async function runImport({ buffer, filename, userId, campaignId, organizationId, mapping = DEFAULT_PROFILE_MAPPING, overwriteHandEdits = false }) {
  if (!campaignId || !mongoose.isValidObjectId(campaignId)) throw new Error('campaignId is required');
  const campaignFilter = { _id: campaignId };
  if (organizationId) campaignFilter.organizationId = organizationId;
  const campaign = await Campaign.findOne(campaignFilter);
  if (!campaign) throw new Error('Campaign not found');
  const orgId = campaign.organizationId;

  const job = await ImportJob.create({
    organizationId: orgId,
    campaignId: campaign._id,
    filename,
    uploadedBy: userId || null,
    status: 'parsing',
    startedAt: new Date(),
    fieldMapping: mapping,
  });

  try {
    const csv = buffer.toString('utf8');
    const { totalRows, errors, validRows, householdMap, dupSvids } = parseAndValidate(csv, mapping);
    const counts = await applyImport({ campaign, orgId, validRows, householdMap, overwriteHandEdits });

    job.status = 'completed';
    job.totalRows = totalRows;
    job.uniqueVoters = counts.uniqueVoters;
    job.uniqueHouseholds = counts.uniqueHouseholds;
    job.newVoters = counts.newVoters;
    job.updatedVoters = counts.updatedVoters;
    job.newHouseholds = counts.newHouseholds;
    job.keptHandEdits = counts.keptHandEdits;
    job.overwrittenHandEdits = counts.overwrittenHandEdits;
    job.duplicateStateVoterIds = Array.from(dupSvids);
    job.errors = errors.slice(0, 100);
    job.errorCount = errors.length;
    job.processedRows = totalRows;
    job.progress = 100;
    job.completedAt = new Date();
    await job.save();
    return job;
  } catch (err) {
    job.status = 'failed';
    job.errors = [{ reason: err.message }];
    job.errorCount = 1;
    job.completedAt = new Date();
    await job.save();
    throw err;
  }
}
