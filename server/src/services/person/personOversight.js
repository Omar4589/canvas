import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Organization } from '../../models/Organization.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VoterNote } from '../../models/VoterNote.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
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
    // The person's own org (Persons are org-scoped) — the merge picker searches within it.
    organizationId: p.organizationId ? String(p.organizationId) : null,
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
 * party, and phone. (It USED to also ship street addresses, zip/county, the stateVoterId list, and
 * full pre-merge identity snapshots that the UI never rendered — trimmed July 2026 to city/state +
 * counts; see the inline notes below.)
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
      // People, not rows — voter rows are per-campaign, so a person in 2 campaigns has 2
      // linked rows; voterCount stays "how many distinct voters", rowCount says how many
      // campaign rows carry them (equal unless the org runs them in multiple campaigns).
      voterCount: new Set(voters.map((v) => v.stateVoterId)).size,
      voterRowCount: voters.length,
      // City/state ONLY — data-minimized July 2026. This payload used to ship the full street
      // addresses, zip, county, and the linked stateVoterId list to the browser while the UI
      // rendered only "City, ST". PII that crosses the wire with no rendering purpose is exposure
      // for nothing; if a future view needs the street, add it deliberately (it is voter content —
      // grant-gated + logged at the route) rather than resurrecting the blanket dump.
      addresses: households.map((h) => ({
        city: h.city,
        state: h.state,
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

  // Edit proposals no longer ship here: the mechanism is vestigial post-per-org (the importing org
  // owns its Person, so nothing files them; batch-3 also fixed the owner-less `owns` check that
  // could). The pending-proposal UI block was removed with it. The writer/routes stay intact.
  const [candidates, mergeLog] = await Promise.all([
    PersonMergeCandidate.find({ $or: [{ personIdA: person._id }, { personIdB: person._id }] })
      .sort({ status: 1, createdAt: -1 }).lean(),
    PersonMergeLog.find({ $or: [{ survivorId: person._id }, { victimId: person._id }] })
      .sort({ createdAt: -1 }).lean(),
  ]);

  return {
    person: serializePerson(person, { ownerOrgName: ownerId ? orgNameById.get(ownerId) || null : null }),
    requestedId: String(personId),
    isTombstone,
    orgCount: orgs.length,
    orgs,
    candidates: candidates.map((c) => ({ ...c, _id: String(c._id) })),
    // Explicit shape, not a spread: the raw log rows carry full pre-merge identity snapshots
    // (survivorSnapshot/victimSnapshot — name, DOB, party) that exist for split-reversal, not for
    // display. They stay server-side; the UI shows action/date/count/ids only.
    mergeLog: mergeLog.map((l) => ({
      _id: String(l._id),
      action: l.action,
      survivorId: String(l.survivorId),
      victimId: l.victimId ? String(l.victimId) : null,
      movedVoterCount: (l.movedVoterIds || []).length,
      createdAt: l.createdAt,
    })),
  };
}
