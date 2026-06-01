import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Turf } from '../models/Turf.js';

// One-off cleanup for environments first deployed with the OLD Turf schema, which
// built 2dsphere indexes on boundary/centroid. Those fields are display-only and
// never geo-queried, and Mongo's S2 index rejects the self-touching rings concave
// hulls legitimately produce ("Can't extract geo keys … Loop is not valid:
// Duplicate vertices"), failing turf generation at save. The schema no longer
// declares them, but autoIndex only *creates* — it won't drop an existing index —
// so this removes the stale ones from the DB. Fresh deploys never create them and
// won't need this. Idempotent: safe to re-run.
//
// Usage: node src/migrations/migrateTurfIndexes.js [--apply]
const APPLY = process.argv.includes('--apply');
const STALE = ['boundary_2dsphere', 'centroid_2dsphere'];

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const indexes = await Turf.collection.indexes();
  const present = indexes.filter((ix) => STALE.includes(ix.name)).map((ix) => ix.name);

  console.log('Stale 2dsphere indexes present:', present.length ? present.join(', ') : '(none)');

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to drop them.');
    await mongoose.disconnect();
    return;
  }

  for (const name of present) {
    await Turf.collection.dropIndex(name);
    console.log(`Dropped ${name}`);
  }
  await Turf.syncIndexes();
  console.log('Synced Turf indexes to the current schema.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
