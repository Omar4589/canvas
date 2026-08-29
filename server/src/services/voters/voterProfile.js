import mongoose from 'mongoose';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { VoterNote } from '../../models/VoterNote.js';
import { User } from '../../models/User.js';
import { Person } from '../../models/Person.js';
import { Organization } from '../../models/Organization.js';

const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting'];
const hasText = (s) => typeof s === 'string' && s.trim() !== '';

// Build the full profile payload for one voter. Shared by the admin and mobile voter routes.
// orgId scopes the lookup (admin: active org; mobile: active org). Returns null if not found.
export async function buildVoterProfile(voterId, { orgId } = {}) {
  if (!mongoose.isValidObjectId(voterId)) return null;
  const voter = await Voter.findOne(
    orgId ? { _id: voterId, organizationId: orgId } : { _id: voterId }
  ).lean();
  if (!voter) return null;

  const household = voter.householdId ? await Household.findById(voter.householdId).lean() : null;
  const campaignId = household?.campaignId || null;
  const campaign = campaignId ? await Campaign.findById(campaignId, 'name type').lean() : null;

  // Sibling rows — the same person's row in each OTHER campaign of this org (rows are
  // per-campaign). The person-level histories below (surveys, notes) union over them; the
  // door-level pieces (household, members, activity, voted) stay this row's on purpose.
  const siblings = await Voter.find(
    { organizationId: voter.organizationId, stateVoterId: voter.stateVoterId, _id: { $ne: voter._id } },
    'campaignId householdId surveyStatus'
  ).lean();
  const personRowIds = [voter._id, ...siblings.map((s) => s._id)];

  const [voted, surveys, overwrites, activity, voterNotesRaw, members, adminNotes] = await Promise.all([
    campaignId ? VotedVoter.findOne({ campaignId, voterId: voter._id }).lean() : null,
    // All of the person's surveys, across campaigns — each carries its campaignId for labeling.
    SurveyResponse.find({ voterId: { $in: personRowIds } }).sort({ submittedAt: -1 }).lean(),
    // Preserved (overwritten) responses — read-only history the restore UI works from.
    SurveyResponseArchive.find({ voterId: { $in: personRowIds } }).sort({ overwrittenAt: -1 }).lean(),
    household
      ? CanvassActivity.find(
          { householdId: voter.householdId, actionType: { $in: KNOCK_ACTIONS } },
          '_id actionType timestamp userId note voterId'
        )
          .sort({ timestamp: -1 })
          .limit(50)
          .lean()
      : [],
    CanvassActivity.find(
      // Exclude survey_submitted: its note is the survey's note, surfaced below from
      // SurveyResponse (dual-ledger). Without this it appears twice. Mirrors the Notes
      // hub's doorMatch (routes/admin/reports.js). Sibling rows included — a field note
      // about the person belongs to the person.
      { voterId: { $in: personRowIds }, actionType: { $ne: 'survey_submitted' }, note: { $exists: true, $ne: null, $not: /^\s*$/ } },
      '_id note timestamp actionType userId'
    )
      .sort({ timestamp: -1 })
      .lean(),
    household
      ? Voter.find({ householdId: voter.householdId }, 'fullName surveyStatus doNotContact.flagged').lean()
      : [],
    // Admin notes are org-level and follow the person across campaigns.
    VoterNote.find({ voterId: { $in: personRowIds } }).sort({ createdAt: -1 }).lean(),
  ]);

  // Which household members have voted (for the members list).
  let memberVoted = new Set();
  if (campaignId && members.length) {
    const mv = await VotedVoter.find(
      { campaignId, voterId: { $in: members.map((m) => m._id) } },
      'voterId'
    ).lean();
    memberVoted = new Set(mv.map((r) => String(r.voterId)));
  }

  // Survey templates (for rendering/editing answers by question type).
  const tplIds = [
    ...new Set(
      [...surveys, ...overwrites].map((s) => String(s.surveyTemplateId)).filter(Boolean)
    ),
  ];
  const tpls = tplIds.length
    ? await SurveyTemplate.find({ _id: { $in: tplIds } }, 'name version questions').lean()
    : [];
  const tplMap = new Map(tpls.map((t) => [String(t._id), t]));

  // Resolve user display names in one query.
  const userIds = new Set();
  const add = (id) => id && userIds.add(String(id));
  add(voter.lastEditedBy);
  add(voter.doNotContact?.byUserId);
  add(voter.doorAdded?.byUserId);
  for (const a of activity) add(a.userId);
  for (const n of voterNotesRaw) add(n.userId);
  for (const s of surveys) { add(s.userId); add(s.editedBy); add(s.deskEntry?.byUserId); }
  for (const o of overwrites) { add(o.userId); add(o.editedBy); add(o.overwrittenBy); add(o.deskEntry?.byUserId); }
  for (const n of adminNotes) { add(n.authorId); add(n.editedBy); }
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }, 'firstName lastName email').lean()
    : [];
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const who = (id) => {
    const u = id && uMap.get(String(id));
    return u ? { id: String(id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email } : null;
  };

  // Latest preserved response per (voter, pass) — `overwrites` is sorted overwrittenAt desc,
  // so first-seen wins.
  const overwriteByKey = new Map();
  for (const o of overwrites) {
    const key = `${String(o.voterId)}|${o.passId ? String(o.passId) : ''}`;
    if (!overwriteByKey.has(key)) overwriteByKey.set(key, o);
  }

  // Derived (read-only) voter notes: voter-tagged activity notes + survey notes.
  const fieldNotes = [
    ...voterNotesRaw.map((a) => ({
      source: 'activity',
      id: String(a._id),
      note: a.note,
      timestamp: a.timestamp,
      actionType: a.actionType,
      by: who(a.userId),
    })),
    ...surveys
      .filter((s) => hasText(s.note))
      .map((s) => ({
        source: 'survey',
        id: String(s._id),
        note: s.note,
        timestamp: s.submittedAt,
        actionType: 'survey_submitted',
        by: who(s.userId),
      })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // The Person link, for this org only.
  //
  // This block used to resolve `ownerOrgName` — it looked up the OTHER customer organization that
  // "managed" this person's identity and returned their NAME, which the voter page then rendered as
  // "This person's identity is managed by {Acme Field Group}". One customer was being told, by name,
  // that another customer had the same voter in their file. For firms whose competitors are also our
  // customers, that is a disclosure they never agreed to.
  //
  // A Person now belongs to exactly one org (models/Person.js), so there is no other owner to name
  // and nothing to look up. Everything a customer sees about a Person is now their own.
  let person = null;
  if (voter.personId) {
    const p = await Person.findById(voter.personId, 'organizationId').lean();
    // Defensive: a Person from another org should be unreachable, but never surface one if it is.
    if (p && String(p.organizationId) === String(orgId)) {
      person = { id: String(voter.personId) };
    }
  }

  // The person's presence in other campaigns (additive — clients that don't know it ignore it).
  let otherCampaigns = [];
  if (siblings.length) {
    const sibCamps = await Campaign.find(
      { _id: { $in: [...new Set(siblings.map((s) => String(s.campaignId)))] } },
      'name'
    ).lean();
    const sibCampMap = new Map(sibCamps.map((c) => [String(c._id), c.name]));
    otherCampaigns = siblings.map((s) => ({
      campaignId: String(s.campaignId),
      name: sibCampMap.get(String(s.campaignId)) || null,
      voterId: String(s._id),
      surveyStatus: s.surveyStatus,
    }));
  }

  return {
    person,
    otherCampaigns,
    voter: {
      id: String(voter._id),
      stateVoterId: voter.stateVoterId,
      uid: voter.uid || null,
      firstName: voter.firstName,
      lastName: voter.lastName,
      fullName: voter.fullName,
      phone: voter.phone || null,
      phoneType: voter.phoneType || null,
      cellPhone: voter.cellPhone || null,
      email: voter.email || null,
      party: voter.party || null,
      gender: voter.gender || null,
      dateOfBirth: voter.dateOfBirth || null,
      registrationStatus: voter.registrationStatus || null,
      registeredState: voter.registeredState || null,
      congressionalDistrict: voter.congressionalDistrict || null,
      stateSenateDistrict: voter.stateSenateDistrict || null,
      stateHouseDistrict: voter.stateHouseDistrict || null,
      precinct: voter.precinct || null,
      surveyStatus: voter.surveyStatus,
      // Identity fields a hand edit armed against re-imports (routes/admin/voters.js PATCH) —
      // the profile shows which values are protected so an admin knows why a file didn't move them.
      protectedFields: voter.locallyEditedFields || [],
      // The reason is visible here (an online, scoped read — same exposure class as the admin
      // notes below); the offline bootstrap cache carries only a boolean, never the reason.
      doNotContact: voter.doNotContact?.flagged
        ? {
            flagged: true,
            at: voter.doNotContact.at || null,
            reason: voter.doNotContact.reason || null,
            source: voter.doNotContact.source || 'admin',
            by: who(voter.doNotContact.byUserId),
          }
        : { flagged: false },
      lastEditedAt: voter.lastEditedAt || null,
      lastEditedBy: who(voter.lastEditedBy),
      // Walk-up provenance: this row was typed at a door, not imported. Who/when powers the
      // "Added at the door" banner and gates the admin delete (doorAdded rows only).
      doorAdded: voter.doorAdded
        ? { at: voter.doorAdded.at || null, by: who(voter.doorAdded.byUserId) }
        : null,
    },
    household: household
      ? {
          id: String(household._id),
          addressLine1: household.addressLine1,
          addressLine2: household.addressLine2 || null,
          city: household.city,
          state: household.state,
          zipCode: household.zipCode,
          county: household.county || null,
          status: household.status,
          fullyVoted: !!household.fullyVoted,
          fullyDnc: !!household.fullyDnc,
          doNotKnock: !!household.doNotKnock,
          turfId: household.turfId ? String(household.turfId) : null,
          location: household.location || null,
          campaign: campaign
            ? { id: String(campaign._id), name: campaign.name, type: campaign.type }
            : null,
          members: members
            .filter((m) => String(m._id) !== String(voter._id))
            .map((m) => ({
              id: String(m._id),
              fullName: m.fullName,
              surveyStatus: m.surveyStatus,
              dnc: !!m.doNotContact?.flagged,
              voted: memberVoted.has(String(m._id)),
            })),
        }
      : null,
    voted: voted
      ? { isVoted: true, votedAt: voted.votedAt || null, voteMethod: voted.voteMethod || null }
      : { isVoted: false },
    surveys: surveys.map((s) => {
      const tpl = tplMap.get(String(s.surveyTemplateId));
      // Desk-entered: an admin typed these answers when converting a door outcome to Surveyed,
      // rather than a canvasser collecting them at the door. Absence means field-collected, so
      // every pre-existing response reads exactly as it did before.
      const desk = s.deskEntry
        ? { by: who(s.deskEntry.byUserId), at: s.deskEntry.at, fromOutcome: s.deskEntry.fromOutcome || null }
        : null;
      // The latest preserved response this one replaced, if any — keyed by (voter, pass), so
      // the profile UI can say "replaced X's earlier answers" and offer the restore.
      const ow = overwriteByKey.get(`${String(s.voterId)}|${s.passId ? String(s.passId) : ''}`);
      return {
        id: String(s._id),
        campaignId: String(s.campaignId),
        passId: s.passId ? String(s.passId) : null,
        surveyTemplateId: String(s.surveyTemplateId),
        templateName: tpl?.name || null,
        submittedAt: s.submittedAt,
        editedAt: s.editedAt || null,
        editedBy: who(s.editedBy),
        deskEntry: desk,
        by: who(s.userId),
        note: s.note || null,
        replacedEarlier: ow
          ? {
              overwriteId: String(ow._id),
              by: who(ow.userId),
              submittedAt: ow.submittedAt,
              overwrittenAt: ow.overwrittenAt,
            }
          : null,
        answers: (s.answers || []).map((a) => ({
          questionKey: a.questionKey,
          questionLabel: a.questionLabel,
          answer: a.answer,
          // The editor round-trips what it receives. Without these two the "Other" pick and its
          // typed text could not be rendered OR sent back, so re-normalizing on save de-classified
          // the answer: optionIds went empty, otherText null, and the write-in silently dropped
          // out of its reporting bucket into a junk bucket named after the typed text.
          optionIds: a.optionIds || [],
          otherText: a.otherText ?? null,
        })),
        // Question defs (type/options) so the edit UI can render the right inputs.
        questions: (tpl?.questions || [])
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          // otherOption rides along so the editor can materialize the synthetic "Other (specify)"
          // choice — it is a question FLAG, never a row in options[].
          .map((q) => ({
            key: q.key,
            label: q.label,
            type: q.type,
            options: q.options || [],
            required: !!q.required,
            otherOption: !!q.otherOption,
          })),
      };
    }),
    // Preserved (overwritten) responses — read-only; restore/erase act on `id` (the archive id).
    overwrittenSurveys: overwrites.map((o) => {
      const tpl = tplMap.get(String(o.surveyTemplateId));
      return {
        id: String(o._id),
        campaignId: String(o.campaignId),
        passId: o.passId ? String(o.passId) : null,
        surveyTemplateId: String(o.surveyTemplateId),
        templateName: tpl?.name || null,
        submittedAt: o.submittedAt,
        editedAt: o.editedAt || null,
        editedBy: who(o.editedBy),
        by: who(o.userId),
        note: o.note || null,
        overwrittenAt: o.overwrittenAt,
        // 'outcome_convert' means this answer was removed when an admin converted the door away
        // from Surveyed — the clients MUST word that differently from an overwrite, or it reads as
        // an accusation against the canvasser for something an admin did.
        overwrittenVia: o.overwrittenVia,
        overwrittenBy: who(o.overwrittenBy),
        deskEntry: o.deskEntry
          ? { by: who(o.deskEntry.byUserId), at: o.deskEntry.at }
          : null,
        answers: (o.answers || []).map((a) => ({
          questionKey: a.questionKey,
          questionLabel: a.questionLabel,
          answer: a.answer,
          // The editor round-trips what it receives. Without these two the "Other" pick and its
          // typed text could not be rendered OR sent back, so re-normalizing on save de-classified
          // the answer: optionIds went empty, otherText null, and the write-in silently dropped
          // out of its reporting bucket into a junk bucket named after the typed text.
          optionIds: a.optionIds || [],
          otherText: a.otherText ?? null,
        })),
      };
    }),
    activity: activity.map((a) => ({
      id: String(a._id),
      actionType: a.actionType,
      timestamp: a.timestamp,
      by: who(a.userId),
      note: hasText(a.note) ? a.note : null,
    })),
    notes: {
      admin: adminNotes.map((n) => ({
        id: String(n._id),
        body: n.body,
        author: who(n.authorId),
        createdAt: n.createdAt,
        editedAt: n.editedAt || null,
        editedBy: who(n.editedBy),
      })),
      field: fieldNotes,
    },
  };
}
