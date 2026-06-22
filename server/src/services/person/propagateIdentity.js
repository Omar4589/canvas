import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { followMerged } from './resolvePerson.js';

// The 10 shared identity fields + fullName. This allowlist is the ONLY thing
// propagation ever writes — NEVER a match key (uid/uidSource/stateVoterId/
// registeredState), personId, surveyStatus, householdId, or a district field.
const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'fullName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

function pickIdentity(identity) {
  const out = {};
  for (const f of IDENTITY_FIELDS) if (identity[f] !== undefined) out[f] = identity[f] ?? null;
  if (out.fullName == null && (out.firstName != null || out.lastName != null)) {
    out.fullName = [out.firstName, out.lastName].filter(Boolean).join(' ') || null;
  }
  return out;
}

/**
 * The SINGLE chokepoint that writes a Person's shared identity and fans it to every
 * org's denormalized Voter cache. Used by import reconciliation, the admin edit path,
 * and merge. Optimistic-concurrency on the Person (identityVersion); per-voter fan-out
 * that honors `locallyEditedFields` and snapshots `identityBackup` once for rollback.
 * @returns the updated Person (or null if it vanished)
 */
export async function propagateIdentity(personId, identity, { orgId = null, source = 'import', userId = null, session } = {}) {
  let person = await followMerged(await Person.findById(personId).session(session || null), session);
  if (!person) return null;
  const fields = pickIdentity(identity);
  if (!Object.keys(fields).length) return person;

  // 1. Update the canonical Person doc (optimistic concurrency + dotted provenance).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const set = { ...fields };
    for (const [f, v] of Object.entries(fields)) {
      void v;
      set[`fieldProvenance.${f}`] = { source, orgId, userId, at: now, prevValue: person[f] ?? null };
    }
    const res = await Person.findOneAndUpdate(
      { _id: person._id, identityVersion: person.identityVersion },
      { $set: set, $inc: { identityVersion: 1 } },
      { new: true, session: session || undefined }
    );
    if (res) { person = res; break; }
    person = await Person.findById(person._id).session(session || null); // version drifted — reload + retry
    if (!person) return null;
  }

  // 2. Fan out to the Person's Voter caches across all orgs — per-voter so we honor
  //    locallyEditedFields and snapshot identityBackup once before the first overwrite.
  const proj = { _id: 1, locallyEditedFields: 1, identityBackup: 1 };
  for (const f of IDENTITY_FIELDS) proj[f] = 1;
  const voters = await Voter.find({ personId: person._id }, proj).session(session || null);
  const ops = [];
  for (const v of voters) {
    const locked = new Set(v.locallyEditedFields || []);
    const vset = {};
    for (const [f, val] of Object.entries(fields)) if (!locked.has(f)) vset[f] = val;
    if (!Object.keys(vset).length) continue;
    if (v.identityBackup == null) {
      const snap = {};
      for (const f of IDENTITY_FIELDS) snap[f] = v[f] ?? null;
      vset.identityBackup = snap;
    }
    ops.push({ updateOne: { filter: { _id: v._id }, update: { $set: vset } } });
  }
  if (ops.length) await Voter.bulkWrite(ops, { ordered: false, session: session || undefined });

  return person;
}
