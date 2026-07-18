import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { FlagReview } from '../../models/FlagReview.js';
import { KNOCKABLE_DOOR_FILTER } from '../canvass/knockableDoorFilter.js';
import { DEMO_ORG_SLUG } from '../../utils/demoData/namePools.js';
import {
  stageDemoActivity, persistDemoActivity, ARCHIVED_DAY_OFFSETS, localTime,
} from './demoActivity.js';

// Re-stage the DEMO org's FULL 2-round canvassing story relative to NOW, so the
// dashboard looks alive right before a pitch: the archived Round 1 re-lands on
// days −8..−12, and the active Round 2 on the four prior evenings plus a partial
// "today" whose knocks run from mid-morning up to the minute this is invoked —
// never into the future. Every round with published books is restaged — archived
// AND active — because the wipe below clears the campaign's entire ledger, so an
// active-only restage would erase Round 1's history on the first press.
// Idempotent: each run wipes the campaign's activity layer (activities, survey
// responses, flag reviews) and rebuilds it; doors, voters, books, accounts, the
// voted layer, and the published client report / share link all survive
// untouched. Locked to the demo org by slug — this can never touch a real org.
//
// Generation + persistence live in the shared demoActivity module, which the seed
// uses too, so the button and the seed stay realistic in lockstep: per-canvasser
// scheduling (~15-20 doors/hr), a ~22% connection rate, and realistic survey
// answers. The reviewer canvasser's book is left unwalked in EVERY round so the
// App Store / Google Play review account always has fresh doors — identified by a
// durable marker (isReviewerBook) set at seed time, NOT a runtime email lookup
// that can drift.

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

  // EVERY round with published books — archived Round 1 included, not just the
  // active round — so a press regenerates the whole 2-round story the seed built.
  const passes = await Pass.find({ campaignId: campaign._id, status: { $in: ['archived', 'active'] } })
    .sort({ roundNumber: 1 })
    .lean();
  const passIds = passes.map((p) => p._id);
  const turfs = await Turf.find({ campaignId: campaign._id, passId: { $in: passIds }, status: 'published' })
    .sort({ name: 1 })
    .lean();
  const assignments = await TurfAssignment.find({ campaignId: campaign._id, passId: { $in: passIds } }).lean();
  const assignmentsByTurf = new Map(assignments.map((a) => [String(a.turfId), a.userId]));

  // The reviewer's protected books are identified by a durable marker (set by the
  // seed/repair in EVERY round), NOT a runtime email lookup — so the guard can
  // never silently fail and let a review book get walked. The check is PER ROUND:
  // console assign/unassign recreates assignment rows without the flag, so one
  // round's marker can be lost while another's survives — a global "any marker
  // exists" check would then walk the review account's book in the unmarked round.
  // Refuse instead, naming the round.
  const reviewerTurfIds = new Set(assignments.filter((a) => a.isReviewerBook).map((a) => String(a.turfId)));
  const reviewerPassIds = new Set(
    assignments.filter((a) => a.isReviewerBook).map((a) => String(a.passId))
  );
  // Only rounds that would actually stage (≥1 assigned published book) need a marker —
  // a bookless round stages nothing and can't walk anyone.
  const passesWithBooks = new Set(
    turfs.filter((t) => assignmentsByTurf.get(String(t._id))).map((t) => String(t.passId))
  );
  const unguarded = passes.filter(
    (p) => passesWithBooks.has(String(p._id)) && !reviewerPassIds.has(String(p._id))
  );
  if (unguarded.length) {
    const err = new Error(
      `No reviewer book is marked (isReviewerBook) in round(s) ${unguarded
        .map((p) => `'${p.name}'`)
        .join(', ')} — run the demo seed/repair first, or the App Store review `
      + 'account would be walked in that round.'
    );
    err.status = 500;
    throw err;
  }
  // Group each round's assigned, non-reviewer books; rounds with none stage nothing.
  const booksByPass = new Map();
  for (const t of turfs) {
    const uid = assignmentsByTurf.get(String(t._id));
    if (!uid || reviewerTurfIds.has(String(t._id))) continue; // unassigned or marked reviewer book
    const key = String(t.passId);
    if (!booksByPass.has(key)) booksByPass.set(key, []);
    booksByPass.get(key).push(t);
  }
  const rounds = passes
    .map((pass) => ({ pass, books: booksByPass.get(String(pass._id)) || [] }))
    .filter((r) => r.books.length);
  if (!rounds.length) {
    const err = new Error('Demo campaign has no assigned non-reviewer books to stage.');
    err.status = 400;
    throw err;
  }

  // Skip fully-voted / DNC / excluded doors — the field app never shows them either.
  const households = await Household.find(
    { campaignId: campaign._id, ...KNOCKABLE_DOOR_FILTER }
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

  // ---- generate every round, then persist ONCE (shared generator + batched writes) ----
  // One persist is REQUIRED, not just cheaper: Household.status is
  // latest-across-passes, so a door knocked in both rounds needs a single
  // resolveStatus over the concatenated activities to color correctly.
  const allActivities = [];
  const allSurveys = [];
  const stagedRounds = [];
  const doorSets = [];
  let todayKnocks = 0;
  for (const { pass, books } of rounds) {
    const staged = stageDemoActivity({
      rng, campaign, template, tz, stagedBooks: books, assignmentsByTurf, hhById, votersByHousehold,
      // Archived rounds re-land on the old window; the active round keeps the
      // default (today + four prior evenings).
      ...(pass.status === 'archived' ? { dayOffsets: ARCHIVED_DAY_OFFSETS } : {}),
    });
    allActivities.push(...staged.activities);
    allSurveys.push(...staged.surveys);
    todayKnocks += staged.todayKnocks;
    doorSets.push(new Set(staged.activities.map((a) => String(a.householdId))));
    stagedRounds.push({
      pass: pass.name, roundNumber: pass.roundNumber, status: pass.status,
      books: books.length, activities: staged.activities.length, surveys: staged.surveys.length,
    });
  }
  await persistDemoActivity({ campaign, activities: allActivities, surveys: allSurveys });

  // Cross-round re-knocks: distinct doors knocked in more than one round.
  const hitCounts = new Map();
  for (const set of doorSets) for (const id of set) hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
  const reknockDoors = [...hitCounts.values()].filter((n) => n > 1).length;

  // Touch up Pass lifecycle dates so the narrative stays coherent relative to NOW:
  // the archived round closed (−7d 6pm) just after its staged window (−8..−12) and
  // the active round opened at the boundary (−6d 9am), before all its knocks.
  // Cheap slug-locked updates; the demo shape is one archived + one active round.
  const now = Date.now();
  for (const { pass } of rounds) {
    const patch = pass.status === 'archived'
      ? { activatedAt: localTime(-14, 9 * 60, tz, now), archivedAt: localTime(-7, 18 * 60, tz, now) }
      : { activatedAt: localTime(-6, 9 * 60, tz, now), archivedAt: null };
    await Pass.updateOne({ _id: pass._id }, { $set: patch });
  }

  return {
    org: org.name,
    campaign: campaign.name,
    wiped: { activities: wActs.deletedCount, surveys: wResp.deletedCount, flagReviews: wFlags.deletedCount },
    staged: {
      activities: allActivities.length,
      surveys: allSurveys.length,
      todayKnocks,
      books: rounds.reduce((s, r) => s + r.books.length, 0),
    },
    rounds: stagedRounds,
    reknockDoors,
  };
}
