import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { refreshDemoDay } from '../services/platform/refreshDemoDay.js';

// Console runner for the demo-day refresh (the Control Room button calls the
// same service). Safe by construction: the service is locked to the demo org.
//
// Usage: npm run demo:refresh
async function main() {
  await connectDb(process.env.MONGODB_URI);
  const summary = await refreshDemoDay();
  console.log(
    `refreshed '${summary.campaign}' (${summary.org}): staged ${summary.staged.activities} activities ` +
      `(${summary.staged.todayKnocks} today) + ${summary.staged.surveys} surveys across ${summary.staged.books} books ` +
      `· wiped ${summary.wiped.activities} activities / ${summary.wiped.surveys} surveys`
  );
  const rounds = (summary.rounds || [])
    .map((r) => `'${r.pass}' (${r.status}) ${r.activities} activities / ${r.surveys} surveys`)
    .join(' · ');
  if (rounds) console.log(`  rounds: ${rounds} · ${summary.reknockDoors} doors re-knocked across rounds`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
