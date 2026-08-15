import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { FbTimeConnection } from '../models/FbTimeConnection.js';
import { FbTimeShift } from '../models/FbTimeShift.js';
import { runFbtimeSync, DEEP_WINDOW_DAYS } from '../services/fbtime/sync.js';

// Cutover for the FbTime cache redesign: day-total rows (FbTimeDailyHours) →
// shift rows (FbTimeShift), bucketed at read time so measured hours reach a
// campaign in ANY timezone. The old cache is not migrated — it is a cache, so
// the correct move is to refill the new one from the provider and drop the
// old one, not to transform rows that the next deep sync would replace anyway.
//
//   npm run migrate:fbtime-shifts                          # dry run — counts only
//   npm run migrate:fbtime-shifts -- --apply               # deep-resync every connected org NOW
//   npm run migrate:fbtime-shifts -- --apply --drop-legacy # ...and drop the legacy collection
//
// Run AFTER deploying the shift-cache code (the deploy that removed the old
// model). Without --apply nothing is written. Until the resync runs, reports
// read "estimated" — the 15-minute recent job would heal the last week on its
// own, but --apply pulls the full deep window immediately. --drop-legacy is
// separate on purpose: keep the old collection around until the new numbers
// are confirmed, then drop it in a second run.
const APPLY = process.argv.includes('--apply');
const DROP_LEGACY = process.argv.includes('--drop-legacy');

const LEGACY_COLLECTION = 'fbtimedailyhours';

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const connections = await FbTimeConnection.find(
    { status: { $in: ['connected', 'errored'] } },
    { organizationId: 1, status: 1 }
  ).lean();
  const legacyCount = await db
    .collection(LEGACY_COLLECTION)
    .countDocuments()
    .catch(() => 0);
  const shiftCount = await FbTimeShift.countDocuments();

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${DROP_LEGACY ? ' + DROP LEGACY' : ''}`);
  console.log(`connections (connected/errored): ${connections.length}`);
  console.log(`legacy day-total rows (${LEGACY_COLLECTION}): ${legacyCount}`);
  console.log(`shift rows (fbtimeshifts): ${shiftCount}\n`);

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply to deep-resync every connected org.');
    if (DROP_LEGACY) console.log('(--drop-legacy is ignored without --apply.)');
    await mongoose.disconnect();
    return;
  }

  // The same pull the nightly deep job makes — full window, errored
  // connections re-pinged so a healed key backfills too.
  const res = await runFbtimeSync({ windowDays: DEEP_WINDOW_DAYS, recoverErrored: true });
  console.log(
    res.dormant
      ? 'Sync is dormant (CREDENTIAL_SEAL_KEY unset) — nothing pulled.'
      : `Resynced: ${res.ok}/${res.orgs} org(s) ok, ${res.errored} errored, ${res.recovered} recovered.`
  );
  console.log(`shift rows now: ${await FbTimeShift.countDocuments()}`);

  if (DROP_LEGACY) {
    const gone = await db
      .collection(LEGACY_COLLECTION)
      .drop()
      .catch((e) => (e?.codeName === 'NamespaceNotFound' ? false : Promise.reject(e)));
    console.log(gone ? `Dropped ${LEGACY_COLLECTION} (${legacyCount} rows).` : `${LEGACY_COLLECTION} was already gone.`);
  } else if (legacyCount > 0) {
    console.log(`Legacy collection kept (${legacyCount} rows). Re-run with --apply --drop-legacy once the new numbers check out.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
