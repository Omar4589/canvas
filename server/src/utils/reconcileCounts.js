// One-time cleanup of historical data that pre-dates the per-voter / per-canvasser
// overwrite rules in the mobile canvass route. Brings the database into the same
// invariants the live writes now enforce:
//
//   1. Each voter has at most ONE SurveyResponse PER PASS (the most recent).
//   2. Each (canvasser, household) pair has at most ONE CanvassActivity row
//      PER PASS (not_home / wrong_address / survey_submitted / lit_dropped).
//   3. voter.surveyStatus is `surveyed` iff any SurveyResponse exists for them.
//   4. household.status follows sticky-completion precedence (a survey/lit-drop
//      can't be downgraded; otherwise latest wins), or `unknocked` when none.
//
// Usage (from server/):
//   node src/utils/reconcileCounts.js               # preview only — no writes
//   node src/utils/reconcileCounts.js --apply       # actually clean up
//
// Heroku:
//   heroku run "node src/utils/reconcileCounts.js" -a <app>
//   heroku run "node src/utils/reconcileCounts.js --apply" -a <app>

import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { Voter } from '../models/Voter.js';
import { Household } from '../models/Household.js';
import { Campaign } from '../models/Campaign.js';
import { ACTION_TO_STATUS } from './statusPrecedence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');

function header(s) {
  console.log(`\n— ${s} —`);
}

async function dedupSurveyResponses() {
  header('1. Dedup SurveyResponses (keep newest per voter PER PASS)');
  const dupes = await SurveyResponse.aggregate([
    {
      $group: {
        _id: { voterId: '$voterId', passId: '$passId' },
        count: { $sum: 1 },
        ids: { $push: { _id: '$_id', submittedAt: '$submittedAt' } },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (!dupes.length) {
    console.log('  no voters with duplicate surveys.');
    return;
  }
  let toDelete = 0;
  const dropIds = [];
  for (const d of dupes) {
    const sorted = d.ids.sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
    );
    for (const s of sorted.slice(1)) dropIds.push(s._id);
    toDelete += sorted.length - 1;
  }
  console.log(
    `  ${dupes.length} voters with duplicates · ${toDelete} stale rows would be deleted`
  );
  if (APPLY && dropIds.length) {
    const r = await SurveyResponse.deleteMany({ _id: { $in: dropIds } });
    console.log(`  deleted ${r.deletedCount} SurveyResponse rows.`);
  }
}

async function dedupCanvassActivities() {
  header('2. Dedup CanvassActivity (keep newest per canvasser × household × pass)');
  const dupes = await CanvassActivity.aggregate([
    {
      $match: {
        actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', householdId: '$householdId', passId: '$passId' },
        count: { $sum: 1 },
        ids: { $push: { _id: '$_id', timestamp: '$timestamp' } },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (!dupes.length) {
    console.log('  no (canvasser, household) pairs with duplicate activities.');
    return;
  }
  let toDelete = 0;
  const dropIds = [];
  for (const d of dupes) {
    const sorted = d.ids.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    for (const s of sorted.slice(1)) dropIds.push(s._id);
    toDelete += sorted.length - 1;
  }
  console.log(
    `  ${dupes.length} pairs with duplicates · ${toDelete} stale rows would be deleted`
  );
  if (APPLY && dropIds.length) {
    const r = await CanvassActivity.deleteMany({ _id: { $in: dropIds } });
    console.log(`  deleted ${r.deletedCount} CanvassActivity rows.`);
  }
}

async function reconcileVoterStatus() {
  header('3. Reconcile voter.surveyStatus to match SurveyResponse existence');
  const surveyedIds = await SurveyResponse.distinct('voterId');
  const surveyedSet = new Set(surveyedIds.map(String));

  const wrongSurveyed = await Voter.countDocuments({
    surveyStatus: 'surveyed',
    _id: { $nin: surveyedIds },
  });
  const wrongNotSurveyed = await Voter.countDocuments({
    surveyStatus: 'not_surveyed',
    _id: { $in: surveyedIds },
  });
  console.log(
    `  ${wrongSurveyed} voters marked 'surveyed' but have no SurveyResponse`
  );
  console.log(
    `  ${wrongNotSurveyed} voters marked 'not_surveyed' but DO have a SurveyResponse`
  );
  if (APPLY) {
    const r1 = await Voter.updateMany(
      { surveyStatus: 'surveyed', _id: { $nin: surveyedIds } },
      { $set: { surveyStatus: 'not_surveyed' } }
    );
    const r2 = await Voter.updateMany(
      { surveyStatus: 'not_surveyed', _id: { $in: surveyedIds } },
      { $set: { surveyStatus: 'surveyed' } }
    );
    console.log(
      `  reset ${r1.modifiedCount} → not_surveyed, set ${r2.modifiedCount} → surveyed.`
    );
  }
}

async function reconcileHouseholdStatus() {
  header('4. Reconcile household.status with sticky-completion precedence');
  const aggByHousehold = await CanvassActivity.aggregate([
    { $match: { actionType: { $ne: 'note_added' } } },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$householdId',
        actions: { $addToSet: '$actionType' },
        latestActionType: { $first: '$actionType' },
        latestTimestamp: { $first: '$timestamp' },
        latestUserId: { $first: '$userId' },
      },
    },
  ]);
  const aggMap = new Map(aggByHousehold.map((a) => [String(a._id), a]));

  const campaigns = await Campaign.find({}, { type: 1 }).lean();
  const typeByCampaign = new Map(campaigns.map((c) => [String(c._id), c.type]));

  const households = await Household.find({}, { _id: 1, campaignId: 1, status: 1 }).lean();

  let needsUpdate = 0;
  const ops = [];
  for (const h of households) {
    const agg = aggMap.get(String(h._id));
    const type = typeByCampaign.get(String(h.campaignId));
    let newStatus = 'unknocked';
    let latest = null;
    if (agg) {
      latest = { timestamp: agg.latestTimestamp, userId: agg.latestUserId };
      const completion = type === 'lit_drop' ? 'lit_dropped' : 'survey_submitted';
      if (agg.actions.includes(completion)) {
        newStatus = type === 'lit_drop' ? 'lit_dropped' : 'surveyed';
      } else {
        newStatus = ACTION_TO_STATUS[agg.latestActionType] || 'unknocked';
      }
    }
    if (h.status !== newStatus) {
      needsUpdate++;
      ops.push({
        updateOne: {
          filter: { _id: h._id },
          update: {
            $set: {
              status: newStatus,
              lastActionAt: latest?.timestamp || null,
              lastActionBy: latest?.userId || null,
            },
          },
        },
      });
    }
  }
  console.log(`  ${needsUpdate} households have stale status`);
  if (APPLY && ops.length) {
    const r = await Household.bulkWrite(ops, { ordered: false });
    console.log(`  updated ${r.modifiedCount} households.`);
  }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'PREVIEW (no writes)'}`);
  await connectDb(process.env.MONGODB_URI);

  await dedupSurveyResponses();
  await dedupCanvassActivities();
  await reconcileVoterStatus();
  await reconcileHouseholdStatus();

  await mongoose.disconnect();
  console.log(
    APPLY
      ? '\nDone. Counts should now reconcile.'
      : '\nDone (preview). Re-run with --apply to actually clean up.'
  );
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
