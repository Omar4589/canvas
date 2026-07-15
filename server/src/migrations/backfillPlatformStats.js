import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { recomputeLive, getPlatformStats } from '../services/platform/platformStats.js';

// Seed the platform lifetime marketing counters from current data.
//
// This computes the LIVE bucket (contribution of organizations that still exist) from actual rows,
// excluding internal/demo orgs, and SETs it. It is idempotent AND safe to re-run at any time: it only
// ever SETs `live` from the current rows and never touches the `deleted` bucket, so running it twice
// yields the same result, and running it after some orgs have been deleted correctly recomputes `live`
// while the captured `deleted` contributions stay intact (total = live + deleted is preserved). That
// also makes it the drift-corrector: if a live increment was ever missed, this makes the numbers exact.
//
//   node src/migrations/backfillPlatformStats.js            # dry run — show what LIVE would be set to
//   node src/migrations/backfillPlatformStats.js --apply    # set it
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const before = await getPlatformStats();
  console.log('Current platform stats:');
  console.log('  live   :', before.live);
  console.log('  deleted:', before.deleted, '(never touched by this backfill)');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (!APPLY) {
    // Show what live WOULD become without persisting. Recompute reads counts; to avoid writing on a dry
    // run we just report that a re-sync will occur.
    console.log('\nDry run — re-run with --apply to recompute the LIVE bucket from current rows.');
    await mongoose.disconnect();
    return;
  }

  const live = await recomputeLive({ stampBackfill: true });
  const after = await getPlatformStats();
  console.log('\nRecomputed LIVE bucket from current non-internal rows:');
  console.log('  live :', live);
  console.log('  TOTAL:', after.total, '(live + deleted)');
  console.log('Backfill complete. Safe to re-run — it is idempotent.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
