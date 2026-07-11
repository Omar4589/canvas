import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { FlagReview } from '../../models/FlagReview.js';
import { activePassIds } from '../passes/activePasses.js';
import { DEMO_ORG_SLUG } from '../../utils/demoData/namePools.js';
import { stageDemoActivity, persistDemoActivity } from './demoActivity.js';

// Re-stage the DEMO org's recent canvassing relative to NOW, so the dashboard
// looks alive right before a pitch: the four prior evenings plus a partial "today"
// whose knocks run from mid-morning up to the minute this is invoked — never into
// the future. Idempotent: each run wipes the campaign's activity layer (activities,
// survey responses, flag reviews) and rebuilds it; doors, voters, books, accounts,
// the voted layer, and the published client report / share link all survive
// untouched. Locked to the demo org by slug — this can never touch a real org.
//
// Generation + persistence live in the shared demoActivity module, which the seed
// uses too, so the button and the seed stay realistic in lockstep: per-canvasser
// scheduling (~15-20 doors/hr), a ~22% connection rate, and realistic survey
// answers. The reviewer canvasser's book is left unwalked so the App Store / Google
// Play review account always has fresh doors — identified by a durable marker
// (isReviewerBook) set at seed time, NOT a runtime email lookup that can drift.

// Unseeded on purpose (unlike the seeder's fixed rng): every refresh produces a
// slightly different day.
const rng = {
  next: () => Math.random(),
  int: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
  chance: (p) => Math.random() < p,
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [value, weight] of pairs) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return pairs[pairs.length - 1][0];
  },
};

export async function refreshDemoDay() {
  const org = await Organization.findOne({ slug: DEMO_ORG_SLUG }).lean();
  if (!org) {
    const err = new Error(`Demo org (${DEMO_ORG_SLUG}) not found — run the demo seed first.`);
    err.status = 404;
    throw err;
  }
  const campaign = await Campaign.findOne({ organizationId: org._id, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  if (!campaign) {
    const err = new Error('Demo org has no active campaign — run the demo seed first.');
    err.status = 404;
    throw err;
  }
  const tz = campaign.timeZone || 'America/Chicago';
  const template = campaign.surveyTemplateId
    ? await SurveyTemplate.findById(campaign.surveyTemplateId).lean()
    : null;

  const passIds = await activePassIds(campaign._id);
  const turfs = await Turf.find({ campaignId: campaign._id, passId: { $in: passIds }, status: 'published' })
    .sort({ name: 1 })
    .lean();
  const assignments = await TurfAssignment.find({ campaignId: campaign._id, passId: { $in: passIds } }).lean();
  const assignmentsByTurf = new Map(assignments.map((a) => [String(a.turfId), a.userId]));

  // The reviewer's protected book is identified by a durable marker (set by the
  // seed/repair), NOT a runtime email lookup — so it can never silently fail and
  // get walked. If nothing is marked, refuse rather than risk trampling the App
  // Store review account's fresh doors.
  const reviewerTurfIds = new Set(assignments.filter((a) => a.isReviewerBook).map((a) => String(a.turfId)));
  if (!reviewerTurfIds.size) {
    const err = new Error(
      'No reviewer book is marked (isReviewerBook) — run the demo seed/repair first, '
      + 'or the App Store review account would be walked.'
    );
    err.status = 500;
    throw err;
  }
  const stagedBooks = turfs.filter((t) => {
    const uid = assignmentsByTurf.get(String(t._id));
    return uid && !reviewerTurfIds.has(String(t._id)); // exclude the marked reviewer book
  });
  if (!stagedBooks.length) {
    const err = new Error('Demo campaign has no assigned non-reviewer books to stage.');
    err.status = 400;
    throw err;
  }

  // Skip fully-voted / excluded doors — the field app never shows them either.
  const households = await Household.find(
    { campaignId: campaign._id, isActive: true, fullyVoted: { $ne: true }, excludedFromTurf: { $ne: true } }
  ).lean();
  const hhById = new Map(households.map((h) => [String(h._id), h]));
  const votersByHousehold = new Map();
  for (const v of await Voter.find({ organizationId: org._id }, { householdId: 1 }).lean()) {
    const key = String(v.householdId);
    if (!votersByHousehold.has(key)) votersByHousehold.set(key, []);
    votersByHousehold.get(key).push(v);
  }

  // ---- wipe the activity layer (doors/voters/books/voted/report all survive) ----
  const [wActs, wResp, wFlags] = await Promise.all([
    CanvassActivity.deleteMany({ campaignId: campaign._id }),
    SurveyResponse.deleteMany({ campaignId: campaign._id }),
    FlagReview.deleteMany({ organizationId: org._id }),
  ]);
  await Household.updateMany(
    { campaignId: campaign._id },
    { $set: { status: 'unknocked', lastActionAt: null, lastActionBy: null } }
  );
  await Voter.updateMany({ organizationId: org._id }, { $set: { surveyStatus: 'not_surveyed' } });

  // ---- generate + persist a realistic day (shared generator + batched writes) ----
  const { activities, surveys, todayKnocks } = stageDemoActivity({
    rng, campaign, template, tz, stagedBooks, assignmentsByTurf, hhById, votersByHousehold,
  });
  await persistDemoActivity({ campaign, activities, surveys });

  return {
    org: org.name,
    campaign: campaign.name,
    wiped: { activities: wActs.deletedCount, surveys: wResp.deletedCount, flagReviews: wFlags.deletedCount },
    staged: { activities: activities.length, surveys: surveys.length, todayKnocks, books: stagedBooks.length },
  };
}
