import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { resolvePersonsBatch } from './resolvePerson.js';
import { propagateIdentity } from './propagateIdentity.js';

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

  // 3. Per Person: ownership → propagate (owner) or propose (non-owner).
  let proposals = 0;
  for (const { personId, repRow } of byPerson.values()) {
    const person = await Person.findById(personId).lean().session(session || null); // read-only here
    if (!person) continue;

    const orgs = await Voter.distinct('organizationId', { personId });
    const otherOrgs = orgs.filter((o) => String(o) !== String(orgId));
    const ownerStr = person.identityOwnerOrgId ? String(person.identityOwnerOrgId) : null;

    let isOwner;
    if (ownerStr === String(orgId)) {
      isOwner = true;
    } else if (ownerStr === null) {
      if (otherOrgs.length === 0) {
        await Person.updateOne(
          { _id: personId, identityOwnerOrgId: null },
          { $set: { identityOwnerOrgId: orgId, ownerProvisional: true } },
          { session: session || undefined }
        );
        isOwner = true;
      } else {
        isOwner = false; // unowned + already multi-org → super-admin arbitrates
      }
    } else {
      // Owned by another org. A NEW org linking to a PROVISIONAL owner collapses
      // ownership to null (the prior sole-owner no longer auto-wins).
      const alreadyLinked = orgs.some((o) => String(o) === String(orgId));
      if (person.ownerProvisional && !alreadyLinked) {
        await Person.updateOne(
          { _id: personId, ownerProvisional: true },
          { $set: { identityOwnerOrgId: null, ownerProvisional: false } },
          { session: session || undefined }
        );
      }
      isOwner = false;
    }

    if (isOwner) {
      await propagateIdentity(personId, identityOf(repRow.voter), { orgId, source: 'import', session });
    } else {
      const fields = {};
      for (const f of IDENTITY_FIELDS) {
        const want = repRow.voter[f] ?? null;
        if (want !== (person[f] ?? null)) fields[f] = want;
      }
      if (Object.keys(fields).length) {
        // Upsert (not create) so a BullMQ retry of the same import doesn't duplicate it.
        await PersonEditProposal.updateOne(
          { personId, orgId, source: 'import', status: 'pending' },
          { $set: { fields, canonicalSnapshot: Object.fromEntries(IDENTITY_FIELDS.map((f) => [f, person[f] ?? null])), baseIdentityVersion: person.identityVersion } },
          { upsert: true, session: session || undefined }
        );
        proposals += 1;
      }
      // Non-owner: the voter keeps its own import values as this org's cached view
      // (personId already stamped); canonical is untouched until the proposal is approved.
    }
  }

  return { linked: validRows.length, personsTouched: byPerson.size, proposals };
}
