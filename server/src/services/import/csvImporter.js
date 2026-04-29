import Papa from 'papaparse';
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

  const household = {
    addressLine1: r['Address'],
    addressLine2: r['Address Line 2'],
    city: r['City'],
    state: r['Registered State'],
    zipCode: r['Zip Code'],
  };

  return { raw: r, voter, household };
}

function missingRequired(raw) {
  return REQUIRED_HEADERS.filter((field) => !raw[field]);
}

export async function runImport({ buffer, filename, userId }) {
  const job = await ImportJob.create({
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
      const svid = mapped.voter.stateVoterId;
      if (seenSvids.has(svid)) {
        dupSvids.add(svid);
        // skip duplicate rows (first occurrence wins)
        return;
      }
      seenSvids.add(svid);
      validRows.push(mapped);
    });

    // Group into unique households
    const householdMap = new Map();
    for (const row of validRows) {
      const norm = normalizeAddress(row.household);
      if (!householdMap.has(norm)) {
        householdMap.set(norm, { ...row.household, normalizedAddress: norm });
      }
    }

    // Bulk upsert households (idempotent — preserves geocode/status fields on existing)
    const householdOps = Array.from(householdMap.values()).map((h) => ({
      updateOne: {
        filter: { normalizedAddress: h.normalizedAddress },
        update: {
          $setOnInsert: {
            normalizedAddress: h.normalizedAddress,
            geocodeStatus: 'pending',
            geocodeProvider: null,
            location: null,
            status: 'unknocked',
            isActive: true,
          },
          $set: {
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
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

    // Resolve normalizedAddress -> _id
    const houses = await Household.find(
      { normalizedAddress: { $in: Array.from(householdMap.keys()) } },
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
            $set: { ...row.voter, householdId },
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
