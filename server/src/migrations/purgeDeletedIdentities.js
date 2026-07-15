import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { DeletedUserRecord } from '../models/DeletedUserRecord.js';
import { purgeDeletedIdentities, retentionHealth } from '../services/retention/purgeDeletedIdentities.js';

// MANUAL ESCAPE HATCH for the 180-day identity purge.
//
// This used to be the ONLY way the purge ran — a dry-run-by-default CLI that nothing in the codebase
// called, wired up solely by a Heroku Scheduler entry typed into a web dashboard. No test covered it.
// If that add-on were ever removed or lost in a host migration, the purge would stop and NOTHING
// would fail: we would keep holding deleted users' names while publicly promising a 180-day limit,
// and we would not find out until someone asked.
//
// The purge is now a repeatable job on the worker dyno (services/retention/scheduler.js), recorded in
// RetentionRun, and surfaced by a health check that goes red when it stops. This script remains for
// running it by hand, and for checking the health from a console.
//
//   npm run purge:deleted-identities            # dry run — what WOULD be purged, + health
//   npm run purge:deleted-identities -- --apply # purge now (the worker does this daily anyway)
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const health = await retentionHealth();
  console.log('');
  console.log(`retention: ${health.healthy ? 'HEALTHY' : '*** NOT HEALTHY ***'}`);
  console.log(`  ${health.message}`);
  if (health.lastSuccessAt) {
    console.log(`  last success: ${new Date(health.lastSuccessAt).toISOString()} (purged ${health.lastSuccessPurged})`);
  }
  if (health.lastError) console.log(`  last error: ${health.lastError}`);
  console.log('');

  const due = await DeletedUserRecord.find({ retentionUntil: { $lte: new Date() }, purgedAt: null }).lean();
  console.log(`${due.length} deleted identit${due.length === 1 ? 'y' : 'ies'} past the retention window · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const r of due) {
    const age = Math.floor((Date.now() - new Date(r.deletedAt)) / 86_400_000);
    // Snapshots are name-only (email/phone were never written or have been stripped).
    console.log(`  · ${r.firstName} ${r.lastName} — deleted ${age}d ago`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run — re-run with --apply. (The worker dyno does this on a schedule regardless.)');
    await mongoose.disconnect();
    return;
  }

  const res = await purgeDeletedIdentities({ apply: true });
  console.log('');
  console.log(`Purged ${res.purged} identit${res.purged === 1 ? 'y' : 'ies'}. Their past field work no longer directly identifies them.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
