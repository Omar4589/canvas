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

// Build the locked-honored identity fields + the dotted-provenance `$set` for a canonical
// Person update from a person SNAPSHOT. Returns null when nothing remains to write. Shared
// by the per-person propagate retry loop and the batched import path (reconcile) so both
// produce the byte-identical canonical write.
export function buildCanonicalSet(person, identity, { orgId = null, source = 'import', userId = null } = {}) {
  const fields = pickIdentity(identity);
  const honorsLocks = source !== 'super_admin' && source !== 'merge';
  if (honorsLocks && (person.lockedFields || []).length) {
    const locked = new Set(person.lockedFields);
    if (locked.has('firstName') || locked.has('lastName')) locked.add('fullName');
    for (const f of Object.keys(fields)) if (locked.has(f)) delete fields[f];
  }
  if (!Object.keys(fields).length) return null;
  const now = new Date();
  const set = { ...fields };
  for (const f of Object.keys(fields)) {
    set[`fieldProvenance.${f}`] = { source, orgId, userId, at: now, prevValue: person[f] ?? null };
  }
  return { fields, set };
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
  // 1. Update the canonical Person doc (optimistic concurrency + dotted provenance).
  //    buildCanonicalSet honors super-admin field locks (a locked name component also pins
  //    fullName) and records provenance; it's rebuilt against the reloaded person on each
  //    version-drift retry. Shared with the batched import path in reconcileIdentityFromImport.
  let built = buildCanonicalSet(person, identity, { orgId, source, userId });
  if (!built) return person;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await Person.findOneAndUpdate(
      { _id: person._id, identityVersion: person.identityVersion },
      { $set: built.set, $inc: { identityVersion: 1 } },
      { new: true, session: session || undefined }
    );
    if (res) { person = res; break; }
    person = await Person.findById(person._id).session(session || null); // version drifted — reload + retry
    if (!person) return null;
    built = buildCanonicalSet(person, identity, { orgId, source, userId });
  }
  const fields = built.fields;

  // 2. Fan out to the Person's Voter caches across all orgs — per-voter so we honor
  //    locallyEditedFields and snapshot identityBackup once before the first overwrite.
  const proj = { _id: 1, locallyEditedFields: 1, identityBackup: 1 };
  for (const f of IDENTITY_FIELDS) proj[f] = 1;
  // Paginate by _id (lean) so a Person with thousands of cross-org voters never holds the
  // whole set in memory — flush a bulkWrite per page. Same ops as a single pass, just batched.
  const PAGE = 1000;
  let lastId = null;
  for (;;) {
    const q = { personId: person._id };
    if (lastId) q._id = { $gt: lastId };
    const voters = await Voter.find(q, proj).sort({ _id: 1 }).limit(PAGE).lean().session(session || null);
    if (!voters.length) break;
    const ops = [];
    for (const v of voters) {
      lastId = v._id;
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
    if (voters.length < PAGE) break;
  }

  return person;
}
