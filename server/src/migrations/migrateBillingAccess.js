import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Membership } from '../models/Membership.js';

// Grandfather Membership.billingAccess for existing admins. The field is new (default
// false), so without this every current org admin would suddenly lose the Billing page.
// We grant it to every existing role:'admin' membership — nobody loses access — while new
// admins added afterward default to false until a bill-payer admin grants them.
//
// Idempotent: matches only admins that don't already have billingAccess: true.
//
// Usage: node src/migrations/migrateBillingAccess.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const filter = { role: 'admin', billingAccess: { $ne: true } };
  const pending = await Membership.countDocuments(filter);
  console.log(`${pending} admin memberships to grant billing access · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (APPLY && pending > 0) {
    const res = await Membership.updateMany(filter, { $set: { billingAccess: true } });
    console.log(`Granted billing access to ${res.modifiedCount} admins.`);
  } else if (!APPLY) {
    console.log('Dry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
