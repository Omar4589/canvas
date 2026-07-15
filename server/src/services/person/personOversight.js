import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Organization } from '../../models/Organization.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VoterNote } from '../../models/VoterNote.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { PersonMergeLog } from '../../models/PersonMergeLog.js';
import { followMerged } from './resolvePerson.js';

// The shared identity fields the Person is the source of truth for. Districting/precinct
// is deliberately NOT here (stays per-org on the Voter).
export const PERSON_IDENTITY_FIELDS = [
  'firstName', 'lastName', 'fullName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

const maxDate = (...ds) => {
  const t = ds.filter(Boolean).map((d) => +new Date(d)).filter((n) => Number.isFinite(n));
  return t.length ? new Date(Math.max(...t)) : null;
};

// Public-shape serialization of a canonical Person (identity + governance + keys only —
// never a canvassing field; Person carries none by design).
export function serializePerson(p, { ownerOrgName = null } = {}) {
  if (!p) return null;
  return {
    id: String(p._id),
    firstName: p.firstName || null,
    lastName: p.lastName || null,
    fullName: p.fullName || null,
    phone: p.phone || null,
    phoneType: p.phoneType || null,
    cellPhone: p.cellPhone || null,
    party: p.party || null,
    gender: p.gender || null,
    dateOfBirth: p.dateOfBirth || null,
    registrationStatus: p.registrationStatus || null,
    uidKeys: (p.uidKeys || []).map((k) => ({ uidSource: k.uidSource, uid: k.uid, source: k.source, at: k.at })),
    svidKeys: (p.svidKeys || []).map((k) => ({ registeredState: k.registeredState, stateVoterId: k.stateVoterId, source: k.source, at: k.at })),
    identityOwnerOrgId: p.identityOwnerOrgId ? String(p.identityOwnerOrgId) : null,
    ownerOrgName,
    ownerProvisional: !!p.ownerProvisional,
    lockedFields: p.lockedFields || [],
    matchConfidence: p.matchConfidence || null,
    identityVersion: p.identityVersion || 0,
    fieldProvenance: p.fieldProvenance || {},
    mergedInto: p.mergedInto ? String(p.mergedInto) : null,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

/**
 * Super-admin per-person oversight view.
 *
 * The old comment here claimed this returns "counts / dates / booleans / status tallies only." THAT
 * WAS FALSE, and a false comment about a privacy boundary is worse than no comment — it is what a
 * reviewer reads instead of the code. This function returns the person's full name, date of birth,
 * party, phone, state voter ID, and their HOME ADDRESSES.
 *
 * What IS true, and is worth keeping: the CANVASSING side really is structural. Every survey/activity/
 * note figure is an aggregation $group/$count, and this never reads a survey answer
 * (SurveyResponse.answers/note), a canvass note (CanvassActivity.note), or a voter note body
 * (VoterNote.body) into memory. So the vendor sees THAT a person was surveyed three times and refused
 * twice — never what they said.
 *
 * The identity fields it does return are voter content. The route that serves this
 * (routes/superAdmin/persons.js) enforces the access rule: break-glass authority, PLUS a live
 * SupportAccessGrant for the person's organization, with an AccessLog row written on every call. This
 * function itself enforces nothing — it is a serializer — so do not cite this comment as the control;
 * the control lives at the route. (An earlier version of this comment claimed the grant/audit was in
 * force when it was NOT — the router had only requireSuperAdmin and no logging — which is exactly how a
 * false reassurance ends up quoted in a privacy policy. The route now makes the claim true.)
 *
 * Returns null if the person doesn't exist.
 */
export async function buildPersonOversight(personId) {
  const raw = await Person.findById(personId);
  if (!raw) return null;
  const person = await followMerged(raw); // resolve tombstones to the live survivor
  const isTombstone = String(person._id) !== String(personId);

  // Orgs that touched this person, derived from Voter. (A Person now carries its own organizationId —
  // Person.js makes it required — but a Person is single-org post-remediation, so the Voter-derived set
  // is the same one org, plus it surfaces the linked-voter detail this view needs anyway.)
  const orgIds = await Voter.distinct('organizationId', { personId: person._id });
  const ownerId = person.identityOwnerOrgId ? String(person.identityOwnerOrgId) : null;
  const orgLookupIds = [...new Set([...orgIds.map(String), ...(ownerId ? [ownerId] : [])])];
  const orgDocs = orgLookupIds.length
    ? await Organization.find({ _id: { $in: orgLookupIds } }, 'name').lean()
    : [];
  const orgNameById = new Map(orgDocs.map((o) => [String(o._id), o.name]));

  const orgs = [];
  for (const orgId of orgIds) {
    const voters = await Voter.find(
      { personId: person._id, organizationId: orgId },
      '_id stateVoterId surveyStatus householdId'
    ).lean();
    const orgVoterIds = voters.map((v) => v._id);

    const hhIds = [...new Set(voters.map((v) => (v.householdId ? String(v.householdId) : null)).filter(Boolean))];
    const households = hhIds.length
      ? await Household.find(
          { _id: { $in: hhIds } },
          'addressLine1 addressLine2 city state zipCode county'
        ).lean()
      : [];

    const surveyStatus = voters.reduce((m, v) => {
      const k = v.surveyStatus || 'not_surveyed';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

    // Aggregations — $group/$count never emit answers/note, so these are leak-proof.
    const [surv] = await SurveyResponse.aggregate([
      { $match: { organizationId: orgId, voterId: { $in: orgVoterIds } } },
      { $group: { _id: null, count: { $sum: 1 }, last: { $max: '$submittedAt' } } },
    ]);
    const actAgg = await CanvassActivity.aggregate([
      { $match: { organizationId: orgId, voterId: { $in: orgVoterIds } } },
      { $group: { _id: '$actionType', count: { $sum: 1 }, last: { $max: '$timestamp' } } },
    ]);
    const [voted] = await VotedVoter.aggregate([
      { $match: { organizationId: orgId, voterId: { $in: orgVoterIds } } },
      { $group: { _id: null, count: { $sum: 1 }, last: { $max: '$votedAt' } } },
    ]);
    const noteCount = await VoterNote.countDocuments({ organizationId: orgId, voterId: { $in: orgVoterIds } });

    orgs.push({
      organizationId: String(orgId),
      organizationName: orgNameById.get(String(orgId)) || null,
      voterCount: voters.length,
      voterIds: voters.map((v) => v.stateVoterId),
      addresses: households.map((h) => ({
        addressLine1: h.addressLine1,
        addressLine2: h.addressLine2 || null,
        city: h.city,
        state: h.state,
        zipCode: h.zipCode,
        county: h.county || null,
      })),
      surveyStatus,
      surveyCount: surv?.count || 0,
      activityTally: Object.fromEntries(actAgg.map((a) => [a._id, a.count])),
      votedCount: voted?.count || 0,
      noteCount,
      lastActivityAt: maxDate(surv?.last, voted?.last, ...actAgg.map((a) => a.last)),
    });
  }
  orgs.sort((a, b) => (a.organizationName || '').localeCompare(b.organizationName || ''));

  const [candidates, proposals, mergeLog] = await Promise.all([
    PersonMergeCandidate.find({ $or: [{ personIdA: person._id }, { personIdB: person._id }] })
      .sort({ status: 1, createdAt: -1 }).lean(),
    PersonEditProposal.find({ personId: person._id }).sort({ createdAt: -1 }).lean(),
    PersonMergeLog.find({ $or: [{ survivorId: person._id }, { victimId: person._id }] })
      .sort({ createdAt: -1 }).lean(),
  ]);

  // A proposal's org may not be among the orgs that currently have a linked voter (e.g. it
  // undid its import but another org keeps the person alive). Resolve those names too so the
  // client never has to fall back to a raw ObjectId.
  const propOrgIds = [...new Set(proposals.map((p) => String(p.orgId)).filter((id) => !orgNameById.has(id)))];
  if (propOrgIds.length) {
    const extra = await Organization.find({ _id: { $in: propOrgIds } }, 'name').lean();
    for (const o of extra) orgNameById.set(String(o._id), o.name);
  }

  return {
    person: serializePerson(person, { ownerOrgName: ownerId ? orgNameById.get(ownerId) || null : null }),
    requestedId: String(personId),
    isTombstone,
    orgCount: orgs.length,
    orgs,
    candidates: candidates.map((c) => ({ ...c, _id: String(c._id) })),
    proposals: proposals.map((p) => ({ ...p, _id: String(p._id), orgName: orgNameById.get(String(p.orgId)) || null })),
    mergeLog: mergeLog.map((l) => ({ ...l, _id: String(l._id) })),
  };
}
