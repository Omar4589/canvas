import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { sweepStaleImportJobs } from '../services/import/sweepStaleImports.js';

// One-off console run of the nightly stale-import sweep: expires stuck ImportJobs
// (active status, lapsed heartbeat) and deletes orphaned raw voter-file uploads in
// GridFS (terminal or vanished jobs, >24h old). Same code the maintenance queue
// runs at 05:53 UTC — this exists so the backlog of pre-fix orphans can be purged
// immediately from the Heroku dashboard's Run console:
//
//   npm run sweep:raw-imports
async function main() {
  await connectDb(process.env.MONGODB_URI);
  const res = await sweepStaleImportJobs();
  console.log(`Expired ${res.expired} stuck import job(s).`);
  console.log(`Deleted ${res.rawDeleted} orphaned raw upload(s) from GridFS.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('sweep failed:', err);
  process.exit(1);
});
