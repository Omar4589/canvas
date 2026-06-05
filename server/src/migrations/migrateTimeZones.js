import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { defaultZoneForState } from '../utils/usStateTimeZone.js';

// Backfill Campaign.timeZone from each campaign's STATE (dominant zone), replacing the
// old blanket 'America/New_York' default that was wrong for non-Eastern campaigns (e.g.
// a Tyler, TX campaign → America/Chicago). Also set each Organization.timeZone to the
// most common timezone among its campaigns (for org-wide rollups). Idempotent: after a
// run, correctly-zoned campaigns won't be touched again.
//
// Usage: node src/migrations/migrateTimeZones.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const campaigns = await Campaign.find({}, { _id: 1, name: 1, state: 1, timeZone: 1, organizationId: 1 }).lean();
  console.log(`${campaigns.length} campaigns · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const byOrg = new Map(); // orgId -> [tz, ...]
  let changed = 0;
  for (const c of campaigns) {
    const tz = defaultZoneForState(c.state);
    const k = String(c.organizationId);
    if (!byOrg.has(k)) byOrg.set(k, []);
    byOrg.get(k).push(tz);
    if (c.timeZone !== tz) {
      changed += 1;
      console.log(`  campaign "${c.name}" (${c.state}): ${c.timeZone} -> ${tz}`);
      if (APPLY) await Campaign.updateOne({ _id: c._id }, { $set: { timeZone: tz } });
    }
  }

  const orgs = await Organization.find({}, { _id: 1, name: 1, timeZone: 1 }).lean();
  for (const o of orgs) {
    const tzs = byOrg.get(String(o._id)) || [];
    const counts = {};
    for (const t of tzs) counts[t] = (counts[t] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'America/New_York';
    if (o.timeZone !== best) {
      console.log(`  org "${o.name}": ${o.timeZone} -> ${best}`);
      if (APPLY) await Organization.updateOne({ _id: o._id }, { $set: { timeZone: best } });
    }
  }

  console.log(`\n${APPLY ? `Applied (${changed} campaigns updated).` : `Dry run (${changed} campaigns would change) — re-run with --apply.`}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
