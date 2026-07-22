import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { seedDemoOrg } from '../services/platform/seedDemoOrg.js';

// Console runner for the demo seeder. The engine lives in services/platform/seedDemoOrg.js
// because the super-admin "Rebuild demo day" button calls the SAME function — everything
// CLI-shaped (the connection, the flags, stdout, the exit code) lives here and nowhere else,
// so importing the engine from a route can never connect, disconnect, or kill the dyno.
//
// Usage (from the repo ROOT — Heroku's Run console starts there, and `node src/utils/…` is
// relative to server/ and just errors):
//   npm run seed:demo                       # dry run — prints the plan, writes nothing
//   npm run seed:demo -- --apply            # full build (idempotent)
//   npm run seed:demo -- --reset --apply    # wipe activity layer, restage fresh
//   npm run seed:demo -- --rebuild --apply  # WIPE the campaign and rebuild from scratch
//
// The CLI keeps every permissive default: it MAY import voters, it MAY sync review-account
// passwords from the SEED_DEMO_* vars, and it prints the credentials at the end. The button
// switches all three off — see the options block on seedDemoOrg().
async function main() {
  await connectDb(process.env.MONGODB_URI);
  await seedDemoOrg({
    apply: process.argv.includes('--apply'),
    reset: process.argv.includes('--reset'),
    rebuild: process.argv.includes('--rebuild'),
    log: console.log,
  });
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
