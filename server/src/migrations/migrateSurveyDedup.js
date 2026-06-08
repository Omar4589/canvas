import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { SurveyResponse } from '../models/SurveyResponse.js';

// Prepare SurveyResponse for the UNIQUE (voterId, passId) index that makes "one survey per voter
// per pass" a database guarantee (so a double-submit race can never persist two rows). A unique
// index CANNOT build while duplicates exist, so this runs in order:
//   1. dedupe — for every (voterId, passId) with >1 response, keep the newest submittedAt, delete
//      the rest (same rule as utils/reconcileCounts.js).
//   2. drop the old non-unique voterId_1_passId_1 index (if present) and build the unique one.
// Idempotent — safe to re-run. Run with --apply BEFORE/WITH the deploy that ships the unique index.
//
// Usage: node src/migrations/migrateSurveyDedup.js [--apply]
const APPLY = process.argv.includes('--apply');

async function dedupe() {
  const dupes = await SurveyResponse.aggregate([
    {
      $group: {
        _id: { voterId: '$voterId', passId: '$passId' },
        count: { $sum: 1 },
        ids: { $push: { _id: '$_id', submittedAt: '$submittedAt' } },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const dropIds = [];
  for (const d of dupes) {
    const sorted = d.ids.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    for (const s of sorted.slice(1)) dropIds.push(s._id); // keep [0] (newest), drop the rest
  }

  console.log(
    `dedupe: ${dupes.length} (voter, pass) groups with duplicates · ${dropIds.length} stale rows to delete`
  );
  if (APPLY && dropIds.length) {
    const r = await SurveyResponse.deleteMany({ _id: { $in: dropIds } });
    console.log(`  deleted ${r.deletedCount} duplicate SurveyResponse rows.`);
  }
}

async function buildUniqueIndex() {
  const coll = SurveyResponse.collection;
  const indexes = await coll.indexes();
  const existing = indexes.find((i) => i.name === 'voterId_1_passId_1');

  if (existing && !existing.unique) {
    console.log('index: dropping old non-unique voterId_1_passId_1…');
    if (APPLY) await coll.dropIndex('voterId_1_passId_1');
  }
  console.log('index: building unique { voterId: 1, passId: 1 }…');
  if (APPLY) {
    await coll.createIndex({ voterId: 1, passId: 1 }, { unique: true });
    console.log('  unique index in place.');
  }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);
  await connectDb(process.env.MONGODB_URI);
  await dedupe();
  await buildUniqueIndex();
  await mongoose.disconnect();
  console.log(APPLY ? '\nDone.' : '\nDry run — re-run with --apply to clean up and build the index.');
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
