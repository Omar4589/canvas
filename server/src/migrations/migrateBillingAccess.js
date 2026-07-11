import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Membership } from '../models/Membership.js';
import { User } from '../models/User.js'; // registered for populate
import { Organization } from '../models/Organization.js'; // registered for populate

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
  const pending = await Membership.find(filter)
    .populate('userId', 'firstName lastName email')
    .populate('organizationId', 'name slug')
    .lean();
  console.log(`${pending.length} admin memberships to grant billing access · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const m of pending) {
    const u = m.userId;
    const o = m.organizationId;
    const who = u ? `${u.firstName} ${u.lastName} <${u.email}>` : '(user missing)';
    const where = o ? `${o.name} (${o.slug})` : '(org missing)';
    console.log(`  · ${who} — ${where}`);
  }

  if (APPLY && pending.length > 0) {
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
