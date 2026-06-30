import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { resolvePersonsBatch } from './resolvePerson.js';
import { propagateIdentity, buildCanonicalSet } from './propagateIdentity.js';

const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'fullName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

function identityOf(voter) {
  const out = {};
  for (const f of IDENTITY_FIELDS) out[f] = voter[f] ?? null;
  return out;
}

/**
 * Link each imported voter to its canonical Person and reconcile identity. Mutates
 * `validRows[i].voter.{personId, uidSource}` so the downstream `applyImport` upsert
 * carries them. Run AFTER geocoding (so dropped households aren't linked), BEFORE
 * applyImport.
 *
 * Ownership state machine:
 * - sole-org (Person linked to no other org) → claim provisional ownership → propagate
 *   the import identity to canonical (+ fan to caches).
 * - already this org's → owner → propagate.
 * - a 2nd org linking to a PROVISIONAL-owner Person → collapse ownership to null
 *   (closes the first-importer land-grab); this import is then a non-owner.
 * - non-owner → raise a PersonEditProposal for diverging fields (never clobbers
 *   canonical); the voter keeps its own import values as this org's cached view.
 *
 * @returns { linked, personsTouched, proposals }
 */
export async function reconcileIdentityFromImport(validRows, { orgId, uidSource = null, session } = {}) {
  if (!validRows.length) return { linked: 0, personsTouched: 0, proposals: 0 };

  // 1. Resolve a Person for every row. registeredState is derived from the household
  //    when the voter row didn't carry it (mirrors the backfill migration).
  const batchRows = validRows.map((row, i) => ({
    rowKey: i,
    keys: {
      uidSource: uidSource && row.voter.uid ? uidSource : null,
      uid: row.voter.uid,
      registeredState: row.voter.registeredState || row.household?.state || null,
      stateVoterId: row.voter.stateVoterId,
    },
    identity: row.voter,
  }));
  const personByRow = await resolvePersonsBatch(batchRows, { source: 'import', session });

  // 2. Stamp personId + uidSource on each voter; dedupe to one representative row/Person.
  const byPerson = new Map(); // personIdStr -> { personId, repRow }
  validRows.forEach((row, i) => {
    const pid = personByRow.get(i);
    row.voter.personId = pid;
    if (uidSource && row.voter.uid) row.voter.uidSource = uidSource;
    const key = String(pid);
    if (!byPerson.has(key)) byPerson.set(key, { personId: pid, repRow: row });
  });

  // 3. Per Person: ownership → propagate (owner) or propose (non-owner). Processed in
  //    CHUNKS so the preloaded maps + accumulated bulk ops stay bounded regardless of file
  //    size. Per chunk: preload the reads (decision logic below is byte-identical; only the
  //    data source changes), then flush the ownership/canonical Person writes + the proposal
  //    upserts as bulkWrites — each op keeps its exact conditional filter/upsert, so the
  //    concurrency guards and BullMQ-retry idempotency are preserved.
  const entries = [...byPerson.values()];
  let proposals = 0;
  for (let c = 0; c < entries.length; c += 2000) {
    const chunk = entries.slice(c, c + 2000);
    const ids = chunk.map((p) => p.personId);
    const personById = new Map();
    const orgsByPerson = new Map();
    const docs = await Person.find({ _id: { $in: ids } }).lean().session(session || null);
    for (const d of docs) personById.set(String(d._id), d);
    const aggRows = await Voter.aggregate([
      { $match: { personId: { $in: ids } } },
      { $group: { _id: '$personId', orgs: { $addToSet: '$organizationId' } } },
    ]).session(session || null);
    for (const r of aggRows) orgsByPerson.set(String(r._id), r.orgs);

    const personOps = [];
    const proposalOps = [];
    for (const { personId, repRow } of chunk) {
      const person = personById.get(String(personId));
      if (!person) continue;

      const orgs = orgsByPerson.get(String(personId)) || [];
      const otherOrgs = orgs.filter((o) => String(o) !== String(orgId));
      const ownerStr = person.identityOwnerOrgId ? String(person.identityOwnerOrgId) : null;

      let isOwner;
      if (ownerStr === String(orgId)) {
        isOwner = true;
      } else if (ownerStr === null) {
        if (otherOrgs.length === 0) {
          personOps.push({
            updateOne: {
              filter: { _id: personId, identityOwnerOrgId: null },
              update: { $set: { identityOwnerOrgId: orgId, ownerProvisional: true } },
            },
          });
          isOwner = true;
        } else {
          isOwner = false; // unowned + already multi-org → super-admin arbitrates
        }
      } else {
        // Owned by another org. A NEW org linking to a PROVISIONAL owner collapses
        // ownership to null (the prior sole-owner no longer auto-wins).
        const alreadyLinked = orgs.some((o) => String(o) === String(orgId));
        if (person.ownerProvisional && !alreadyLinked) {
          personOps.push({
            updateOne: {
              filter: { _id: personId, ownerProvisional: true },
              update: { $set: { identityOwnerOrgId: null, ownerProvisional: false } },
            },
          });
        }
        isOwner = false;
      }

      if (isOwner) {
        // A person with NO existing voters needs no fan-out, so batch its canonical identity
        // write (the same $set + dotted provenance + version bump propagate would do) instead
        // of a per-person round-trip — a just-created person has no concurrent writer, so the
        // optimistic version filter always matches. Persons WITH existing voters still go
        // through propagate for the per-voter fan-out + retry.
        if (orgs.length === 0) {
          const built = buildCanonicalSet(person, identityOf(repRow.voter), { orgId, source: 'import' });
          if (built) {
            personOps.push({
              updateOne: {
                filter: { _id: personId, identityVersion: person.identityVersion },
                update: { $set: built.set, $inc: { identityVersion: 1 } },
              },
            });
          }
        } else {
          await propagateIdentity(personId, identityOf(repRow.voter), { orgId, source: 'import', session });
        }
      } else {
        const fields = {};
        for (const f of IDENTITY_FIELDS) {
          const want = repRow.voter[f] ?? null;
          if (want !== (person[f] ?? null)) fields[f] = want;
        }
        if (Object.keys(fields).length) {
          // Upsert (not create) so a BullMQ retry of the same import doesn't duplicate it.
          proposalOps.push({
            updateOne: {
              filter: { personId, orgId, source: 'import', status: 'pending' },
              update: { $set: { fields, canonicalSnapshot: Object.fromEntries(IDENTITY_FIELDS.map((f) => [f, person[f] ?? null])), baseIdentityVersion: person.identityVersion } },
              upsert: true,
            },
          });
          proposals += 1;
        }
        // Non-owner: the voter keeps its own import values as this org's cached view
        // (personId already stamped); canonical is untouched until the proposal is approved.
      }
    }
    if (personOps.length) await Person.bulkWrite(personOps, { ordered: false, session: session || undefined });
    if (proposalOps.length) await PersonEditProposal.bulkWrite(proposalOps, { ordered: false, session: session || undefined });
  }

  return { linked: validRows.length, personsTouched: byPerson.size, proposals };
}
