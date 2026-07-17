import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { followMerged } from './resolvePerson.js';

// The 10 shared identity fields (fullName is one of them). This allowlist is the ONLY thing
// propagation ever writes — NEVER a match key (uid/uidSource/stateVoterId/
// registeredState), personId, surveyStatus, householdId, or a district field.
// Exported: it is also the set of hand-edit-shieldable fields the import pipeline consults
// (applyImport's strip, computeImportDiff's conflict scan).
export const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'fullName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

// Value equality for identity fields, everywhere a hand edit is diffed against another source
// (the admin PATCH's arm-on-change, the import preview's conflict scan, applyImport's kept/
// overwritten counts). Two normalizations matter: Dates compare by time (dateOfBirth is a Date
// on both the CSV row and the Voter doc — `!==` on Dates always differs, so without this every
// armed DOB false-positives), and undefined/null/'' collapse to null (the PATCH form submits ''
// for cleared fields).
export const identityEq = (a, b) => {
  const n = (v) => (v instanceof Date ? v.getTime() : v === undefined || v === null || v === '' ? null : v);
  const na = n(a);
  const nb = n(b);
  // A Date on one side and an ISO string on the other (lean docs vs parsed rows) still compare.
  if (na instanceof Object || nb instanceof Object) return String(na) === String(nb);
  return na === nb;
};

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

// Projection + per-voter op for the identity fan-out — shared by propagate's per-person
// path and the batched import path so both write Voter caches identically: honor
// locallyEditedFields and snapshot identityBackup once before the first overwrite.
export const VOTER_FANOUT_PROJ = (() => {
  // personId is needed by the batched import path to map each voter back to its Person's
  // fields (the per-person propagate path queries by a single personId and ignores it).
  const p = { _id: 1, personId: 1, locallyEditedFields: 1, identityBackup: 1 };
  for (const f of IDENTITY_FIELDS) p[f] = 1;
  return p;
})();
export function buildVoterFanoutOp(voter, fields) {
  const locked = new Set(voter.locallyEditedFields || []);
  const vset = {};
  for (const [f, val] of Object.entries(fields)) if (!locked.has(f)) vset[f] = val;
  if (!Object.keys(vset).length) return null;
  if (voter.identityBackup == null) {
    const snap = {};
    for (const f of IDENTITY_FIELDS) snap[f] = voter[f] ?? null;
    vset.identityBackup = snap;
  }
  return { updateOne: { filter: { _id: voter._id }, update: { $set: vset } } };
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

  // 2. Fan out to the Person's Voter caches WITHIN ITS OWN ORG, paginated by _id (lean) so a
  //    Person with thousands of voter rows never holds the whole set in memory.
  //
  //    `organizationId` in this query is the whole point of the org-scoping change. It used to be
  //    absent: `{ personId }` alone selected every Voter row in EVERY organization linked to this
  //    Person, so one customer's admin correcting a phone number rewrote that field in another
  //    customer's database. The Person is now org-scoped (models/Person.js), so in principle this
  //    filter is redundant — belt and braces on purpose. If a bug ever re-links a Voter across an
  //    org boundary, this line is what stops it becoming a cross-customer write.
  let lastId = null;
  for (;;) {
    const q = { personId: person._id, organizationId: person.organizationId };
    if (lastId) q._id = { $gt: lastId };
    const voters = await Voter.find(q, VOTER_FANOUT_PROJ).sort({ _id: 1 }).limit(1000).lean().session(session || null);
    if (!voters.length) break;
    const ops = [];
    for (const v of voters) { lastId = v._id; const op = buildVoterFanoutOp(v, fields); if (op) ops.push(op); }
    if (ops.length) await Voter.bulkWrite(ops, { ordered: false, session: session || undefined });
    if (voters.length < 1000) break;
  }

  return person;
}
