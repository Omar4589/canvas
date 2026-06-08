import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Membership } from '../models/Membership.js';

// Cleanup after replacing the client-login model with public share links: the Membership `role`
// enum no longer allows 'client', so delete those membership docs and unset any leftover
// `clientCampaignIds` field (backfilled by the old migrateClientRole). The global User accounts are
// left untouched. Idempotent — safe to re-run. Run before/with the deploy that drops the role.
//
// Usage: node src/migrations/cleanupClientRole.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const clientCount = await Membership.countDocuments({ role: 'client' });
  const fieldCount = await Membership.countDocuments({ clientCampaignIds: { $exists: true } });
  console.log(
    `${clientCount} client memberships to delete · ${fieldCount} docs with a leftover clientCampaignIds field · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );

  if (APPLY) {
    if (clientCount) {
      const r = await Membership.deleteMany({ role: 'client' });
      console.log(`deleted ${r.deletedCount} client memberships.`);
    }
    const r2 = await Membership.updateMany(
      { clientCampaignIds: { $exists: true } },
      { $unset: { clientCampaignIds: '' } }
    );
    if (r2.modifiedCount) console.log(`unset clientCampaignIds on ${r2.modifiedCount} docs.`);
  } else {
    console.log('Dry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
