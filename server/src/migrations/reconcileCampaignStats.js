import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { reconcileAllCampaignStats } from '../services/reports/campaignCounters.js';

// Backfill + repair for the denormalized Campaign.stats counters (models/Campaign.js). Recomputes
// every campaign's stats from the CanvassActivity/SurveyResponse ledgers — the same aggregations
// the live dashboards run — and stamps stats.reconciledAt so the readers start trusting them.
//
//   node src/migrations/reconcileCampaignStats.js            # dry run — list unseeded/drifted campaigns
//   node src/migrations/reconcileCampaignStats.js --apply    # recompute + stamp every campaign
//
// Run once after deploying the stats feature (unseeded legacy campaigns keep the dashboards on
// the live-aggregation fallback until then — slower, never wrong), and any time drift is
// suspected (e.g. after a manual migration that bulk-edits the ledgers, or the rare concurrent
// same-door write race documented in services/reports/campaignCounters.js).
//
// The sweep itself lives in the service (reconcileAllCampaignStats), because the nightly
// maintenance job runs the SAME code — a CLI whose idea of "drifted" differs from the scheduled
// repair's would send an operator hunting for a discrepancy the job had already fixed.
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const res = await reconcileAllCampaignStats({ apply: APPLY });
  console.log(`${res.scanned} campaign(s) · mode: ${APPLY ? 'APPLY (recompute + stamp all)' : 'DRY RUN'}\n`);

  for (const d of res.details) {
    if (d.state === 'unseeded') {
      console.log(
        `UNSEEDED  ${d.name} — will seed: knocks ${d.fresh.knockCount}, ` +
        `surveys ${d.fresh.surveyCount}, activity ${d.fresh.activityCount}`
      );
    } else {
      console.log(`DRIFTED   ${d.name} — ${d.diffs.join(', ') || 'lastActivityAt/canvasserIds differ'}`);
    }
  }

  if (APPLY) {
    console.log(`\nDone — recomputed + stamped stats on ${res.scanned} campaign(s).`);
  } else {
    console.log(
      res.unseeded || res.drifted
        ? `\n${res.unseeded} unseeded, ${res.drifted} drifted. Re-run with --apply to reconcile.`
        : '\nAll campaign stats match the ledgers. Nothing to do.'
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
