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
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { VoterNote } from '../../models/VoterNote.js';
import { AccessLog } from '../../models/AccessLog.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { recomputeSurveyStatus } from '../../services/canvass/status.js';
import { bumpCampaignStats } from '../../services/reports/campaignCounters.js';
import { recomputeHouseholdActive } from '../../services/import/recomputeHouseholdActive.js';
import { normalizeAndFilterAnswers } from '../../services/surveys/normalizeAnswers.js';
import { archiveOverwrittenResponse, snapshotFromArchive } from '../../services/surveys/archiveOverwrite.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';
import { recomputeFullyDnc } from '../../services/dnc/recomputeFullyDnc.js';
import { Person } from '../../models/Person.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { propagateIdentity, identityEq } from '../../services/person/propagateIdentity.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { followMerged } from '../../services/person/resolvePerson.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

// Record-level audit tag: EVERY route with :voterId — current and future — marks the voter as
// this request's subject, so a staff read under a support grant logs WHICH record was opened
// (middleware/accessLog.js picks the tag up at finish; member requests never write a row).
// Invalid ids are skipped: a garbage param must not poison the audit write.
router.param('voterId', (req, res, next, voterId) => {
  if (mongoose.isValidObjectId(voterId)) addAuditSubjects(res, 'voter', voterId);
  next();
});

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
    // `skip` — the house paging param (this was the last route saying `offset`; the web client is
    // the only caller and ships with the server, so the rename has no compat window).
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const filter = { organizationId: orgId };
    if (req.query.party) filter.party = req.query.party;
    if (req.query.surveyStatus) filter.surveyStatus = req.query.surveyStatus;
    if (req.query.precinct) filter.precinct = req.query.precinct;
    // Do-not-contact filter — org-wide by nature (the flag lives on the org-scoped Voter, no
    // campaign gymnastics like `voted` needs below).
    if (req.query.dnc === 'true') filter['doNotContact.flagged'] = true;
    else if (req.query.dnc === 'false') filter['doNotContact.flagged'] = { $ne: true };
    // "Added at the door" filter — walk-up rows a canvasser typed (rides the partial
    // {organizationId, 'doorAdded.at'} index; single-direction like party/precinct).
    if (req.query.doorAdded === 'true') filter['doorAdded.at'] = { $exists: true };

    const campaignId =
      req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
        ? new mongoose.Types.ObjectId(req.query.campaignId)
        : null;
    // Voter rows are per-campaign — a direct filter, no household round-trip, and it always
    // resolves to THIS campaign's row of a shared person (never "whichever imported last").
    if (campaignId) filter.campaignId = campaignId;

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

    // Org-wide view of a multi-campaign org: dedupe by person (stateVoterId) so someone
    // imported into two campaigns is ONE directory row — their first-sorted row is the
    // primary, `campaignIds` collects everywhere they appear, and surveyStatus reads
    // surveyed-in-any. Single-campaign orgs (and any campaign-scoped view) keep the plain
    // indexed find — rows and people are the same thing there.
    const needsDedupe =
      !campaignId && (await Campaign.countDocuments({ organizationId: orgId })) > 1;

    let rows;
    let total;
    let extrasByVoterId = null; // person-level extras from the dedupe pipeline
    if (needsDedupe) {
      const groupStage = {
        $group: {
          _id: '$stateVoterId',
          doc: { $first: '$$ROOT' },
          campaignIds: { $addToSet: '$campaignId' },
          surveyedAny: { $max: { $cond: [{ $eq: ['$surveyStatus', 'surveyed'] }, 1, 0] } },
        },
      };
      const [pageRows, totalAgg] = await Promise.all([
        Voter.aggregate([
          { $match: filter },
          // Pre-group sort makes $first deterministic (the person's first row in directory
          // order); post-group sort orders the PEOPLE the same way for paging.
          { $sort: { lastName: 1, firstName: 1, _id: 1 } },
          groupStage,
          { $sort: { 'doc.lastName': 1, 'doc.firstName': 1, 'doc._id': 1 } },
          { $skip: skip },
          { $limit: limit },
        ]).allowDiskUse(true),
        Voter.aggregate([
          { $match: filter },
          { $group: { _id: '$stateVoterId' } },
          { $count: 'n' },
        ]).allowDiskUse(true),
      ]);
      rows = pageRows.map((r) => r.doc);
      total = totalAgg[0]?.n || 0;
      extrasByVoterId = new Map(
        pageRows.map((r) => [
          String(r.doc._id),
          { campaignIds: r.campaignIds.map(String), surveyedAny: r.surveyedAny === 1 },
        ])
      );
    } else {
      [rows, total] = await Promise.all([
        Voter.find(filter)
          .sort({ lastName: 1, firstName: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Voter.countDocuments(filter),
      ]);
    }

    // Resolve household/campaign + voted flag for the page.
    const hhIds = [...new Set(rows.map((v) => String(v.householdId)).filter(Boolean))];
    const households = hhIds.length
      ? await Household.find(
          { _id: { $in: hhIds } },
          'addressLine1 city state campaignId'
        ).lean()
      : [];
    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const campIds = [
      ...new Set([
        ...households.map((h) => String(h.campaignId)).filter(Boolean),
        // Deduped people may span campaigns beyond their primary row's household.
        ...(extrasByVoterId ? [...extrasByVoterId.values()].flatMap((e) => e.campaignIds) : []),
      ]),
    ];
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
      const extras = extrasByVoterId?.get(String(v._id)) || null;
      return {
        id: String(v._id),
        fullName: v.fullName,
        firstName: v.firstName,
        lastName: v.lastName,
        stateVoterId: v.stateVoterId,
        party: v.party || null,
        // Deduped org view reads surveyed-in-ANY-campaign; row views read the row.
        surveyStatus: extras ? (extras.surveyedAny ? 'surveyed' : 'not_surveyed') : v.surveyStatus,
        dnc: !!v.doNotContact?.flagged,
        // Walk-up badge: at-date only here; who added lives on the profile.
        doorAdded: v.doorAdded ? { at: v.doorAdded.at } : null,
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
        // Additive (dedupe path only): every campaign this person appears in.
        ...(extras
          ? { campaigns: extras.campaignIds.map((cid) => ({ id: cid, name: cMap.get(cid) || null })) }
          : {}),
      };
    });

    res.json({ voters, total, limit, skip });
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

// "Was this record accessed by Doorline?" — the customer-facing half of record-level audit.
// Org-scoped and admin-gated like everything here: an org admin reads the AccessLog rows for
// THEIR org whose subjects include this voter (or its household/person identity), and can
// answer a voter's question without a support ticket. Staff identity is FIRST NAME ONLY —
// the same disclosure the support-grant notice email makes. Rows exist only for staff access
// under a grant, so "no entries" genuinely means "Doorline never opened this record"
// (record-level detail began 2026-07-19; earlier staff access was logged per-request only).
router.get('/:voterId/staff-access', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      'householdId personId stateVoterId'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    // Sibling rows too (the same person in other campaigns) — "was this record accessed"
    // is a question about the PERSON, not one campaign's row of them.
    const siblingIds = await Voter.find({
      organizationId: activeOrgId(req),
      stateVoterId: voter.stateVoterId,
      _id: { $ne: voter._id },
    }).distinct('_id');
    const subjectIds = [voter._id, ...siblingIds, voter.householdId, voter.personId].filter(Boolean);
    // $slice:2 on subjects, NOT the whole array. The export heuristic below only needs to know
    // "one subject or more than one", and an export row can carry up to SUBJECT_CAP (20k) ids —
    // projecting them all meant a routine profile view could pull 50 x 20k subdocs into the dyno
    // for a boolean. Two entries answer `> 1` for every case, and truncated rows still short-circuit
    // on subjectsTotal (capSubjects sets it only past the cap). Never widen this without moving the
    // heuristic to a stored count.
    const rows = await AccessLog.find(
      { organizationId: activeOrgId(req), 'subjects.id': { $in: subjectIds } },
      { at: 1, route: 1, resource: 1, actorUserId: 1, grantId: 1, subjectsTotal: 1, subjects: { $slice: 2 } }
    )
      .populate('actorUserId', 'firstName')
      .populate('grantId', 'reason kind')
      .sort({ at: -1 })
      .limit(50)
      .lean();

    res.json({
      count: rows.length,
      entries: rows.map((r) => ({
        at: r.at,
        staffFirstName: r.actorUserId?.firstName || 'Doorline staff',
        reason: r.grantId?.reason || null,
        kind: r.resource,
        // An export swept this record up with others; a non-export is a direct open.
        export: /export/.test(r.route || '') || (r.subjectsTotal ?? r.subjects?.length ?? 0) > 1,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Shared identity fields route through the Person layer; org-local fields (districts +
// registered state, plus email) are written straight to the voter and never propagated
// cross-org. Email is org-local on purpose: Person has no email path (it's contact info
// volunteered to THIS org, not identity), so it write-straights like the districts. No
// locallyEditedFields arming needed either — imports never write email, so nothing can
// clobber it.
const PERSON_IDENTITY_FIELDS = ['firstName', 'lastName', 'phone', 'phoneType', 'cellPhone', 'party', 'gender', 'dateOfBirth', 'registrationStatus'];
const ORG_LOCAL_FIELDS = ['registeredState', 'congressionalDistrict', 'stateSenateDistrict', 'stateHouseDistrict', 'precinct', 'email'];

const updateVoterSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  // Phones here stay LOOSE (max 40 free text) unlike the walk-up create's strict phoneSchema:
  // the profile form round-trips every stored field on save, and voter-file phones arrive in
  // arbitrary formats — a strict schema would make unrelated edits fail on legacy data.
  phone: z.string().trim().max(40).nullable().optional(),
  phoneType: z.string().trim().max(40).nullable().optional(),
  cellPhone: z.string().trim().max(40).nullable().optional(),
  party: z.string().trim().max(80).nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z.string().datetime().nullable().optional(),
  registrationStatus: z.string().trim().max(80).nullable().optional(),
  // Contact email (walk-up voters volunteer one; admins can correct it). Empty → null.
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().email().max(254).nullable()
  ).optional(),
  registeredState: z.string().trim().max(2).nullable().optional(),
  congressionalDistrict: z.string().trim().max(40).nullable().optional(),
  stateSenateDistrict: z.string().trim().max(40).nullable().optional(),
  stateHouseDistrict: z.string().trim().max(40).nullable().optional(),
  precinct: z.string().trim().max(80).nullable().optional(),
});

// PATCH /admin/voters/:voterId — edit allowed fields. Shared identity routes through the
// Person layer: owner/super-admin → propagate to canonical + every org's cache; non-owner
// → a review proposal + this org's cache only (flagged so propagation won't clobber it).
// District/state fields are always org-local. Pre-backfill voters (no personId) write straight.
router.patch('/:voterId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const orgId = activeOrgId(req);
    const data = updateVoterSchema.parse(req.body);
    if (data.dateOfBirth !== undefined) data.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;

    const voter = await Voter.findOne({ _id: req.params.voterId, organizationId: orgId });
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    const identity = {};
    for (const f of PERSON_IDENTITY_FIELDS) if (data[f] !== undefined) identity[f] = data[f];
    const local = {};
    for (const f of ORG_LOCAL_FIELDS) if (data[f] !== undefined) local[f] = data[f];
    if (identity.firstName !== undefined || identity.lastName !== undefined) {
      identity.fullName = `${identity.firstName ?? voter.firstName} ${identity.lastName ?? voter.lastName}`.trim();
    }
    const directSet = { ...local, lastEditedBy: req.user._id, lastEditedAt: new Date() };

    if (Object.keys(identity).length) {
      const person = voter.personId ? await followMerged(await Person.findById(voter.personId)) : null;
      // Persons are org-scoped: an org editing ITS OWN Person is always the owner in the sense that
      // matters. The identityOwnerOrgId comparison alone was a dormant trap — resolvePerson creates
      // Persons with no owner set, and an owner-less Person would silently shunt the org's own edit
      // into a proposal queue no UI shows (the Voter row updates, so it LOOKS applied).
      const owns = !!req.user.isSuperAdmin
        || (person && String(person.organizationId) === String(orgId))
        || (person && String(person.identityOwnerOrgId) === String(orgId));
      // Which identity fields did this edit ACTUALLY change? The profile form submits every
      // field on save, so diffing against the stored values is load-bearing: arming unchanged
      // fields would freeze the whole record against voter-file updates forever.
      const changed = Object.keys(identity).filter((f) => !identityEq(identity[f], voter[f]));
      if (person && !owns) {
        const proposed = Object.keys(identity);
        // Snapshot exactly the proposed fields (which may include the derived fullName), so
        // the super-admin drift check compares like-for-like instead of always superseding.
        const canonicalSnapshot = {};
        for (const f of proposed) canonicalSnapshot[f] = person[f] ?? null;
        await PersonEditProposal.updateOne(
          { personId: person._id, orgId, source: 'admin_edit', status: 'pending' },
          { $set: { fields: identity, canonicalSnapshot, baseIdentityVersion: person.identityVersion, userId: req.user._id } },
          { upsert: true }
        );
        await Voter.updateOne(
          { _id: voter._id },
          {
            $set: { ...directSet, ...identity },
            ...(changed.length ? { $addToSet: { locallyEditedFields: { $each: changed } } } : {}),
          }
        );
      } else if (person) {
        // Owner / super-admin: this edit is the new canonical AND a hand edit this org wants to
        // survive the next voter-file import — so ARM the changed fields (they were previously
        // $pull'ed here, which is why door-confirmed corrections silently reverted on re-import).
        // Arm-before-propagate ordering is deliberate: the fan-out honors locallyEditedFields, so
        // it will skip the just-armed fields on this row — the values are $set directly in the
        // same update. Canonical still updates via propagateIdentity (provenance + sibling rows).
        await Voter.updateOne(
          { _id: voter._id },
          {
            $set: { ...directSet, ...identity },
            ...(changed.length ? { $addToSet: { locallyEditedFields: { $each: changed } } } : {}),
          }
        );
        await propagateIdentity(person._id, identity, {
          orgId, source: req.user.isSuperAdmin ? 'super_admin' : 'admin_edit', userId: req.user._id,
        });
      } else {
        await Voter.updateOne(
          { _id: voter._id },
          {
            $set: { ...directSet, ...identity },
            ...(changed.length ? { $addToSet: { locallyEditedFields: { $each: changed } } } : {}),
          }
        );
      }
    } else {
      await Voter.updateOne({ _id: voter._id }, { $set: directSet });
    }

    const profile = await buildVoterProfile(voter._id, { orgId });
    res.json(profile);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// DELETE /admin/voters/:voterId — remove a DOOR-ADDED voter (a bad walk-up entry). The only
// voter delete in the product, scoped hard to `doorAdded != null`: imported rows leave via
// re-import/undo-import or the campaign cascade, never one-by-one. Cascade:
//  - SurveyResponse rows (+ their archives) and VoterNotes go — the person is being erased.
//    Campaign.stats.surveyCount counts SurveyResponse docs, so it moves by the deleted count.
//  - CanvassActivity rows are KEPT with voterId nulled: the door VISIT genuinely happened and
//    is billable (billing = distinct household×pass over CanvassActivity); a null voterId is
//    honest once the person is gone, and nothing joins on it (doorKey.js). Same call the
//    survey-response delete below makes.
//  - Household invariants recomputed; the fullyDnc recompute's updatedAt bump also tells
//    phones the door changed. Phones that already hold the voter keep a phantom row until
//    their next full bootstrap (a deleted doc can't ride the delta) — a survey against it
//    404s and the offline queue drops it. If this was the door's ONLY voter, the door
//    deactivates and the delta drops it from phones entirely.
// The router.param tag above logs the record for staff-under-grant requests.
router.delete('/:voterId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid voterId' });
    }
    const orgId = activeOrgId(req);
    const voter = await Voter.findOne({ _id: req.params.voterId, organizationId: orgId }).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    if (!voter.doorAdded) {
      return res.status(400).json({
        error: 'Only voters added at the door can be deleted. Imported voters leave via re-import or campaign deletion.',
        code: 'NOT_DOOR_ADDED',
      });
    }

    const responses = await SurveyResponse.find({ voterId: voter._id }, 'campaignId').lean();
    await SurveyResponse.deleteMany({ voterId: voter._id });
    // Every response of a per-campaign voter carries that voter's campaignId, so one bump.
    if (responses.length) {
      await bumpCampaignStats(voter.campaignId, { surveys: -responses.length });
    }
    await SurveyResponseArchive.deleteMany({ voterId: voter._id });
    await VoterNote.deleteMany({ voterId: voter._id });
    // Hygiene — a manual: id can never match a voted-list upload, but a row here would
    // dangle after the delete.
    await VotedVoter.deleteMany({ voterId: voter._id });
    await CanvassActivity.updateMany({ voterId: voter._id }, { $set: { voterId: null } });
    await Voter.deleteOne({ _id: voter._id });

    await recomputeFullyDnc([String(voter.householdId)]);
    await recomputeHouseholdActive(voter.campaignId, [voter.householdId]);

    res.json({ ok: true, deleted: true, responsesDeleted: responses.length });
  } catch (err) {
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

// ── Do-not-contact (org-wide; see docs/VOTERS.md) ────────────────────────────
// The flag is an ORG-wide promise on per-campaign Voter rows: both transitions write by
// {organizationId, stateVoterId}, so every sibling row (the same person in other campaigns)
// flips together and each campaign's door recomputes. Admins only (this router's gate) —
// leads see the flag but cannot change it. Both transitions stamp who/when on the subdoc and
// write a VoterNote, so the durable history lives in the notes trail the profile and Notes
// hub already render (the profile unions notes across siblings).

router.post('/:voterId/dnc', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) return res.status(400).json({ error: 'Invalid voterId' });
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      '_id householdId stateVoterId doNotContact'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    const reason = z
      .string({ required_error: 'A reason is required — it becomes the record of why.' })
      .trim()
      .min(3, 'A reason is required — it becomes the record of why.')
      .max(2000)
      .parse(req.body?.reason);

    // Idempotent, and deliberately NOT restamped: the original at/byUserId/uploadId attribution
    // is what an upload's undo keys on — a second admin click must not steal it.
    if (voter.doNotContact?.flagged) {
      return res.json({ ok: true, alreadyFlagged: true });
    }

    // All sibling rows — this person in every campaign of the org. The flagged-$ne guard
    // keeps any already-flagged sibling's original attribution (same restamp rule as above).
    const siblings = await Voter.find(
      { organizationId: activeOrgId(req), stateVoterId: voter.stateVoterId },
      '_id householdId'
    ).lean();
    await Voter.updateMany(
      { organizationId: activeOrgId(req), stateVoterId: voter.stateVoterId, 'doNotContact.flagged': { $ne: true } },
      {
        $set: {
          doNotContact: {
            flagged: true,
            at: new Date(),
            byUserId: req.user._id,
            reason,
            source: 'admin',
            uploadId: null,
          },
        },
      }
    );
    await VoterNote.create({
      organizationId: activeOrgId(req),
      voterId: voter._id,
      authorId: req.user._id,
      body: `Marked do-not-contact: ${reason}`,
    });
    // Recompute every sibling's door (each may suppress) — also bumps Household.updatedAt,
    // which is what pushes the change to already-bootstrapped phones via the /changes delta.
    await recomputeFullyDnc([...new Set(siblings.map((s) => String(s.householdId)))]);

    res.json(await buildVoterProfile(voter._id, { orgId: activeOrgId(req) }));
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message || 'A reason is required.' });
    next(err);
  }
});

router.delete('/:voterId/dnc', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.voterId)) return res.status(400).json({ error: 'Invalid voterId' });
    const voter = await Voter.findOne(
      { _id: req.params.voterId, organizationId: activeOrgId(req) },
      '_id householdId stateVoterId doNotContact'
    ).lean();
    if (!voter) return res.status(404).json({ error: 'Voter not found' });

    if (!voter.doNotContact?.flagged) {
      return res.json({ ok: true, alreadyClear: true });
    }

    // The subdoc records the last transition in either direction; the notes trail keeps
    // history. Clears ALL sibling rows — un-flagging is as org-wide as flagging.
    const siblings = await Voter.find(
      { organizationId: activeOrgId(req), stateVoterId: voter.stateVoterId },
      '_id householdId'
    ).lean();
    await Voter.updateMany(
      { organizationId: activeOrgId(req), stateVoterId: voter.stateVoterId },
      {
        $set: {
          doNotContact: {
            flagged: false,
            at: new Date(),
            byUserId: req.user._id,
            reason: null,
            source: 'admin',
            uploadId: null,
          },
        },
      }
    );
    await VoterNote.create({
      organizationId: activeOrgId(req),
      voterId: voter._id,
      authorId: req.user._id,
      body: 'Do-not-contact flag removed.',
    });
    await recomputeFullyDnc([...new Set(siblings.map((s) => String(s.householdId)))]); // doors may reopen

    res.json(await buildVoterProfile(voter._id, { orgId: activeOrgId(req) }));
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
        optionIds: z.array(z.string()).optional(),
        otherText: z.string().nullable().optional(),
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
    if (data.answers !== undefined) {
      // Normalize against the response's template, but PRESERVE history: keep
      // answers even if new visibleIf logic would now hide them (dropHidden:false).
      // Unknown ids/rows are still pruned. Missing template → no template-driven
      // normalization possible, so store as-is rather than wipe the edit.
      const template = await SurveyTemplate.findById(sr.surveyTemplateId);
      sr.answers = template
        ? normalizeAndFilterAnswers(template, data.answers, { dropHidden: false })
        : data.answers;
    }
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
    // findOneAndDelete (not deleteOne) so the doc's campaignId is in hand for the stats bump.
    // Archived (overwritten) siblings deliberately SURVIVE this delete — removing the current
    // response and restoring a preserved one is the "swap in the earlier answers" flow. Full
    // erasure of a preserved response is the archive DELETE below.
    const deleted = await SurveyResponse.findOneAndDelete({
      _id: req.params.responseId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    }).lean();
    if (!deleted) return res.status(404).json({ error: 'Survey response not found' });
    // Only surveyCount moves — the survey_submitted ACTIVITY row survives, so knock counters
    // are untouched (matching the live aggregations, which read the two ledgers independently).
    await bumpCampaignStats(deleted.campaignId, { surveys: -1 });
    await recomputeSurveyStatus([req.params.voterId]);
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Make a preserved (overwritten) response current again. A lossless SWAP with compensating
// writes (no transactions): 1) archive the displaced current response (via:'restore', so the
// swap can be swapped back), 2) write the preserved content into the SAME row in place —
// editedBy/editedAt come back VERBATIM (the response as it was; the restore itself is audited
// by the step-1 archive row), 3) only then drop the promoted archive row. A crash between any
// two steps leaves a duplicate archive row at worst — never a lost response. If the current
// response was deleted meanwhile, restore resurrects: create + surveys:+1, the inverse of the
// DELETE above. Re-restoring a promoted id is an honest 404 (the row was consumed).
router.post('/:voterId/surveys/:archiveId/restore', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.archiveId)) {
      return res.status(400).json({ error: 'Invalid archiveId' });
    }
    const archived = await SurveyResponseArchive.findOne({
      _id: req.params.archiveId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    }).lean();
    if (!archived) return res.status(404).json({ error: 'Preserved response not found' });

    const snapshot = snapshotFromArchive(archived);
    const current = await SurveyResponse.findOne({
      voterId: archived.voterId,
      passId: archived.passId,
    }).lean();
    if (current) {
      await archiveOverwrittenResponse(current, { byUserId: req.user._id, via: 'restore' });
      await SurveyResponse.updateOne({ _id: current._id }, { $set: snapshot });
      // No stats change: one current row before and after the swap.
    } else {
      await SurveyResponse.create(snapshot);
      await bumpCampaignStats(archived.campaignId, { surveys: 1 });
    }
    await SurveyResponseArchive.deleteOne({ _id: archived._id });
    await recomputeSurveyStatus([String(archived.voterId)]);
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Erase a preserved response outright — the erasure complement to the preservation, so
// overwritten answer content (Art. 9 material) never becomes undeletable. No stats: archives
// are never counted anywhere.
router.delete('/:voterId/surveys/archive/:archiveId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.archiveId)) {
      return res.status(400).json({ error: 'Invalid archiveId' });
    }
    const { deletedCount } = await SurveyResponseArchive.deleteOne({
      _id: req.params.archiveId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
    });
    if (!deletedCount) return res.status(404).json({ error: 'Preserved response not found' });
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

export default router;
