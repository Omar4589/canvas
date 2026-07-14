import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Person } from '../models/Person.js';
import { Voter } from '../models/Voter.js';
import { Organization } from '../models/Organization.js';
import { PersonEditProposal } from '../models/PersonEditProposal.js';

// Make every Person belong to exactly one organization.
//
// A Person used to be GLOBAL — one record per real human, shared by every customer org that had
// imported them. That is what let propagateIdentity write one customer's edit into another
// customer's database, and it is what made us a controller of a cross-customer identity graph
// rather than a processor of each customer's own data. See models/Person.js.
//
// This migration splits the graph:
//
//   Person P linked from orgs {A, B}  →  P_A (org A's copy)  +  P_B (org B's copy)
//                                        each org's Voter rows re-pointed to their own copy
//
// It is IDEMPOTENT and dry-run by default.
//
//   npm run migrate:persons-org-scope             # dry run — shows the plan
//   npm run migrate:persons-org-scope -- --apply
//
// AFTER --apply, you MUST rebuild indexes:
//   npm run migrate:build-indexes -- --apply
// The OLD global unique indexes (uidKeys / svidKeys with no organizationId) will REJECT the split
// copies — two orgs' Persons legitimately share a state voter ID now. This script drops them.
//
// Context: the audit that preceded this (npm run audit:cross-org-identity) found ZERO Persons
// shared across orgs and ZERO contaminated rows, so on the current production data this migration
// is expected to split nothing and simply stamp organizationId onto every Person. The split logic
// exists because the *code* allowed it, and a migration that assumes the audit is right about data
// it cannot see is not a migration, it's a hope.

const APPLY = process.argv.includes('--apply');

// The old, global unique indexes. They must go: after the split, two orgs each holding the same
// human legitimately have two Persons with the same svid, and a global unique index forbids that.
const LEGACY_INDEXES = [
  'uidKeys.uidSource_1_uidKeys.uid_1',
  'svidKeys.registeredState_1_svidKeys.stateVoterId_1',
];

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('');

  const orgs = await Organization.find({}, 'name slug').lean();
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));

  const total = await Person.countDocuments({});
  const alreadyScoped = await Person.countDocuments({ organizationId: { $ne: null, $exists: true } });
  console.log(`Persons: ${total} total · ${alreadyScoped} already carry an organizationId`);

  // Which orgs hold Voter rows pointing at each Person? That is the ground truth for who owns it.
  const linkage = await Voter.aggregate([
    { $match: { personId: { $ne: null } } },
    { $group: { _id: '$personId', orgs: { $addToSet: '$organizationId' } } },
  ]);
  const orgsByPerson = new Map(linkage.map((l) => [String(l._id), l.orgs.map(String)]));

  const shared = linkage.filter((l) => l.orgs.length >= 2);
  const single = linkage.filter((l) => l.orgs.length === 1);
  const orphans = total - linkage.length; // Persons no Voter points at

  console.log(`  linked from exactly 1 org : ${single.length}  → stamp organizationId`);
  console.log(`  linked from ≥2 orgs       : ${shared.length}  → SPLIT into one copy per org`);
  console.log(`  linked from no voter at all: ${orphans}  → delete (nothing references them)`);
  console.log('');

  if (shared.length) {
    console.log('  Shared Persons that will be split:');
    for (const s of shared.slice(0, 20)) {
      console.log(`    ${s._id} → ${s.orgs.map((o) => orgName.get(String(o)) || o).join(' + ')}`);
    }
    if (shared.length > 20) console.log(`    … and ${shared.length - 20} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run — re-run with --apply.');
    console.log('Then: npm run migrate:build-indexes -- --apply   (the old global unique indexes must go)');
    await mongoose.disconnect();
    return;
  }

  // ── 1. Drop the legacy global unique indexes FIRST. ──────────────────────────────────────────
  // If they survive, inserting org B's copy of a Person that shares org A's state voter ID throws
  // E11000 — and the split cannot proceed.
  const existing = await Person.collection.indexes();
  for (const name of LEGACY_INDEXES) {
    if (existing.some((i) => i.name === name)) {
      await Person.collection.dropIndex(name);
      console.log(`dropped legacy global index: ${name}`);
    }
  }

  // ── 2. Single-org Persons: just stamp the org. ───────────────────────────────────────────────
  let stamped = 0;
  for (const l of single) {
    const res = await Person.updateOne(
      { _id: l._id, organizationId: { $exists: false } },
      { $set: { organizationId: l.orgs[0] } }
    );
    stamped += res.modifiedCount || 0;
  }
  console.log(`stamped organizationId on ${stamped} single-org Person(s)`);

  // ── 3. Shared Persons: one copy per org, voters re-pointed. ──────────────────────────────────
  let created = 0;
  let repointed = 0;
  for (const l of shared) {
    const original = await Person.findById(l._id).lean();
    if (!original) continue;
    const orgIds = l.orgs;

    // The first org keeps the original document (its _id stays valid, so merge logs and any other
    // reference to it survive). Every other org gets a fresh copy.
    const [keepOrg, ...copyOrgs] = orgIds;
    await Person.updateOne({ _id: original._id }, { $set: { organizationId: keepOrg } });

    for (const oid of copyOrgs) {
      const { _id, __v, createdAt, updatedAt, ...rest } = original;
      const copy = await Person.create({
        ...rest,
        organizationId: oid,
        // Ownership was a cross-org concept: "which of the several orgs sharing this record may
        // edit it". With one org per Person there is nothing to arbitrate. Drop it.
        identityOwnerOrgId: undefined,
        ownerProvisional: false,
        // fieldProvenance kept: it is this org's own edit history and is genuinely useful.
      });
      const r = await Voter.updateMany(
        { personId: original._id, organizationId: oid },
        { $set: { personId: copy._id } }
      );
      created += 1;
      repointed += r.modifiedCount || 0;
    }
  }
  console.log(`split ${shared.length} shared Person(s) → created ${created} copy(ies), re-pointed ${repointed} voter row(s)`);

  // ── 4. Orphans: no Voter points at them. ─────────────────────────────────────────────────────
  const linkedIds = linkage.map((l) => l._id);
  const orphanRes = await Person.deleteMany({ _id: { $nin: linkedIds } });
  console.log(`deleted ${orphanRes.deletedCount || 0} orphan Person(s) (no voter referenced them)`);

  // ── 5. Edit proposals were a cross-org mechanism. ────────────────────────────────────────────
  // A proposal was "org B wants to change the shared record org A owns". There is no shared record
  // any more, so a pending proposal has nothing to apply to.
  const props = await PersonEditProposal.deleteMany({ status: 'pending' });
  if (props.deletedCount) {
    console.log(`removed ${props.deletedCount} pending cross-org edit proposal(s) — the mechanism no longer exists`);
  }

  const leftUnscoped = await Person.countDocuments({ organizationId: { $exists: false } });
  console.log('');
  console.log(leftUnscoped === 0
    ? '✓ every Person now belongs to exactly one organization'
    : `✗ ${leftUnscoped} Person(s) still have no organizationId — investigate before deploying`);
  console.log('');
  console.log('NEXT: npm run migrate:build-indexes -- --apply   (builds the new org-scoped unique indexes)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
