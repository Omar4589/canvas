import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { FlagReview } from '../models/FlagReview.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { Campaign } from '../models/Campaign.js';
import { User } from '../models/User.js';

// Finds GPS-audit decisions that have been ORPHANED by a later correction.
//
//   node src/migrations/auditOrphanedReviews.js     # report only — this script never writes
//
// WHY THEY ORPHAN. Flags are never stored; they're recomputed live from the ledger
// (services/audit/flagDetection.js). Only the human decision persists, in a FlagReview keyed to one
// CanvassActivity `_id` — and absence of a record IS the "open" status (models/FlagReview.js). A
// correction is a delete-then-create, so the replacement row gets a NEW `_id` and the old decision
// no longer points at anything that exists.
//
// FOR THE FLAG ITSELF THAT IS THE CORRECT BEHAVIOUR, and it is the owner's stated policy: record a
// door badly and it flags; correct it properly and the flag clears; do it badly again and it flags
// again at full severity. Verified against the live app — do not "fix" that by carrying decisions
// forward, which would let a repeat offence inherit an earlier dismissal and never surface.
//
// WHAT IS ACTUALLY LOST is the decision HISTORY, and only `confirmed` really matters: a confirmed
// fraud finding becomes unreachable, so a canvasser can retire their own finding simply by
// re-recording that door correctly, and an end-of-campaign "how many confirmed findings on this
// canvasser" cannot see it. That is what this script counts.
//
// A LIMIT WORTH KNOWING. A FlagReview stores no canvasser and no household — those lived on the
// action row, which is the thing that was deleted. So an orphaned decision can be reported with its
// campaign, reviewer, date, note and reasons, but CANNOT be attributed back to a canvasser or a
// door. That is itself the argument for keeping confirmed findings somewhere durable: once orphaned,
// the finding is not just invisible, it is unattributable.

function fmt(d) {
  return d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const reviews = await FlagReview.find(
    {},
    'campaignId actionModel actionId status note reviewedBy reviewedAt reasonsAtReview'
  )
    .sort({ reviewedAt: 1 })
    .lean();

  console.log(`Checked ${reviews.length.toLocaleString()} review decision(s).\n`);
  if (!reviews.length) {
    console.log(
      'NOTE: nobody has actioned a flag yet, so this run proves nothing — a decision has to exist\n' +
      'before a correction can orphan it.'
    );
    await mongoose.disconnect();
    return;
  }

  // Which of the referenced actions still exist? One query per model, not per review.
  const byModel = { CanvassActivity: [], SurveyResponse: [] };
  for (const r of reviews) byModel[r.actionModel]?.push(r.actionId);
  const [liveActivity, liveSurvey] = await Promise.all([
    byModel.CanvassActivity.length
      ? CanvassActivity.find({ _id: { $in: byModel.CanvassActivity } }, '_id').lean()
      : [],
    byModel.SurveyResponse.length
      ? SurveyResponse.find({ _id: { $in: byModel.SurveyResponse } }, '_id').lean()
      : [],
  ]);
  const live = new Set([...liveActivity, ...liveSurvey].map((d) => String(d._id)));

  const orphans = reviews.filter((r) => !live.has(String(r.actionId)));
  if (!orphans.length) {
    console.log('No orphaned decisions — every review still points at an action that exists.');
    await mongoose.disconnect();
    return;
  }

  const [campaigns, users] = await Promise.all([
    Campaign.find({ _id: { $in: [...new Set(orphans.map((r) => String(r.campaignId)))] } }, 'name').lean(),
    User.find({ _id: { $in: [...new Set(orphans.map((r) => String(r.reviewedBy)))] } }, 'firstName lastName').lean(),
  ]);
  const campName = new Map(campaigns.map((c) => [String(c._id), c.name]));
  const userName = new Map(
    users.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim() || String(u._id)])
  );

  const confirmed = orphans.filter((r) => r.status === 'confirmed');
  const others = orphans.filter((r) => r.status !== 'confirmed');

  console.log(`${orphans.length} orphaned decision(s) — the door was corrected after the call was made.\n`);

  if (confirmed.length) {
    console.log(`## CONFIRMED findings that are now unreachable  (${confirmed.length}) — these are the ones that matter\n`);
    for (const r of confirmed) {
      console.log(`  ${campName.get(String(r.campaignId)) || r.campaignId}`);
      console.log(`    decided ${fmt(r.reviewedAt)} by ${userName.get(String(r.reviewedBy)) || r.reviewedBy}`);
      console.log(`    reasons: ${(r.reasonsAtReview || []).join(', ') || '—'}`);
      console.log(`    note:    ${r.note || '—'}`);
    }
    console.log('');
  }

  if (others.length) {
    const counts = others.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
    console.log(
      `## Other orphaned decisions: ` +
      Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') +
      `\n   (a lost dismissal just means the flag came back for another look — harmless under the` +
      `\n   current policy, which is why they are only counted here.)\n`
    );
  }

  console.log(
    'Nothing was changed by this script. The FLAG behaviour above is correct and intentional;\n' +
    'what is missing is a durable home for a confirmed finding once its door moves on. Note these\n' +
    'rows carry no canvasser and no household — the action that held them was deleted — so a\n' +
    'confirmed finding, once orphaned, is unattributable as well as invisible.'
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
