import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Voter } from '../../models/Voter.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { VoterNote } from '../../models/VoterNote.js';
import { AccessLog } from '../../models/AccessLog.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { recomputeSurveyStatus } from '../../services/canvass/status.js';
import { bumpCampaignStats } from '../../services/reports/campaignCounters.js';
import { recomputeResidentFlags } from '../../services/households/recomputeResidentFlags.js';
import { archiveOverwrittenResponse, snapshotFromArchive } from '../../services/surveys/archiveOverwrite.js';
import { restoreStates, RESTORE_BLOCKED_MESSAGES } from '../../services/surveys/restoreGuard.js';
import { planFromAnswers, applyEditPlan, editorVersion } from '../../services/canvass/answerEdit.js';
import { writeOneSurvey, fencesForSlots, withFences } from '../../services/canvass/answerEditWriter.js';
import { buildVoterProfile } from '../../services/voters/voterProfile.js';
import { listVoters, pageParams, isDirectoryTimeout, DIRECTORY_TIMEOUT_MESSAGE } from '../../services/voters/voterDirectory.js';
import { createVoterNote } from '../../services/voters/voterNotes.js';
import { recomputeFullyDnc } from '../../services/dnc/recomputeFullyDnc.js';
import { Person } from '../../models/Person.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { propagateIdentity, identityEq } from '../../services/person/propagateIdentity.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { followMerged } from '../../services/person/resolvePerson.js';
import { runStillWriting } from '../../services/canvass/answerEditRuns.js';

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

// GET /admin/voters — org-wide directory with search, filters, server-side pagination. The query
// is services/voters/voterDirectory.js, the ONE owner this shares with the campaign-nested router
// (routes/admin/campaignVoters.js, where the URL is the scope); here a validated ?campaignId
// narrows the org view to one campaign and anything else means the whole org.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { limit, skip } = pageParams(req.query);
    const campaignId =
      req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
        ? new mongoose.Types.ObjectId(req.query.campaignId)
        : null;
    res.json(await listVoters({ orgId, campaignId, query: req.query, limit, skip }));
  } catch (err) {
    // The budget expired (isDirectoryTimeout): an honest, coded 503 instead of Heroku's HTML one —
    // the web client shows the sentence and a Retry, and never re-runs a capped request on its own.
    if (isDirectoryTimeout(err)) {
      return res.status(503).json({ error: DIRECTORY_TIMEOUT_MESSAGE, code: 'DIRECTORY_TIMEOUT' });
    }
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
//  - Household invariants recomputed (services/households/recomputeResidentFlags.js); the
//    recomputes' updatedAt bump also tells phones the door changed. Phones that already hold
//    the voter keep a phantom row until their next full bootstrap (a deleted doc can't ride
//    the delta) — a survey against it 404s and the offline queue drops it. If this was the
//    door's ONLY voter, the door deactivates and the delta drops it from phones entirely; if
//    everyone left has voted early, or asked not to be contacted, it drops the same way.
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

    await recomputeResidentFlags(voter.campaignId, [voter.householdId]);

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
    const note = await createVoterNote({
      orgId: activeOrgId(req),
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
  // The editors' version (services/canvass/answerEdit.js editorVersion), captured when Edit opened:
  // a survey that changed since — re-surveyed, edited in another tab, its note changed — refuses
  // 409 RESPONSE_CHANGED instead of writing back what the editor saw. Optional so a request that
  // doesn't send one still saves (it just isn't checked).
  version: z.string().max(100).optional(),
});

// Edit one survey from the profile — through the SAME writer and per-person plan as Door
// Outcomes' one-person-at-a-time walkthrough (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §J):
//   • the posted answers become a per-question diff against what's stored, so an untouched save
//     writes nothing and an old 3-key row nobody changed stays a 3-key row;
//   • an answer the change makes hidden is dropped (owner ruling 2) — it stays in the copy;
//   • the EARLIER version is archived (via 'answer_edit') before the write, as a restorable card
//     (owner ruling 4) — this used to destroy it;
//   • changed answers stamp editedBy/editedAt, a changed note stamps its own noteEdited* — so a
//     note reads edited only when the note changed.
router.patch('/:voterId/surveys/:responseId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.responseId) || !mongoose.isValidObjectId(req.params.voterId)) {
      return res.status(400).json({ error: 'Invalid responseId' });
    }
    const data = editSurveySchema.parse(req.body);
    const live = await SurveyResponse.collection.findOne({
      _id: new mongoose.Types.ObjectId(req.params.responseId),
      voterId: new mongoose.Types.ObjectId(req.params.voterId),
      organizationId: activeOrgId(req),
    });
    if (!live) return res.status(404).json({ error: 'Survey response not found' });
    const changedResponse = async () =>
      res.status(409).json({
        error: 'Someone changed this survey while you were editing. The latest answers are shown — make your change again.',
        code: 'RESPONSE_CHANGED',
        profile: await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) }),
      });
    if (data.version && editorVersion(live) !== data.version) return changedResponse();

    const template = await SurveyTemplate.findById(live.surveyTemplateId).lean();
    let nextAnswers = null;
    if (data.answers !== undefined) {
      if (template) {
        const plan = planFromAnswers(template.questions, live.answers || [], data.answers);
        const applied = plan.length
          ? applyEditPlan(template.questions, live.answers || [], plan, { mode: 'person', flow: template.flow })
          : null;
        if (applied?.changed) nextAnswers = applied.answers;
      } else if (data.answers.length) {
        // No template to diff against: the editor posts only the questions it touched, so storing
        // what was sent would wipe every other answer. Refuse; the note can still be changed (the
        // editor sends an empty list when no answer was touched — that is a note-only save).
        return res.status(409).json({
          error: 'This survey’s questions are no longer on file, so its answers can’t be edited here. Its note can still be changed.',
          code: 'TEMPLATE_MISSING',
        });
      }
    }
    const note = data.note === undefined ? undefined : data.note || null;
    const nextNote = note !== undefined && note !== (live.note ?? null) ? note : undefined;

    if (nextAnswers || nextNote !== undefined) {
      const w = await writeOneSurvey({ live, nextAnswers, nextNote, byUserId: req.user._id, at: new Date() });
      if (w.conflict) return changedResponse();
      await recomputeSurveyStatus([live.voterId]);
    }
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
//
// Only into a visit that still reads Surveyed (services/surveys/restoreGuard.js): an unknocked or
// converted visit, or one the canvasser re-recorded, refuses 409 RESTORE_VISIT_NOT_SURVEYED rather
// than putting a counted survey under a door that says it wasn't surveyed.
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
    // Not while an undo is writing this copy back (it claims the copy first): both would write the
    // survey (code review round 5). A claim older than ten minutes belongs to an undo that died.
    if (archived.undoStartedAt && Date.now() - new Date(archived.undoStartedAt).getTime() < 10 * 60 * 1000) {
      return res.status(409).json({ error: 'An undo is putting these answers back right now. Try again in a moment.', code: 'COPY_IN_USE' });
    }

    const state = (await restoreStates([archived])).get(String(archived._id));
    if (!state.restorable) {
      return res.status(409).json({
        error: RESTORE_BLOCKED_MESSAGES[state.reason],
        code: 'RESTORE_VISIT_NOT_SURVEYED',
        reason: state.reason,
      });
    }

    const snapshot = snapshotFromArchive(archived);
    const current = await SurveyResponse.collection.findOne({
      voterId: archived.voterId,
      passId: archived.passId ?? null,
    });
    // An answer-edit copy going back onto the SAME survey (same canvasser, same moment — the
    // survey's own visit) is itself an answer edit: through the writer, so the version it replaces
    // is archived the same way, the edit is stamped, and the run that made the copy can still tell
    // what happened to it. Onto a teammate's survey it is today's full swap below — writing one
    // canvasser's answers into another's survey is what review round 2 reproduced.
    const ownVisit =
      current &&
      archived.overwrittenVia === 'answer_edit' &&
      String(current.userId) === String(archived.userId) &&
      current.submittedAt &&
      archived.submittedAt &&
      new Date(current.submittedAt).getTime() === new Date(archived.submittedAt).getTime();
    if (ownVisit) {
      const w = await writeOneSurvey({
        live: current,
        nextAnswers: archived.answers || [],
        nextNote: (archived.note ?? null) !== (current.note ?? null) ? archived.note ?? null : undefined,
        byUserId: req.user._id,
        at: new Date(),
        // The copy is used up: its mark comes off in the same write, so the run that made it reads
        // the survey as restored on the profile, not erased.
        consumedMark: archived._id,
      });
      if (w.conflict) {
        return res.status(409).json({
          error: 'Someone changed this survey a moment ago, so nothing was restored. Check its latest answers, then try again.',
          code: 'RESPONSE_CHANGED',
          profile: await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) }),
        });
      }
    } else if (current) {
      const copyId = await archiveOverwrittenResponse(current, { byUserId: req.user._id, via: 'restore' });
      // The live row becomes the snapshot. Fields the snapshot doesn't carry must go too: a field
      // snapshot has no deskEntry (left behind, undoing that desk entry would delete the restored
      // field answers), and one copied before note stamps and landing marks existed has none —
      // keeping the displaced survey's would show another note's stamp, or a mark that isn't true.
      const unset = {};
      for (const f of ['deskEntry', 'noteEditedBy', 'noteEditedAt', 'answerEditMarks']) {
        if (snapshot[f] === undefined) unset[f] = '';
      }
      // A compare-and-swap on the survey as read (its updatedAt): one that changed in between (a
      // phone re-survey, an undo) would be replaced without the copy above holding it.
      // Fences and undo receipts are this SLOT's history, not the copy's: kept from the survey being
      // replaced, plus every answer-edit run whose undo has reached it (round 3: the copy's older
      // list replaced them, and a delivery still running could land on the restored survey).
      const fences = await fencesForSlots(archived.campaignId, [snapshot]);
      const kept = withFences(snapshot, fences, current.answerEditFence || []);
      const receipts = [...new Map([...(snapshot.answerEditUndone || []), ...(current.answerEditUndone || [])].map((id) => [String(id), id])).values()];
      if (receipts.length) kept.answerEditUndone = receipts;
      const swapped = await SurveyResponse.updateOne(
        { _id: current._id, updatedAt: current.updatedAt ?? { $exists: false } },
        { $set: kept, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
      );
      if (swapped.matchedCount !== 1) {
        await SurveyResponseArchive.deleteOne({ _id: copyId });
        return res.status(409).json({
          error: 'Someone changed this survey a moment ago, so nothing was restored. Check its latest answers, then try again.',
          code: 'RESPONSE_CHANGED',
          profile: await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) }),
        });
      }
      // No stats change: one current row before and after the swap.
    } else {
      // Not re-validated: a verbatim copy of a row that was already on file (archiveOverwrite.js).
      const fences = await fencesForSlots(archived.campaignId, [snapshot]);
      await SurveyResponse.create([withFences(snapshot, fences)], { validateBeforeSave: false });
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
    // Not while an undo is putting this copy back — an answer edit's, an unknock's or a conversion's
    // (each stamps the copy first): erasing it mid-way would let the put-back write the erased answers
    // onto the survey (round 5 for the removal undos). A stamp older than ten minutes belongs to an undo
    // that died; it never blocks.
    const ERASE_WAIT_MS = 10 * 60 * 1000;
    // Nor while the change that made an answer-edit copy is still applying: its delivery writes the
    // survey right after making the copy, and erasing in between left the survey edited with no copy
    // of what it said before (round 3).
    const target = await SurveyResponseArchive.findOne(
      { _id: req.params.archiveId, voterId: req.params.voterId, organizationId: activeOrgId(req) },
      { answerEditRunId: 1 }
    ).lean();
    if (target?.answerEditRunId && (await runStillWriting(target.answerEditRunId))) {
      return res.status(409).json({ error: 'The change that kept these answers is still being applied. Try again once it finishes.', code: 'COPY_IN_USE' });
    }
    const { deletedCount } = await SurveyResponseArchive.deleteOne({
      _id: req.params.archiveId,
      voterId: req.params.voterId,
      organizationId: activeOrgId(req),
      $or: [{ undoStartedAt: { $exists: false } }, { undoStartedAt: { $lt: new Date(Date.now() - ERASE_WAIT_MS) } }],
    });
    if (!deletedCount) {
      const busy = await SurveyResponseArchive.exists({ _id: req.params.archiveId, voterId: req.params.voterId, organizationId: activeOrgId(req) });
      if (busy) {
        return res.status(409).json({ error: 'An undo is putting these answers back right now. Try again in a moment.', code: 'COPY_IN_USE' });
      }
      return res.status(404).json({ error: 'Preserved response not found' });
    }
    const profile = await buildVoterProfile(req.params.voterId, { orgId: activeOrgId(req) });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

export default router;
