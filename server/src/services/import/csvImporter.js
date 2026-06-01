import Papa from 'papaparse';
import mongoose from 'mongoose';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { ImportJob } from '../../models/ImportJob.js';
import { normalizeAddress } from '../../utils/normalizeAddress.js';
import { DEFAULT_PROFILE_MAPPING } from './canonicalFields.js';

const trimOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

function parseDob(raw) {
  if (!raw) return null;
  const t = Date.parse(raw);
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

  const lat = parseCoord(get('latitude'));
  const lng = parseCoord(get('longitude'));
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
  const headers = parsed.meta?.fields || [];
  const resolved = resolveMapping(mapping, headers);

  const totalRows = parsed.data.length;
  const errors = [];
  const validRows = [];
  const seenSvids = new Set();
  const dupSvids = new Set();

  parsed.data.forEach((raw, i) => {
    const mapped = mapRow(raw, resolved);
    const missing = missingRequired(mapped);
    if (missing.length) {
      errors.push({
        rowIndex: i + 2, // +1 header, +1 1-based
        reason: `Missing required: ${missing.join(', ')}`,
        stateVoterId: mapped.voter.stateVoterId || null,
      });
      return;
    }
    if (mapped.household.latitude == null || mapped.household.longitude == null) {
      errors.push({
        rowIndex: i + 2,
        reason: 'Missing or invalid latitude/longitude',
        stateVoterId: mapped.voter.stateVoterId || null,
      });
      return;
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
          location: { type: 'Point', coordinates: [h.longitude, h.latitude] },
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
  for (let i = 0; i < householdOps.length; i += batchSize) {
    await Household.bulkWrite(householdOps.slice(i, i + batchSize), { ordered: false });
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
  for (let i = 0; i < voterOps.length; i += batchSize) {
    await Voter.bulkWrite(voterOps.slice(i, i + batchSize), { ordered: false });
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
