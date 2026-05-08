import Papa from 'papaparse';
import mongoose from 'mongoose';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { ImportJob } from '../../models/ImportJob.js';
import { normalizeAddress } from '../../utils/normalizeAddress.js';

const REQUIRED_HEADERS = [
  'First Name',
  'Last Name',
  'Address',
  'City',
  'Registered State',
  'Zip Code',
  'State Voter ID',
];

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

function mapRow(raw) {
  const r = {};
  for (const [k, v] of Object.entries(raw)) r[k.trim()] = trimOrNull(v);

  const voter = {
    firstName: r['First Name'],
    lastName: r['Last Name'],
    fullName: [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
    phone: r['Phone'],
    phoneType: r['Phone Type'],
    cellPhone: r['Cell Phone'],
    party: r['Party'],
    gender: r['Gender'],
    dateOfBirth: parseDob(r['Date of Birth']),
    registrationStatus: r['Registration Status'],
    registeredState: r['Registered State'],
    congressionalDistrict: r['Official Congressional Districts'],
    stateSenateDistrict: r['Official State Senate Districts'],
    stateHouseDistrict: r['Official State House District'],
    precinct: r['Precinct'],
    stateVoterId: r['State Voter ID'],
    uid: r['uid'],
  };

  const lat = parseCoord(r['p_Latitude']);
  const lng = parseCoord(r['p_Longitude']);
  const hasValidCoords =
    lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const household = {
    addressLine1: r['Address'],
    addressLine2: r['Address Line 2'],
    city: r['City'],
    state: r['Registered State'],
    zipCode: r['Zip Code'],
    latitude: hasValidCoords ? lat : null,
    longitude: hasValidCoords ? lng : null,
  };

  return { raw: r, voter, household };
}

function missingRequired(raw) {
  return REQUIRED_HEADERS.filter((field) => !raw[field]);
}

export async function runImport({ buffer, filename, userId, campaignId, organizationId }) {
  if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
    throw new Error('campaignId is required');
  }
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
  });

  try {
    const csv = buffer.toString('utf8');
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors && parsed.errors.length) {
      // Note CSV-level parse errors but continue — Papa typically still returns usable data
    }

    const totalRows = parsed.data.length;
    const errors = [];
    const validRows = [];
    const seenSvids = new Set();
    const dupSvids = new Set();

    parsed.data.forEach((raw, i) => {
      const mapped = mapRow(raw);
      const missing = missingRequired(mapped.raw);
      if (missing.length) {
        errors.push({
          rowIndex: i + 2, // +1 for header, +1 for 1-based
          reason: `Missing required: ${missing.join(', ')}`,
          stateVoterId: mapped.voter.stateVoterId || null,
        });
        return;
      }
      if (mapped.household.latitude == null || mapped.household.longitude == null) {
        errors.push({
          rowIndex: i + 2,
          reason: 'Missing or invalid p_Latitude/p_Longitude',
          stateVoterId: mapped.voter.stateVoterId || null,
        });
        return;
      }
      const svid = mapped.voter.stateVoterId;
      if (seenSvids.has(svid)) {
        dupSvids.add(svid);
        // skip duplicate rows (first occurrence wins)
        return;
      }
      seenSvids.add(svid);
      validRows.push(mapped);
    });

    // Group into unique households. First row with valid coords wins.
    const householdMap = new Map();
    for (const row of validRows) {
      const norm = normalizeAddress(row.household);
      const existing = householdMap.get(norm);
      if (!existing) {
        householdMap.set(norm, { ...row.household, normalizedAddress: norm });
      } else if (existing.latitude == null && row.household.latitude != null) {
        existing.latitude = row.household.latitude;
        existing.longitude = row.household.longitude;
      }
    }

    // Bulk upsert households (scoped to this campaign). Coordinates are required
    // (rows without lat/lng were already rejected above), so every household here
    // gets a location. The (campaignId, normalizedAddress) compound unique index
    // means the same physical address can exist once per campaign.
    const householdOps = Array.from(householdMap.values()).map((h) => ({
      updateOne: {
        filter: { campaignId: campaign._id, normalizedAddress: h.normalizedAddress },
        update: {
          $set: {
            organizationId: orgId,
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
            location: { type: 'Point', coordinates: [h.longitude, h.latitude] },
          },
          $setOnInsert: {
            campaignId: campaign._id,
            normalizedAddress: h.normalizedAddress,
            status: 'unknocked',
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    let newHouseholds = 0;
    if (householdOps.length) {
      const result = await Household.bulkWrite(householdOps, { ordered: false });
      newHouseholds = result.upsertedCount || 0;
    }

    // Resolve normalizedAddress -> _id (within this campaign).
    const houses = await Household.find(
      { campaignId: campaign._id, normalizedAddress: { $in: Array.from(householdMap.keys()) } },
      { normalizedAddress: 1 }
    );
    const addressToId = new Map(houses.map((h) => [h.normalizedAddress, h._id]));

    // Bulk upsert voters by State Voter ID. If a voter's address changed,
    // householdId is updated; CanvassActivity at the old household is preserved.
    const voterOps = validRows.map((row) => {
      const norm = normalizeAddress(row.household);
      const householdId = addressToId.get(norm);
      return {
        updateOne: {
          filter: { stateVoterId: row.voter.stateVoterId },
          update: {
            $set: { ...row.voter, householdId, organizationId: orgId },
            $setOnInsert: { surveyStatus: 'not_surveyed' },
          },
          upsert: true,
        },
      };
    });

    let newVoters = 0;
    let updatedVoters = 0;
    if (voterOps.length) {
      const result = await Voter.bulkWrite(voterOps, { ordered: false });
      newVoters = result.upsertedCount || 0;
      updatedVoters = result.modifiedCount || 0;
    }

    job.status = 'completed';
    job.totalRows = totalRows;
    job.uniqueVoters = validRows.length;
    job.uniqueHouseholds = householdMap.size;
    job.newVoters = newVoters;
    job.updatedVoters = updatedVoters;
    job.newHouseholds = newHouseholds;
    job.duplicateStateVoterIds = Array.from(dupSvids);
    job.errors = errors.slice(0, 100);
    job.errorCount = errors.length;
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
