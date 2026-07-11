import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { GeocodeCache } from '../models/GeocodeCache.js';

// One-time storage reclaim. The GeocodeCache `raw` provider blob is no longer stored (it was
// written but never read — every read projects it out, and the useful signal is already in the
// accuracyType/accuracy/confidence fields). This $unsets it from EXISTING docs, shrinking each
// entry ~5-6× and dropping the collection's logical Data Size immediately — the biggest single
// free-tier storage win. Safe + idempotent: it only touches docs that still carry `raw`.
//
//   node src/migrations/stripGeocodeRaw.js            # dry run — count docs still carrying `raw`
//   node src/migrations/stripGeocodeRaw.js --apply    # $unset raw on all of them
//
// Uses the raw driver collection (not the Mongoose model) because `raw` is no longer in the schema,
// so `strictQuery` would otherwise strip it from the filter.
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const coll = GeocodeCache.collection;

  const withRaw = await coll.countDocuments({ raw: { $exists: true } });
  console.log(`GeocodeCache: ${withRaw} doc(s) still carry a \`raw\` blob. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (!withRaw) {
    console.log('Nothing to strip.');
  } else if (!APPLY) {
    console.log('Re-run with --apply to strip them and reclaim the storage.');
  } else {
    const res = await coll.updateMany({ raw: { $exists: true } }, { $unset: { raw: '' } });
    console.log(`Stripped \`raw\` from ${res.modifiedCount} doc(s).`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
