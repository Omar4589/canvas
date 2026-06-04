import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { WalkList } from '../../models/WalkList.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Effort } from '../../models/Effort.js';
import { resolveWalkList } from '../../services/walklist/resolveWalkList.js';
import {
  parseAndMatch,
  resolveHouseholdsFromVoterMatch,
  NOT_FOUND_CAP,
} from '../../services/import/parseVoterIdList.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function activeOrgId(req) {
  return req.activeOrg?._id;
}

async function loadCampaign(req, res, next) {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      return res.status(400).json({ error: 'Invalid campaignId' });
    }
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);

router.get('/', async (req, res, next) => {
  try {
    const walkLists = await WalkList.find(
      { campaignId: req.campaign._id },
      { householdIds: 0, voterIds: 0 }
    )
      .sort({ createdAt: -1 })
      .lean();
    res.json({ walkLists });
  } catch (err) {
    next(err);
  }
});

// Dry-run: resolve a filter and return counts + a small sample (no save).
router.post('/preview', async (req, res, next) => {
  try {
    const r = await resolveWalkList(req.campaign, req.body?.filter || {});
    const sample = await Household.find(
      { _id: { $in: r.householdIds.slice(0, 20) } },
      { addressLine1: 1, city: 1, state: 1, zipCode: 1 }
    ).lean();
    res.json({ householdCount: r.householdCount, voterCount: r.voterCount, sample });
  } catch (err) {
    next(err);
  }
});

// Save a frozen walk list from a filter.
router.post('/', async (req, res, next) => {
  try {
    const { name, filter } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const r = await resolveWalkList(req.campaign, filter || {});
    const walkList = await WalkList.create({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      name: String(name).trim(),
      filter: filter || {},
      householdIds: r.householdIds,
      voterIds: r.voterIds,
      householdCount: r.householdCount,
      voterCount: r.voterCount,
      createdBy: req.user._id,
    });
    const obj = walkList.toObject();
    delete obj.householdIds;
    delete obj.voterIds;
    res.status(201).json({ walkList: obj });
  } catch (err) {
    next(err);
  }
});

// Bucket a resolved door set into Intake vs already-owned (with effort names) so the
// CSV preview can warn before the admin saves/claims — owned doors need a re-carve.
async function ownershipBreakdown(campaign, ownership) {
  let intakeDoors = 0;
  const ownedCount = new Map(); // effortId -> n
  for (const h of ownership) {
    if (!h.effortId) { intakeDoors += 1; continue; }
    const k = String(h.effortId);
    ownedCount.set(k, (ownedCount.get(k) || 0) + 1);
  }
  const ownedDoors = ownership.length - intakeDoors;
  let ownedByEffort = [];
  if (ownedCount.size) {
    const efforts = await Effort.find(
      { _id: { $in: [...ownedCount.keys()] }, campaignId: campaign._id },
      { name: 1 }
    ).lean();
    const nameById = new Map(efforts.map((e) => [String(e._id), e.name]));
    ownedByEffort = [...ownedCount.entries()].map(([id, count]) => ({
      effortId: id,
      name: nameById.get(id) || 'Unknown effort',
      count,
    }));
  }
  return { intakeDoors, ownedDoors, ownedByEffort };
}

// Dry-run: upload a Voter-ID CSV, match it to this campaign's voters (by stateVoterId),
// and report the resolved door set + ownership breakdown. No save. Mirrors POST /preview.
router.post('/from-csv/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatch(req.campaign, req.file.buffer, req.body?.idColumn);
    if (m.error) return res.status(400).json({ error: m.error, columns: m.columns });
    const r = await resolveHouseholdsFromVoterMatch(req.campaign, m.inCampaign);
    const { intakeDoors, ownedDoors, ownedByEffort } = await ownershipBreakdown(req.campaign, r.ownership);
    const sample = await Household.find(
      { _id: { $in: r.householdIds.slice(0, 20) } },
      { addressLine1: 1, city: 1, state: 1, zipCode: 1 }
    ).lean();
    res.json({
      idColumn: m.col,
      columns: m.columns,
      totalRows: m.totalRows,
      idsInFile: m.csvCount,
      matched: m.inCampaign.length,
      householdCount: r.householdCount,
      voterCount: r.voterCount,
      noCoordinates: r.noCoordinates,
      notFound: m.notFound,
      notFoundIds: m.notFoundIds.slice(0, NOT_FOUND_CAP),
      ownedDoors,
      intakeDoors,
      ownedByEffort,
      sample,
    });
  } catch (err) {
    next(err);
  }
});

// Save a frozen walk list from an uploaded Voter-ID CSV (matched by stateVoterId).
// The result is an ordinary frozen WalkList — it seeds/claims efforts via the same
// path as a filter-built list, so disjointness/claim/re-carve are reused unchanged.
router.post('/from-csv', upload.single('file'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const m = await parseAndMatch(req.campaign, req.file.buffer, req.body?.idColumn);
    if (m.error) return res.status(400).json({ error: m.error, columns: m.columns });
    const r = await resolveHouseholdsFromVoterMatch(req.campaign, m.inCampaign);
    const walkList = await WalkList.create({
      organizationId: req.campaign.organizationId,
      campaignId: req.campaign._id,
      name: String(name).trim(),
      filter: {},
      householdIds: r.householdIds,
      voterIds: r.voterIds,
      householdCount: r.householdCount,
      voterCount: r.voterCount,
      source: 'csv',
      sourceMeta: {
        fileName: req.file.originalname,
        idColumn: m.col,
        idsInFile: m.csvCount,
        matchedVoters: m.inCampaign.length,
        notFound: m.notFound,
      },
      createdBy: req.user._id,
    });
    const obj = walkList.toObject();
    delete obj.householdIds;
    delete obj.voterIds;
    res.status(201).json({ walkList: obj });
  } catch (err) {
    next(err);
  }
});

// Distinct filter values for the campaign, to populate the walk-list value
// pickers. Voter has no campaignId, so voter fields are scoped via the campaign's
// households; geo fields read straight off the denormalized Household columns.
router.get('/distinct', async (req, res, next) => {
  try {
    const campaignId = req.campaign._id;
    const sortVals = (arr) =>
      arr.filter(Boolean).map(String).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const hhIds = await Household.distinct('_id', { campaignId, isActive: true });
    const v = (field) => Voter.distinct(field, { householdId: { $in: hhIds } });
    const h = (col) => Household.distinct(col, { campaignId, isActive: true });
    const [genders, parties, precincts, congressional, stateSenate, stateHouse, cities, zips, counties] =
      await Promise.all([
        v('gender'),
        v('party'),
        v('precinct'),
        v('congressionalDistrict'),
        v('stateSenateDistrict'),
        v('stateHouseDistrict'),
        h('cityValue'),
        h('zipValue'),
        h('countyValue'),
      ]);
    res.json({
      genders: sortVals(genders),
      parties: sortVals(parties),
      precincts: sortVals(precincts),
      congressional: sortVals(congressional),
      stateSenate: sortVals(stateSenate),
      stateHouse: sortVals(stateHouse),
      cities: sortVals(cities),
      zips: sortVals(zips),
      counties: sortVals(counties),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const walkList = await WalkList.findOne(
      { _id: req.params.id, campaignId: req.campaign._id },
      { householdIds: 0, voterIds: 0 }
    ).lean();
    if (!walkList) return res.status(404).json({ error: 'Walk list not found' });
    res.json({ walkList });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await WalkList.deleteOne({ _id: req.params.id, campaignId: req.campaign._id });
    res.json({ deleted: r.deletedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
