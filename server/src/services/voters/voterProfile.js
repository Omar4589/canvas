import mongoose from 'mongoose';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { VoterNote } from '../../models/VoterNote.js';
import { User } from '../../models/User.js';

const KNOCK_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];
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

  const [voted, surveys, activity, voterNotesRaw, members, adminNotes] = await Promise.all([
    campaignId ? VotedVoter.findOne({ campaignId, voterId: voter._id }).lean() : null,
    SurveyResponse.find({ voterId: voter._id }).sort({ submittedAt: -1 }).lean(),
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
      { voterId: voter._id, note: { $exists: true, $ne: null, $not: /^\s*$/ } },
      '_id note timestamp actionType userId'
    )
      .sort({ timestamp: -1 })
      .lean(),
    household
      ? Voter.find({ householdId: voter.householdId }, 'fullName surveyStatus').lean()
      : [],
    VoterNote.find({ voterId: voter._id }).sort({ createdAt: -1 }).lean(),
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
  const tplIds = [...new Set(surveys.map((s) => String(s.surveyTemplateId)).filter(Boolean))];
  const tpls = tplIds.length
    ? await SurveyTemplate.find({ _id: { $in: tplIds } }, 'name version questions').lean()
    : [];
  const tplMap = new Map(tpls.map((t) => [String(t._id), t]));

  // Resolve user display names in one query.
  const userIds = new Set();
  const add = (id) => id && userIds.add(String(id));
  add(voter.lastEditedBy);
  for (const a of activity) add(a.userId);
  for (const n of voterNotesRaw) add(n.userId);
  for (const s of surveys) { add(s.userId); add(s.editedBy); }
  for (const n of adminNotes) { add(n.authorId); add(n.editedBy); }
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }, 'firstName lastName email').lean()
    : [];
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const who = (id) => {
    const u = id && uMap.get(String(id));
    return u ? { id: String(id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email } : null;
  };

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

  return {
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
      lastEditedAt: voter.lastEditedAt || null,
      lastEditedBy: who(voter.lastEditedBy),
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
              voted: memberVoted.has(String(m._id)),
            })),
        }
      : null,
    voted: voted
      ? { isVoted: true, votedAt: voted.votedAt || null, voteMethod: voted.voteMethod || null }
      : { isVoted: false },
    surveys: surveys.map((s) => {
      const tpl = tplMap.get(String(s.surveyTemplateId));
      return {
        id: String(s._id),
        campaignId: String(s.campaignId),
        passId: s.passId ? String(s.passId) : null,
        surveyTemplateId: String(s.surveyTemplateId),
        templateName: tpl?.name || null,
        submittedAt: s.submittedAt,
        editedAt: s.editedAt || null,
        editedBy: who(s.editedBy),
        by: who(s.userId),
        note: s.note || null,
        answers: (s.answers || []).map((a) => ({
          questionKey: a.questionKey,
          questionLabel: a.questionLabel,
          answer: a.answer,
        })),
        // Question defs (type/options) so the edit UI can render the right inputs.
        questions: (tpl?.questions || [])
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((q) => ({ key: q.key, label: q.label, type: q.type, options: q.options || [], required: !!q.required })),
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
