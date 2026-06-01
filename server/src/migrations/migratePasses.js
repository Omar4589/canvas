import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { WalkList } from '../models/WalkList.js';
import { Pass } from '../models/Pass.js';

// M-a: give every existing campaign a frozen "All voters (initial)" walk list +
// an active Pass 1, and set campaign.activePassId. Idempotent.
//
// Usage: node src/migrations/migratePasses.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const campaigns = await Campaign.find({}).lean();
  console.log(`${campaigns.length} campaigns · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  let created = 0;
  for (const c of campaigns) {
    const existing = await Pass.findOne({ campaignId: c._id, roundNumber: 1 }).select('_id').lean();
    if (existing) {
      console.log(`  ${c.name}: already has Pass 1`);
      if (APPLY && !c.activePassId) {
        await Campaign.updateOne({ _id: c._id }, { $set: { activePassId: existing._id } });
      }
      continue;
    }

    const households = await Household.find({ campaignId: c._id, isActive: true }, { _id: 1 }).lean();
    const householdIds = households.map((h) => h._id);
    const voters = await Voter.find({ householdId: { $in: householdIds } }, { _id: 1 }).lean();
    const voterIds = voters.map((v) => v._id);
    console.log(`  ${c.name}: ${householdIds.length} households / ${voterIds.length} voters`);
    if (!APPLY) continue;

    const walkList = await WalkList.create({
      organizationId: c.organizationId,
      campaignId: c._id,
      name: 'All voters (initial)',
      filter: {},
      householdIds,
      voterIds,
      householdCount: householdIds.length,
      voterCount: voterIds.length,
    });
    const pass = await Pass.create({
      organizationId: c.organizationId,
      campaignId: c._id,
      roundNumber: 1,
      name: 'Pass 1',
      walkListId: walkList._id,
      status: 'active',
      activatedAt: new Date(),
    });
    await Campaign.updateOne(
      { _id: c._id },
      { $set: { activePassId: pass._id, timeZone: c.timeZone || 'America/New_York' } }
    );
    created++;
  }

  console.log(APPLY ? `\nCreated Pass 1 for ${created} campaigns.` : '\nDry run — re-run with --apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
