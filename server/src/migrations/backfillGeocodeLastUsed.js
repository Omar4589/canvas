import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { GeocodeCache } from '../models/GeocodeCache.js';

// Activate the GeocodeCache sliding-retention TTL on the EXISTING corpus.
//
// The TTL index expires entries by `lastUsedAt`, but MongoDB's TTL only deletes docs whose field is a
// real BSON date — a missing field never expires. New writes default lastUsedAt to now, and every cache
// hit refreshes it, so going forward the cache self-bounds. But rows written before this feature have no
// lastUsedAt, so without this backfill they would linger forever — the exact "we hold every address we
// ever saw, indefinitely" problem the TTL exists to end. This stamps lastUsedAt = updatedAt (when the
// entry was last written) on those rows, so a truly abandoned old address ages out on the next TTL
// sweep, while anything still imported against gets refreshed back to now before it can.
//
//   node src/migrations/backfillGeocodeLastUsed.js            # dry run — count rows missing lastUsedAt
//   node src/migrations/backfillGeocodeLastUsed.js --apply    # stamp lastUsedAt = updatedAt on them
//
// Run AFTER migrate:build-indexes (which builds the TTL index). Safe + idempotent.
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const coll = GeocodeCache.collection;

  const missing = await coll.countDocuments({ lastUsedAt: { $exists: false } });
  console.log(`GeocodeCache: ${missing} doc(s) have no lastUsedAt. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (!missing) {
    console.log('Nothing to backfill — every entry already carries lastUsedAt.');
  } else if (!APPLY) {
    console.log('Re-run with --apply to stamp lastUsedAt = updatedAt on them (activates the TTL).');
  } else {
    // Pipeline update: copy updatedAt into lastUsedAt (fall back to now if somehow absent).
    const res = await coll.updateMany(
      { lastUsedAt: { $exists: false } },
      [{ $set: { lastUsedAt: { $ifNull: ['$updatedAt', '$$NOW'] } } }]
    );
    console.log(`Stamped lastUsedAt on ${res.modifiedCount} doc(s). The TTL now governs them.`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
