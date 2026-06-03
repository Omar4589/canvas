import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { VoterNote } from '../../models/VoterNote.js';
import { recomputeSurveyStatus } from '../../services/canvass/status.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /admin/voters — org-wide directory with search, filters, server-side pagination.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const filter = { organizationId: orgId };
    if (req.query.party) filter.party = req.query.party;
    if (req.query.surveyStatus) filter.surveyStatus = req.query.surveyStatus;
    if (req.query.precinct) filter.precinct = req.query.precinct;

    const campaignId =
      req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
        ? new mongoose.Types.ObjectId(req.query.campaignId)
        : null;
    if (campaignId) {
      const hhIds = (
        await Household.find({ organizationId: orgId, campaignId }, '_id').lean()
      ).map((h) => h._id);
      filter.householdId = { $in: hhIds };
    }

    // voted filter — campaign-scoped when a campaign is selected, else org-wide.
    if (req.query.voted === 'true' || req.query.voted === 'false') {
      const vf = { organizationId: orgId };
      if (campaignId) vf.campaignId = campaignId;
      const votedIds = await VotedVoter.distinct('voterId', vf);
      filter._id = req.query.voted === 'true' ? { $in: votedIds } : { $nin: votedIds };
    }

    const search = (req.query.search || '').trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const addrHh = (
        await Household.find(
          { organizationId: orgId, $or: [{ addressLine1: rx }, { city: rx }, { zipCode: rx }] },
          '_id'
        )
          .limit(5000)
          .lean()
      ).map((h) => h._id);
      filter.$or = [{ fullName: rx }, { stateVoterId: search }, { householdId: { $in: addrHh } }];
    }

    const [rows, total] = await Promise.all([
      Voter.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      Voter.countDocuments(filter),
    ]);

    // Resolve household/campaign + voted flag for the page.
    const hhIds = [...new Set(rows.map((v) => String(v.householdId)).filter(Boolean))];
    const households = hhIds.length
      ? await Household.find(
          { _id: { $in: hhIds } },
          'addressLine1 city state campaignId'
        ).lean()
      : [];
    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const campIds = [...new Set(households.map((h) => String(h.campaignId)).filter(Boolean))];
    const camps = campIds.length
      ? await Campaign.find({ _id: { $in: campIds } }, 'name').lean()
      : [];
    const cMap = new Map(camps.map((c) => [String(c._id), c.name]));
    const votedRows = rows.length
      ? await VotedVoter.find({ voterId: { $in: rows.map((v) => v._id) } }, 'voterId campaignId').lean()
      : [];
    const votedByVoter = new Map();
    for (const r of votedRows) {
      if (!votedByVoter.has(String(r.voterId))) votedByVoter.set(String(r.voterId), new Set());
      votedByVoter.get(String(r.voterId)).add(String(r.campaignId));
    }

    const voters = rows.map((v) => {
      const h = hMap.get(String(v.householdId));
      const hcamp = h ? String(h.campaignId) : null;
      return {
        id: String(v._id),
        fullName: v.fullName,
        firstName: v.firstName,
        lastName: v.lastName,
        stateVoterId: v.stateVoterId,
        party: v.party || null,
        surveyStatus: v.surveyStatus,
        voted: hcamp ? !!votedByVoter.get(String(v._id))?.has(hcamp) : false,
        household: h
          ? {
              id: String(h._id),
              addressLine1: h.addressLine1,
              city: h.city,
              state: h.state,
              campaignId: hcamp,
              campaignName: hcamp ? cMap.get(hcamp) || null : null,
            }
          : null,
      };
    });

    res.json({ voters, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

// GET /admin/voters/:voterId — full profile.
router.get('/:voterId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    if (!profile) return res.status(404).json({ error: 'Voter not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

const updateVoterSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  phoneType: z.string().trim().max(40).nullable().optional(),
  cellPhone: z.string().trim().max(40).nullable().optional(),
  party: z.string().trim().max(80).nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z.string().datetime().nullable().optional(),
  registrationStatus: z.string().trim().max(80).nullable().optional(),
  registeredState: z.string().trim().max(2).nullable().optional(),
  congressionalDistrict: z.string().trim().max(40).nullable().optional(),
  stateSenateDistrict: z.string().trim().max(40).nullable().optional(),
  stateHouseDistrict: z.string().trim().max(40).nullable().optional(),
  precinct: z.string().trim().max(80).nullable().optional(),
});

// PATCH /admin/voters/:voterId — edit allowed fields (identity/household/org are locked).
router.patch('/:voterId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const data = updateVoterSchema.parse(req.body);
    const update = { ...data, lastEditedBy: req.user._id, lastEditedAt: new Date() };
    if (data.dateOfBirth !== undefined) {
      update.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    }

    const voter = await Voter.findOne({ _id: req.params.voterId, organizationId: activeOrgId(req) });
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    Object.assign(voter, update);
    if (data.firstName !== undefined || data.lastName !== undefined) {
      voter.fullName = `${voter.firstName} ${voter.lastName}`.trim();
    }
    await voter.save();

    const profile = await buildVoterProfile(voter._id, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// ── Admin voter notes (org-level, follow the voter) ──────────────────────────
async function loadVoterOr404(req, res) {
  if (!mongoose.isValidObjectId(req.params.voterId)) {
    res.status(400).json({ error: 'Invalid voterId' });
    return null;
  }
  const voter = await Voter.findOne(
    { _id: req.params.voterId, organizationId: activeOrgId(req) },
    '_id'
  ).lean();
  if (!voter) {
    res.status(404).json({ error: 'Voter not found' });
    return null;
  }
  return voter;
}

router.post('/:voterId/notes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const voter = await loadVoterOr404(req, res);
    if (!voter) return;
    const body = z.string().trim().min(1).max(5000).parse(req.body?.body);
    const note = await VoterNote.create({
      organizationId: activeOrgId(req),
      voterId: voter._id,
      authorId: req.user._id,
      body,
    });
    res.status(201).json({ id: String(note._id) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Note body required' });
    next(err);
  }
});

router.patch('/:voterId/notes/:noteId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.noteId)) return res.status(400).json({ error: 'Invalid noteId' });
    const body = z.string().trim().min(1).max(5000).parse(req.body?.body);
    const note = await VoterNote.findOneAndUpdate(
      { _id: req.params.noteId, voterId: req.params.voterId, organizationId: activeOrgId(req) },
      { $set: { body, editedBy: req.user._id, editedAt: new Date() } },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Note body required' });
    next(err);
  }
});

router.delete('/:voterId/notes/:noteId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const r = await VoterNote.deleteOne({
      _id: req.params.noteId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    });
    if (!r.deletedCount) return res.status(404).json({ error: 'Note not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Survey response editing (audited) ────────────────────────────────────────
const editSurveySchema = z.object({
  answers: z
    .array(
      z.object({
        questionKey: z.string(),
        questionLabel: z.string(),
        answer: z.any(),
      })
    )
    .optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

router.patch('/:voterId/surveys/:responseId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.responseId)) {
      return res.status(400).json({ error: 'Invalid responseId' });
    }
    const data = editSurveySchema.parse(req.body);
    const sr = await SurveyResponse.findOne({
      _id: req.params.responseId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    });
    if (!sr) return res.status(404).json({ error: 'Survey response not found' });
    if (data.answers !== undefined) sr.answers = data.answers;
    if (data.note !== undefined) sr.note = data.note;
    sr.editedBy = req.user._id;
    sr.editedAt = new Date();
    await sr.save();
    await recomputeSurveyStatus([sr.voterId]);

    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.delete('/:voterId/surveys/:responseId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const r = await SurveyResponse.deleteOne({
      _id: req.params.responseId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    });
    if (!r.deletedCount) return res.status(404).json({ error: 'Survey response not found' });
    await recomputeSurveyStatus([req.params.voterId]);
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

export default router;
