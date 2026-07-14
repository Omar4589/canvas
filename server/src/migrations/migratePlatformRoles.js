import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';

// Grandfather every existing super-admin to `break_glass`.
//
// `platformRole` is new and defaults to `support` — the least-privilege tier. Without this, the
// moment the split ships, today's super-admins would lose the ability to delete an organization,
// promote staff, or edit canonical identity, and would not understand why.
//
// New staff should be created as `support` and escalated deliberately. The whole point of the split is
// that hiring a second person does not mean handing them an omniscient login — but it must not break
// the person who already has one.
//
// NOTE: break_glass does NOT mean unlogged. Every staff member, including break-glass, still needs a
// SupportAccessGrant to enter a customer organization, and every voter record they open is written to
// AccessLog. "No god mode" means no unlogged mode.
//
//   npm run migrate:platform-roles            # dry run
//   npm run migrate:platform-roles -- --apply
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const filter = { isSuperAdmin: true, platformRole: { $ne: 'break_glass' } };
  const pending = await User.find(filter, 'firstName lastName email platformRole').lean();

  console.log(`${pending.length} super-admin(s) to grandfather to break_glass · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const u of pending) {
    console.log(`  · ${u.firstName} ${u.lastName} <${u.email}>  (${u.platformRole || 'unset'} → break_glass)`);
  }

  if (APPLY && pending.length > 0) {
    const res = await User.updateMany(filter, { $set: { platformRole: 'break_glass' } });
    console.log(`\nGranted break-glass to ${res.modifiedCount} existing super-admin(s).`);
    console.log('New staff should be created as `support` and escalated only when they need it.');
  } else if (!APPLY) {
    console.log('\nDry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
