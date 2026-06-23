import Papa from 'papaparse';
import mongoose from 'mongoose';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { ImportJob } from '../../models/ImportJob.js';
import { normalizeAddress } from '../../utils/normalizeAddress.js';
import { DEFAULT_PROFILE_MAPPING } from './canonicalFields.js';
import { parseUpload } from './parseUpload.js';

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
  const resolved = resolveMapping(mapping, headers && headers.length ? headers : rows[0] ? Object.keys(rows[0]) : []);

  const totalRows = rows.length;
  const errors = [];
  const validRows = [];
  const seenSvids = new Set();
  const dupSvids = new Set();

  rows.forEach((raw, i) => {
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
    if (mapped.household.latitude == null || mapped.household.longitude == null) {
      // Malformed coords (the row asserted coordinates but they're bad) → always an
      // error. Missing coords (no coord columns) survive to grouping ONLY when
      // geocoding is enabled — the geocode step then fills or drops them. With
      // geocoding off, behavior is byte-for-byte unchanged.
      const geocodeEnabled = process.env.GEOCODE_ENABLED === 'true';
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
      dupSvids.add(svid);
      return; // first occurrence wins
    }
    seenSvids.add(svid);
    validRows.push(mapped);
  });

  // Group into unique households. First row with valid coords wins.
  const householdMap = new Map();
  for (const row of validRows) {
    const normAddr = normalizeAddress(row.household);
    const existing = householdMap.get(normAddr);
    if (!existing) {
      householdMap.set(normAddr, { ...row.household, normalizedAddress: normAddr });
    } else if (existing.latitude == null && row.household.latitude != null) {
      existing.latitude = row.household.latitude;
      existing.longitude = row.household.longitude;
    }
  }

  return { totalRows, errors, validRows, householdMap, dupSvids };
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

// Explode each source row into one row per non-empty member. Per-member voter
// columns are pulled from member N and written under member 1's column key (so
// validateRows reads them via the same mapping); household columns are shared;
// non-per-member voter fields (e.g. a Party only member 1 has) are left blank for
// members 2+ rather than fabricated.
function explodeRows(rows, resolved, members) {
  const out = [];
  const idCol1 = resolved.stateVoterId;
  for (const row of rows) {
    if (nonEmpty(row[idCol1])) out.push(row); // member 1: as-is
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
      out.push(nr);
    }
  }
  return out;
}

// Advisory quality warnings surfaced in the preview (no row mutation).
function buildWarnings(rows, resolved, cellMeta, format) {
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
  // Missing coordinates — the app requires lat/long for map pins.
  const hasCoordCols = resolved.latitude && resolved.longitude;
  const anyCoords = hasCoordCols && rows.some((r) => nonEmpty(r[resolved.latitude]) && nonEmpty(r[resolved.longitude]));
  if (!anyCoords) {
    warnings.push({ type: 'missing_coordinates', column: null, field: 'latitude',
      detail: 'This file has no latitude/longitude. With geocoding enabled, the app looks up coordinates from each address during import; otherwise these rows are skipped (the app needs coordinates for map pins).' });
  }
  return warnings;
}

/**
 * Smart-import entry point: parse a CSV or XLSX buffer, detect multi-member files
 * and quality issues, optionally explode multi-member rows, then validate.
 * Returns the same shape as parseAndValidate plus a `detection` object.
 */
export async function buildImportRows(buffer, filename, mapping, { explode = true } = {}) {
  const { headers, rows, format, cellMeta } = await parseUpload(buffer, filename);
  const resolved = resolveMapping(mapping, headers);
  const warnings = buildWarnings(rows, resolved, cellMeta, format);
  const members = detectMembers(headers, resolved);

  const detection = { format, warnings, multiMember: { detected: members.detected } };
  let workRows = rows;
  if (members.detected) {
    detection.multiMember = {
      detected: true, memberCount: members.maxMembers, sourceRows: rows.length, exploded: !!explode, explodedVoters: null,
    };
    if (explode) {
      workRows = explodeRows(rows, resolved, members);
      detection.multiMember.explodedVoters = workRows.length;
    }
  }
  const validated = validateRows(workRows, mapping, headers);
  return { ...validated, detection };
}

/**
 * Upsert households + voters into the DB. Batched bulkWrites (safe past ~10k
 * rows). Voters are upserted by {organizationId, stateVoterId} so one org's
 * import never touches another org's voters (decision 13). Counts are computed
 * by countDocuments diff so they're correct even if the job is retried.
 */
export async function applyImport({ campaign, orgId, validRows, householdMap, batchSize = 2000, onProgress }) {
  const campaignId = campaign._id;
  const beforeHouseholds = await Household.countDocuments({ campaignId });
  const beforeVoters = await Voter.countDocuments({ organizationId: orgId });

  // 1. Households.
  const householdValues = Array.from(householdMap.values());
  const householdOps = householdValues.map((h) => ({
    updateOne: {
      filter: { campaignId, normalizedAddress: h.normalizedAddress },
      update: {
        $set: {
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
        },
        $setOnInsert: {
          campaignId,
          normalizedAddress: h.normalizedAddress,
          status: 'unknocked',
          isActive: true,
        },
      },
      upsert: true,
    },
  }));
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

  // 2. Resolve normalizedAddress -> _id (within this campaign).
  const houses = await Household.find(
    { campaignId, normalizedAddress: { $in: householdValues.map((h) => h.normalizedAddress) } },
    { normalizedAddress: 1 }
  );
  const addressToId = new Map(houses.map((h) => [h.normalizedAddress, h._id]));

  // 3. Voters (org-scoped upsert).
  const voterOps = validRows.map((row) => {
    const householdId = addressToId.get(normalizeAddress(row.household));
    return {
      updateOne: {
        filter: { organizationId: orgId, stateVoterId: row.voter.stateVoterId },
        update: {
          $set: { ...row.voter, householdId, organizationId: orgId },
          $setOnInsert: { surveyStatus: 'not_surveyed' },
        },
        upsert: true,
      },
    };
  });
  const insertedVoterIds = [];
  for (let i = 0; i < voterOps.length; i += batchSize) {
    const res = await Voter.bulkWrite(voterOps.slice(i, i + batchSize), { ordered: false });
    if (res?.upsertedIds) insertedVoterIds.push(...Object.values(res.upsertedIds));
    if (onProgress) {
      await onProgress({
        phase: 'voters',
        processed: Math.min(i + batchSize, voterOps.length),
        total: voterOps.length,
      });
    }
  }

  const afterHouseholds = await Household.countDocuments({ campaignId });
  const afterVoters = await Voter.countDocuments({ organizationId: orgId });
  const newHouseholds = Math.max(0, afterHouseholds - beforeHouseholds);
  const newVoters = Math.max(0, afterVoters - beforeVoters);

  return {
    uniqueVoters: validRows.length,
    uniqueHouseholds: householdMap.size,
    newHouseholds,
    newVoters,
    updatedVoters: Math.max(0, validRows.length - newVoters),
    // Exact docs inserted this run (for "undo import"). Empty on an idempotent retry.
    insertedHouseholdIds,
    insertedVoterIds,
  };
}

/**
 * Synchronous, in-process import. Retained for CLI/tests; the HTTP path enqueues
 * a job and the worker calls parseAndValidate + applyImport instead.
 */
export async function runImport({ buffer, filename, userId, campaignId, organizationId, mapping = DEFAULT_PROFILE_MAPPING }) {
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
    const counts = await applyImport({ campaign, orgId, validRows, householdMap });

    job.status = 'completed';
    job.totalRows = totalRows;
    job.uniqueVoters = counts.uniqueVoters;
    job.uniqueHouseholds = counts.uniqueHouseholds;
    job.newVoters = counts.newVoters;
    job.updatedVoters = counts.updatedVoters;
    job.newHouseholds = counts.newHouseholds;
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
