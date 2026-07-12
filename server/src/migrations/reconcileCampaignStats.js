import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { computeCampaignStats, recomputeCampaignStats } from '../services/reports/campaignCounters.js';

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
const APPLY = process.argv.includes('--apply');

const COUNTER_KEYS = [
  'activityCount',
  'knockCount',
  'surveyedKnockCount',
  'litKnockCount',
  'refusedKnockCount',
  'litDroppedCount',
  'surveyCount',
];

function sameStats(stored, fresh) {
  for (const k of COUNTER_KEYS) {
    if ((stored?.[k] || 0) !== (fresh[k] || 0)) return false;
  }
  const storedLast = stored?.lastActivityAt ? new Date(stored.lastActivityAt).getTime() : null;
  const freshLast = fresh.lastActivityAt ? new Date(fresh.lastActivityAt).getTime() : null;
  if (storedLast !== freshLast) return false;
  const a = new Set((stored?.canvasserIds || []).map(String));
  const b = new Set((fresh.canvasserIds || []).map(String));
  if (a.size !== b.size) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const campaigns = await Campaign.find({}, { name: 1, stats: 1 }).lean();
  console.log(`${campaigns.length} campaign(s) · mode: ${APPLY ? 'APPLY (recompute + stamp all)' : 'DRY RUN'}\n`);

  let unseeded = 0;
  let drifted = 0;
  for (const c of campaigns) {
    const fresh = await computeCampaignStats(c._id);
    if (!c.stats?.reconciledAt) {
      unseeded += 1;
      console.log(`UNSEEDED  ${c.name} — will seed: knocks ${fresh.knockCount}, surveys ${fresh.surveyCount}, activity ${fresh.activityCount}`);
    } else if (!sameStats(c.stats, fresh)) {
      drifted += 1;
      const diffs = COUNTER_KEYS.filter((k) => (c.stats?.[k] || 0) !== (fresh[k] || 0))
        .map((k) => `${k} ${c.stats?.[k] || 0}→${fresh[k] || 0}`)
        .join(', ');
      console.log(`DRIFTED   ${c.name} — ${diffs || 'lastActivityAt/canvasserIds differ'}`);
    }
    if (APPLY) await recomputeCampaignStats(c._id);
  }

  if (APPLY) {
    console.log(`\nDone — recomputed + stamped stats on ${campaigns.length} campaign(s).`);
  } else {
    console.log(
      unseeded || drifted
        ? `\n${unseeded} unseeded, ${drifted} drifted. Re-run with --apply to reconcile.`
        : '\nAll campaign stats match the ledgers. Nothing to do.'
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
