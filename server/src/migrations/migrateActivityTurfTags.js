import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Turf } from '../models/Turf.js';
import { Household } from '../models/Household.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { assignHouseholdToTurf } from '../services/turf/boundary.js';

// M-d: backfill pre-turf history. Stage 1 sets passId on null-pass rows to the
// campaign's active pass; Stage 2 stamps turfId by geo-containment (run AFTER
// Pass-1 turfs are generated). Re-runnable.
//
// Usage: node src/migrations/migrateActivityTurfTags.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const campaigns = await Campaign.find(
    { activePassId: { $ne: null } },
    { _id: 1, name: 1, activePassId: 1 }
  ).lean();
  console.log(`${campaigns.length} campaigns with an active pass · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  for (const c of campaigns) {
    const passId = c.activePassId;

    // Stage 1: passId backfill.
    const caNull = await CanvassActivity.countDocuments({ campaignId: c._id, passId: null });
    const srNull = await SurveyResponse.countDocuments({ campaignId: c._id, passId: null });
    console.log(`  ${c.name}: ${caNull} activities + ${srNull} responses with null pass`);
    if (APPLY) {
      await CanvassActivity.updateMany({ campaignId: c._id, passId: null }, { $set: { passId } });
      await SurveyResponse.updateMany({ campaignId: c._id, passId: null }, { $set: { passId } });
    }

    // Stage 2: turfId backfill (only where the pass has turfs).
    const turfs = await Turf.find(
      { passId, status: { $in: ['draft', 'published'] } },
      { _id: 1, boundary: 1, centroid: 1 }
    ).lean();
    if (!turfs.length) {
      console.log('    no turfs for the pass yet — skipping turfId backfill');
      continue;
    }

    const households = await Household.find({ campaignId: c._id }, { _id: 1, turfId: 1, location: 1 }).lean();
    const hTurf = new Map();
    for (const h of households) {
      if (h.turfId) hTurf.set(String(h._id), h.turfId);
      else if (h.location?.coordinates?.length === 2) {
        const tid = assignHouseholdToTurf(h.location.coordinates, turfs);
        if (tid) hTurf.set(String(h._id), tid);
      }
    }
    console.log(`    resolved a turf for ${hTurf.size} / ${households.length} households`);

    if (APPLY) {
      const ops = [];
      for (const [hid, tid] of hTurf) {
        ops.push({
          updateMany: {
            filter: {
              campaignId: c._id,
              householdId: new mongoose.Types.ObjectId(hid),
              passId,
              turfId: null,
            },
            update: { $set: { turfId: tid } },
          },
        });
      }
      for (let i = 0; i < ops.length; i += 1000) {
        const slice = ops.slice(i, i + 1000);
        await CanvassActivity.bulkWrite(slice, { ordered: false });
        await SurveyResponse.bulkWrite(slice, { ordered: false });
      }
      console.log(`    stamped turfId on tagged rows for ${ops.length} households`);
    }
  }

  console.log(APPLY ? '\nDone.' : '\nDry run — re-run with --apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
