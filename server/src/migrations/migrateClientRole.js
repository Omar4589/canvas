import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Membership } from '../models/Membership.js';

// Prepare existing memberships for the new 'client' role by backfilling the
// clientCampaignIds field on docs created BEFORE it existed. The role enum change
// ('admin'|'canvasser' -> +'client') is additive and needs no data change — existing
// rows keep their role. This just makes the array field present (default []) so queries
// and $addToSet/$pull on clientCampaignIds behave uniformly.
//
// Matches only docs where the field is ABSENT ($exists: false); new memberships carry
// clientCampaignIds: [] from the schema default. Safe to re-run (idempotent).
//
// Usage: node src/migrations/migrateClientRole.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const pending = await Membership.countDocuments({ clientCampaignIds: { $exists: false } });
  console.log(
    `${pending} memberships missing clientCampaignIds · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );

  if (APPLY && pending > 0) {
    const res = await Membership.updateMany(
      { clientCampaignIds: { $exists: false } },
      { $set: { clientCampaignIds: [] } }
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
