import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Effort } from '../models/Effort.js';
import { Pass } from '../models/Pass.js';
import { Household } from '../models/Household.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';

// Efforts migration: wrap every campaign's existing households + passes in ONE
// default "Main" effort, materialize Household.effortId (so nothing lands in
// Intake on day one), tag Pass.effortId + backfill effortId on activities /
// responses, and drop the obsolete Campaign.activePassId. Then sync indexes
// (Pass roundNumber uniqueness moved from {campaignId,roundNumber} to
// {effortId,roundNumber}).
//
// IMPORTANT: run this with --apply BEFORE starting the updated server — the new
// Pass unique index requires effortId to be set on every pass first.
//
// Usage: node src/migrations/migrateEfforts.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  // Don't let model registration auto-build the new Pass {effortId, roundNumber}
  // unique index on connect — effortId is still null until we backfill below, which
  // would dup-fail. We build indexes explicitly via syncIndexes() after the backfill.
  mongoose.set('autoIndex', false);
  await connectDb(process.env.MONGODB_URI);
  const campaigns = await Campaign.find({}).lean();
  console.log(`${campaigns.length} campaigns · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  for (const c of campaigns) {
    let effort = await Effort.findOne({ campaignId: c._id }).sort({ createdAt: 1 });
    const hhCount = await Household.countDocuments({ campaignId: c._id });
    const passCount = await Pass.countDocuments({ campaignId: c._id });
    console.log(
      `  ${c.name} (${c.type}): ${hhCount} households / ${passCount} passes · ${
        effort ? `effort "${effort.name}" exists` : 'no effort'
      }`
    );
    if (!APPLY) continue;

    if (!effort) {
      effort = await Effort.create({
        organizationId: c.organizationId,
        campaignId: c._id,
        name: 'Main',
        status: 'active',
        surveyTemplateId: null,
      });
    }

    // Only fold doors into the default effort while the campaign is still
    // SINGLE-effort (first run, or a safe re-run). Once you've split it into
    // multiple efforts, re-running must NOT sweep newly-imported Intake doors
    // into the default effort — so skip the materialize step entirely. This is
    // what makes the migration safe to leave in the release phase.
    const effortCount = await Effort.countDocuments({ campaignId: c._id });
    if (effortCount > 1) {
      console.log('    → multiple efforts exist; already migrated, Intake preserved (skip).');
      continue;
    }

    // Materialize door ownership + round/effort tags for anything not yet set.
    const hh = await Household.updateMany(
      { campaignId: c._id, effortId: null },
      { $set: { effortId: effort._id } }
    );
    const ps = await Pass.updateMany(
      { campaignId: c._id, $or: [{ effortId: null }, { effortId: { $exists: false } }] },
      { $set: { effortId: effort._id } }
    );
    const ca = await CanvassActivity.updateMany(
      { campaignId: c._id, effortId: null },
      { $set: { effortId: effort._id } }
    );
    const sr = await SurveyResponse.updateMany(
      { campaignId: c._id, effortId: null },
      { $set: { effortId: effort._id } }
    );
    await Campaign.updateOne({ _id: c._id }, { $unset: { activePassId: '' } });
    console.log(
      `    → households:${hh.modifiedCount} passes:${ps.modifiedCount} activities:${ca.modifiedCount} responses:${sr.modifiedCount}`
    );
  }

  if (APPLY) {
    // Pass: build {effortId,roundNumber} unique, drop the old {campaignId,roundNumber}.
    // Household: build {campaignId,effortId}. Safe now that effortId is populated.
    console.log('Syncing indexes (Pass, Household)…');
    await Pass.syncIndexes();
    await Household.syncIndexes();
  }

  console.log(APPLY ? '\nEfforts migration applied.' : '\nDry run — re-run with --apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
