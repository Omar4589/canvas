import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { recomputeCutAttributesForCampaign } from '../services/turf/computeCutAttributes.js';

// M-b: backfill the denormalized cut columns (precinct/districts/city/zip/county)
// onto existing households (modal voter value + conflict flags). Idempotent;
// re-run after a county-bearing re-import to fill countyValue.
//
// Usage: node src/migrations/migrateCutAttributes.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const campaigns = await Campaign.find({}, { _id: 1, name: 1 }).lean();
  console.log(`${campaigns.length} campaigns · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  for (const c of campaigns) {
    if (!APPLY) {
      console.log(`  ${c.name}: would recompute cut attributes`);
      continue;
    }
    const n = await recomputeCutAttributesForCampaign(c._id);
    console.log(`  ${c.name}: updated ${n} households`);
  }

  console.log(APPLY ? '\nDone.' : '\nDry run — re-run with --apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
