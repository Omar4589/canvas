// Reads a RESTORED backup and reports two things:
//
//   1. Is the archive real? Every collection we expect must be PRESENT. A missing collection is a
//      hard failure, reported separately from an empty one — because the bug that made this script
//      necessary was exactly that confusion: it counted `persons` (the real collection is `people`,
//      Mongoose pluralizes Person irregularly), got 0 back with no error, and reported a blast radius
//      of zero when the true answer was every Person in the database.
//
//   2. What is `migrate:persons-org-scope --apply` about to DO? That migration is a one-way door —
//      it drops indexes, deletes Persons, and deletes proposals, with no down-migration. This
//      recomputes its three numbers from the backup, using the same aggregation the migration itself
//      uses (migratePersonsOrgScope.js:59-67), so you can see the outcome BEFORE you open the door.
//
//      That also gives you a cross-check worth more than either number alone: run this, then run the
//      migration's own dry run on prod. If they disagree, something WROTE to the database in between
//      — which during a maintenance window means the worker dyno is still draining its queue.
//
// Run via ./verify-backup.sh, which restores the archive into a throwaway mongod and points us at it.
import { createRequire } from 'node:module';

// Resolve the driver the way the server itself does, rather than guessing at the package's entry
// file. This is the app's own mongodb, not a global one — and deliberately not mongosh, which on
// this machine is a broken Homebrew build.
const require = createRequire(new URL('../server/', import.meta.url));
const { MongoClient } = require('mongodb');

const PORT = process.env.MONGO_PORT || 27950;

// Every one of these must exist in the archive. Names are the REAL Mongo collection names — note
// `people`, not `persons`.
const EXPECTED = [
  'organizations',
  'users',
  'memberships',
  'campaigns',
  'people',
  'voters',
  'households',
  'canvassactivities',
  'surveyresponses',
];

const n = (x) => x.toLocaleString('en-US');
const pad = (s, w) => String(s).padEnd(w);

const client = new MongoClient(`mongodb://127.0.0.1:${PORT}`);
await client.connect();

const admin = client.db().admin();
const dbNames = (await admin.listDatabases()).databases
  .map((d) => d.name)
  .filter((name) => !['admin', 'config', 'local'].includes(name));

if (!dbNames.length) {
  console.log('  ✗ NO APPLICATION DATABASE IN THE ARCHIVE. DO NOT DEPLOY.');
  await client.close();
  process.exit(1);
}

let failed = false;

for (const dbName of dbNames) {
  const db = client.db(dbName);
  const present = new Set((await db.listCollections().toArray()).map((c) => c.name));

  console.log(`── ${dbName} ─────────────────────────────────────────────────────────`);
  console.log('');

  const counts = {};
  for (const name of EXPECTED) {
    if (!present.has(name)) {
      console.log(`    ${pad(name, 22)} ✗ MISSING FROM THE ARCHIVE`);
      failed = true;
      continue;
    }
    counts[name] = await db.collection(name).countDocuments({});
    console.log(`    ${pad(name, 22)} ${n(counts[name])}`);
  }
  console.log('');

  if (failed) continue;

  // An archive can restore cleanly and still be worthless. The identity data is the point.
  if (!counts.people || !counts.voters) {
    console.log('  ✗ THE ARCHIVE HAS NO IDENTITY DATA (people or voters is empty). DO NOT DEPLOY.');
    failed = true;
    continue;
  }

  // ── What the irreversible migration will do ────────────────────────────────────────────────────
  // Mirrors migratePersonsOrgScope.js:59-67 exactly: group Voter rows by the Person they point at,
  // and see how many distinct orgs claim each one.
  const linkage = await db
    .collection('voters')
    .aggregate([
      { $match: { personId: { $ne: null } } },
      { $group: { _id: '$personId', orgs: { $addToSet: '$organizationId' } } },
    ])
    .toArray();

  const single = linkage.filter((l) => l.orgs.length === 1).length;
  const shared = linkage.filter((l) => l.orgs.length >= 2).length;
  const orphans = counts.people - linkage.length;
  const votersUnlinked = await db.collection('voters').countDocuments({ personId: null });
  const pendingProposals = present.has('personeditproposals')
    ? await db.collection('personeditproposals').countDocuments({ status: 'pending' })
    : 0;
  const alreadyScoped = await db
    .collection('people')
    .countDocuments({ organizationId: { $ne: null, $exists: true } });
  const unscoped = await db.collection('people').countDocuments({ organizationId: { $exists: false } });

  console.log('  ┌─ WHAT `migrate:persons-org-scope --apply` WILL DO ─────────────────────');
  console.log('  │');
  console.log(`  │  STAMP  organizationId on          ${pad(n(single), 10)} Person(s)   (linked from exactly 1 org)`);
  console.log(`  │  SPLIT  into one copy per org      ${pad(n(shared), 10)} Person(s)   (linked from 2+ orgs)`);
  console.log(`  │  DELETE orphans                    ${pad(n(orphans), 10)} Person(s)   (no voter points at them)`);
  console.log(`  │  DELETE pending edit proposals     ${pad(n(pendingProposals), 10)}`);
  console.log('  │');
  console.log(`  │  (Persons already carrying an organizationId: ${n(alreadyScoped)} · without: ${n(unscoped)})`);
  console.log(`  │  (Voters with no personId at all: ${n(votersUnlinked)})`);
  console.log('  └────────────────────────────────────────────────────────────────────────');
  console.log('');

  // SPLIT is the number the cross-org audit actually predicts. It said zero. If it is not zero here,
  // the audit and the backup disagree about the shape of the data — and the next command is a
  // one-way door.
  if (shared > 0) {
    console.log(`  🛑 ${n(shared)} Person(s) are linked from MORE THAN ONE ORG.`);
    console.log('     The cross-org audit reported zero. The audit and this backup disagree.');
    console.log('     DO NOT RUN THE MIGRATION. Stop and investigate.');
    failed = true;
  }

  // Orphans are NOT a red flag. deleteCampaign.js removes a campaign's Voters but does not remove
  // their Persons (Person is absent from its CAMPAIGN_SCOPED cascade), so every deleted campaign
  // leaves orphans behind. They are dead weight nothing references. Report the number, don't halt on
  // it — but do make the operator look at it, because it is a deletion and it cannot be undone.
  if (orphans > 0) {
    const pct = ((orphans / counts.people) * 100).toFixed(1);
    console.log(`  ⚠️  ${n(orphans)} orphan Person(s) will be DELETED (${pct}% of all Persons).`);
    console.log('     This is normal — deleting a campaign removes its Voters but not their Persons,');
    console.log('     so orphans accumulate. Nothing references them. Sanity-check the number is');
    console.log('     plausible for the campaigns you have deleted, then proceed.');
    console.log('');
  }
}

await client.close();

console.log('════════════════════════════════════════════════════════════════════');
if (failed) {
  console.log('  ✗ NO-GO. Read the failure above. DO NOT DEPLOY.');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('');
  process.exit(1);
}
console.log('  ✓ THE ARCHIVE RESTORED CLEANLY AND IS COMPLETE.');
console.log('');
console.log('  Cross-check before the one-way door: the migration prints these same three');
console.log('  numbers in its own dry run. If prod disagrees with the backup, something WROTE');
console.log('  to the database in between — stop, because that is what a still-running worker');
console.log('  dyno looks like.');
console.log('════════════════════════════════════════════════════════════════════');
console.log('');
