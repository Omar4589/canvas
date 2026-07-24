import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Voter } from '../models/Voter.js';
import { Household } from '../models/Household.js';

// Per-campaign voter rows: backfill Voter.campaignId from each row's household (a
// household carries exactly one campaignId), then swap the unique index from
// {organizationId, stateVoterId} to {campaignId, stateVoterId}. Safe today because
// every existing org has one campaign, so no {campaignId, stateVoterId} duplicates
// can exist — verified below anyway, loudly, before any index is touched.
//
// Run IMMEDIATELY after deploying the per-campaign code: applyImport guards on
// un-migrated rows and refuses to import until this has run. Follow with
// `npm run migrate:build-indexes -- --apply` (prod autoIndex is OFF).
//
// Usage (Heroku dashboard → More → Run console, from the repo root):
//   npm run migrate:voter-campaigns              # dry run — reports, writes nothing
//   npm run migrate:voter-campaigns -- --apply
const APPLY = process.argv.includes('--apply');
const BATCH = 5000;

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log(`mode: ${APPLY ? 'APPLY (writes WILL happen)' : 'DRY RUN (no writes)'}`);

  // ── 1. Backfill campaignId from householdId → Household.campaignId ────────────
  const missingTotal = await Voter.countDocuments({ campaignId: { $exists: false } });
  console.log(`\nVoters missing campaignId: ${missingTotal}`);

  let backfilled = 0;
  const orphans = [];
  if (APPLY && missingTotal) {
    let lastId = null;
    for (;;) {
      const q = { campaignId: { $exists: false } };
      if (lastId) q._id = { $gt: lastId };
      const rows = await Voter.find(q, { householdId: 1 }).sort({ _id: 1 }).limit(BATCH).lean();
      if (!rows.length) break;
      lastId = rows[rows.length - 1]._id;

      const hhIds = [...new Set(rows.map((v) => String(v.householdId)).filter(Boolean))];
      const hhs = await Household.find(
        { _id: { $in: hhIds.map((id) => new mongoose.Types.ObjectId(id)) } },
        { campaignId: 1 }
      ).lean();
      const campByHh = new Map(hhs.map((h) => [String(h._id), h.campaignId]));

      const ops = [];
      for (const v of rows) {
        const campaignId = campByHh.get(String(v.householdId));
        if (!campaignId) {
          orphans.push(String(v._id)); // pre-existing breakage: a voter pointing at no household
          continue;
        }
        ops.push({ updateOne: { filter: { _id: v._id }, update: { $set: { campaignId } } } });
      }
      if (ops.length) {
        const r = await Voter.bulkWrite(ops, { ordered: false });
        backfilled += r.modifiedCount || 0;
      }
      process.stdout.write(`  backfilled ${backfilled}/${missingTotal}\r`);
    }
    console.log(`\n  backfilled ${backfilled} row(s).`);
    if (orphans.length) {
      // Left un-migrated on purpose (their state predates this migration and is already
      // broken); applyImport's guard will keep flagging them until they're resolved.
      console.log(`  ⚠️  ${orphans.length} orphan voter(s) point at a missing household — NOT backfilled:`);
      for (const id of orphans.slice(0, 20)) console.log(`     ${id}`);
      if (orphans.length > 20) console.log(`     … and ${orphans.length - 20} more`);
    }
  } else if (missingTotal) {
    // Dry run: sample how the backfill would resolve, and surface orphans early.
    const sample = await Voter.find({ campaignId: { $exists: false } }, { householdId: 1 }).limit(BATCH).lean();
    const hhs = await Household.find(
      { _id: { $in: sample.map((v) => v.householdId).filter(Boolean) } },
      { campaignId: 1 }
    ).lean();
    const resolvable = new Set(hhs.map((h) => String(h._id)));
    const unresolvable = sample.filter((v) => !v.householdId || !resolvable.has(String(v.householdId))).length;
    console.log(`  (dry run) of the first ${sample.length}: ${sample.length - unresolvable} resolvable, ${unresolvable} orphaned.`);
  }

  // ── 2. Verify: nothing left un-migrated, and no {campaignId, stateVoterId} dupes ──
  const stillMissing = await Voter.countDocuments({ campaignId: { $exists: false } });
  const dupes = await Voter.aggregate([
    { $match: { campaignId: { $exists: true } } },
    { $group: { _id: { campaignId: '$campaignId', stateVoterId: '$stateVoterId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 5 },
  ]).allowDiskUse(true);
  console.log(`\nStill missing campaignId: ${stillMissing}`);
  console.log(`Duplicate {campaignId, stateVoterId} pairs: ${dupes.length ? 'YES — see below' : 'none'}`);
  for (const d of dupes) console.log('  dupe:', JSON.stringify(d._id), `×${d.n}`);

  // ── 3. Index swap ─────────────────────────────────────────────────────────────
  // An empty deployment (voters collection not created yet) has no indexes to swap;
  // indexes() throws NamespaceNotFound there rather than returning [] — tolerate it so
  // the dry run reports cleanly and --apply just builds the declared set.
  const indexes = await Voter.collection.indexes().catch((e) => {
    if (e?.codeName === 'NamespaceNotFound') return [];
    throw e;
  });
  const oldUnique = indexes.find(
    (ix) =>
      ix.unique &&
      ix.key &&
      Object.keys(ix.key).length === 2 &&
      ix.key.organizationId === 1 &&
      ix.key.stateVoterId === 1
  );
  const hasNewUnique = indexes.some(
    (ix) => ix.unique && ix.key?.campaignId === 1 && ix.key?.stateVoterId === 1
  );
  console.log(`\nOld unique {organizationId, stateVoterId}: ${oldUnique?.name || '(none)'}`);
  console.log(`New unique {campaignId, stateVoterId}: ${hasNewUnique ? 'present' : '(missing)'}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to backfill, drop the old unique index, and sync the new ones.');
    await mongoose.disconnect();
    return;
  }

  if (stillMissing || dupes.length) {
    console.error('\n❌ ABORTING the index swap: un-migrated rows or duplicate pairs remain (see above).');
    console.error('   The old unique index stays in place until the data is clean.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (oldUnique) {
    await Voter.collection.dropIndex(oldUnique.name);
    console.log(`Dropped ${oldUnique.name}`);
  }
  await Voter.syncIndexes();
  console.log('Synced indexes (built unique {campaignId, stateVoterId} + non-unique {organizationId, stateVoterId}).');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
