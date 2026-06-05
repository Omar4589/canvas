import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Membership } from '../models/Membership.js';

// Backfill Membership.acknowledgedAt for memberships created BEFORE the field
// existed, so existing members don't all get spammed with the new "you were
// added to this org" banner on their next login.
//
// We match only documents where the field is ABSENT ($exists: false). New
// memberships created by the updated app carry acknowledgedAt: null (the schema
// default), so the field is present and this migration won't clobber a genuinely
// unacknowledged one. Safe to re-run (idempotent). Sets acknowledgedAt to the
// membership's own createdAt.
//
// Usage: node src/migrations/migrateAckMemberships.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const pending = await Membership.countDocuments({ acknowledgedAt: { $exists: false } });
  console.log(`${pending} pre-existing memberships to backfill · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (APPLY && pending > 0) {
    const res = await Membership.updateMany(
      { acknowledgedAt: { $exists: false } },
      [{ $set: { acknowledgedAt: '$createdAt' } }]
    );
    console.log(`Backfilled ${res.modifiedCount} memberships.`);
  } else if (!APPLY) {
    console.log('Dry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
