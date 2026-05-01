// One-time cleanup of historical data that pre-dates the per-voter / per-canvasser
// overwrite rules in the mobile canvass route. Brings the database into the same
// invariants the live writes now enforce:
//
//   1. Each voter has at most ONE SurveyResponse (the most recently submitted).
//   2. Each (canvasser, household) pair has at most ONE CanvassActivity row
//      (across not_home / wrong_address / survey_submitted).
//   3. voter.surveyStatus is `surveyed` iff a SurveyResponse exists for them.
//   4. household.status reflects the latest CanvassActivity at the house, or
//      `unknocked` when there is none.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');

function header(s) {
  console.log(`\n— ${s} —`);
}

async function dedupSurveyResponses() {
  header('1. Dedup SurveyResponses (keep newest per voter)');
  const dupes = await SurveyResponse.aggregate([
    {
      $group: {
        _id: '$voterId',
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
  header('2. Dedup CanvassActivity (keep newest per canvasser × household)');
  const dupes = await CanvassActivity.aggregate([
    {
      $match: {
        actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', householdId: '$householdId' },
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
  header('4. Reconcile household.status to latest activity (or unknocked)');
  const latestByHousehold = await CanvassActivity.aggregate([
    {
      $match: {
        actionType: { $in: ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'] },
      },
    },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$householdId',
        actionType: { $first: '$actionType' },
        timestamp: { $first: '$timestamp' },
        userId: { $first: '$userId' },
      },
    },
  ]);
  const latestMap = new Map(latestByHousehold.map((a) => [String(a._id), a]));

  const households = await Household.find(
    {},
    { _id: 1, status: 1, lastActionAt: 1, lastActionBy: 1 }
  ).lean();

  let needsUpdate = 0;
  const ops = [];
  for (const h of households) {
    const latest = latestMap.get(String(h._id));
    const newStatus = latest
      ? latest.actionType === 'survey_submitted'
        ? 'surveyed'
        : latest.actionType
      : 'unknocked';
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
