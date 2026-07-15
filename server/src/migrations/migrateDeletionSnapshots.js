import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { DeletedUserRecord } from '../models/DeletedUserRecord.js';

// Strip email + phone off EXISTING deletion snapshots (DeletedUserRecord), making the corpus
// name-only to match the write path.
//
// The snapshot exists so an org can attribute past field work — above all the GPS/quality
// flags — to a real person for the 180-day window. Attribution needs a NAME. The published
// deletion promise is that email, phone and password are removed immediately; snapshots
// written before this change kept email+phone for the window (and the report hydrator used
// to re-display the email), which quietly contradicted that sentence. The write path, the
// purge and the hydrator are already name-only; this sweeps the rows that predate them.
//
//   node src/migrations/migrateDeletionSnapshots.js            # dry run — count rows carrying either field
//   node src/migrations/migrateDeletionSnapshots.js --apply    # $unset email/phone on them
//
// Safe + idempotent. Names are untouched; retentionUntil/purge behavior is unchanged.
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const coll = DeletedUserRecord.collection;

  const filter = { $or: [{ email: { $exists: true } }, { phone: { $exists: true } }] };
  const carrying = await coll.countDocuments(filter);
  console.log(
    `DeletedUserRecord: ${carrying} snapshot(s) still carry email/phone. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );

  if (!carrying) {
    console.log('Nothing to strip — every snapshot is already name-only.');
  } else if (!APPLY) {
    console.log('Re-run with --apply to strip them.');
  } else {
    const res = await coll.updateMany(filter, { $unset: { email: 1, phone: 1 } });
    console.log(`Stripped email/phone from ${res.modifiedCount} snapshot(s). The corpus is name-only.`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
