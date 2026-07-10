import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { FlagReview } from '../../models/FlagReview.js';
import { activePassIds } from '../passes/activePasses.js';
import { recomputeHouseholdStatusesByIds } from '../canvass/status.js';
import { normalizeAndFilterAnswers } from '../surveys/normalizeAnswers.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { DEMO_ORG_SLUG } from '../../utils/demoData/namePools.js';

// Re-stage the DEMO org's recent canvassing relative to NOW, so the dashboard
// looks alive right before a pitch: the four prior evenings plus a partial
// "today" whose knocks run from mid-morning up to the minute this is invoked —
// never into the future. Idempotent: each run wipes the campaign's activity
// layer (activities, survey responses, flag reviews) and rebuilds it; doors,
// voters, books, accounts, the voted layer, and the published client report /
// share link all survive untouched. Locked to the demo org by slug — this can
// never touch a real org. The reviewer canvasser's book is left unwalked so the
// Apple/Google review account always has fresh doors.
//
// Survey answers reuse the seeded demo template's question keys
// (candidate_support / top_issue / yard_sign) — normalizeAndFilterAnswers drops
// anything that no longer matches, so an edited template degrades gracefully.

const REVIEWER_EMAIL = (process.env.SEED_DEMO_CANVASSER_EMAIL || 'demo-canvasser@doorline.app')
  .toLowerCase()
  .trim();
const BOOK_FRACTIONS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15];
const OUTCOME_WEIGHTS = [
  ['survey', 58],
  ['not_home', 27],
  ['refused', 9],
  ['wrong_address', 6],
];
const SUPPORT_WEIGHTS = [
  ['strong_support', 38],
  ['lean_support', 22],
  ['undecided', 25],
  ['opposed', 15],
];

// Unseeded on purpose (unlike the seeder's fixed makeRng): every refresh should
// produce a slightly different day.
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

function dayStr(offsetDays, tz) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function localTime(offsetDays, minutesAfterMidnight, tz) {
  const day = dayStr(offsetDays, tz);
  const midnightUtc = zonedDayRange(day, day, tz).$gte;
  return new Date(midnightUtc.getTime() + minutesAfterMidnight * 60000);
}

// Minutes after local midnight, right now, in the campaign's timezone.
function nowLocalMinutes(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

function jitterLocation(hh) {
  const [lng, lat] = hh.location.coordinates;
  const meters = 4 + rng.next() * 12;
  const angle = rng.next() * Math.PI * 2;
  const dLat = (meters * Math.sin(angle)) / 111320;
  const dLng = (meters * Math.cos(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng, accuracy: rng.int(5, 20) };
}

function activityDoc({ hh, userId, actionType, ts, passId, turfId, voterId = null, wasOffline = false }) {
  const loc = jitterLocation(hh);
  const [hLng, hLat] = hh.location.coordinates;
  return {
    organizationId: hh.organizationId,
    campaignId: hh.campaignId,
    householdId: hh._id,
    voterId,
    userId,
    actionType,
    passId,
    turfId,
    effortId: hh.effortId,
    note: null,
    location: loc,
    distanceFromHouseMeters: Math.round(haversineMeters(hLat, hLng, loc.lat, loc.lng)),
    timestamp: ts,
    wasOfflineSubmission: wasOffline,
  };
}

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
  const reviewer = await User.findOne({ email: REVIEWER_EMAIL }, { _id: 1 }).lean();
  const reviewerId = reviewer ? String(reviewer._id) : null;
  const stagedBooks = turfs.filter((t) => {
    const uid = assignmentsByTurf.get(String(t._id));
    return uid && String(uid) !== reviewerId; // reviewer's book stays fresh
  });
  if (!stagedBooks.length) {
    const err = new Error('Demo campaign has no assigned published books to stage.');
    err.status = 400;
    throw err;
  }

  // Skip fully-voted / excluded doors — the field app never shows them either.
  const households = await Household.find(
    { campaignId: campaign._id, isActive: true, fullyVoted: { $ne: true }, excludedFromTurf: { $ne: true } }
  ).lean();
  const hhById = new Map(households.map((h) => [String(h._id), h]));
  const votersByHousehold = new Map();
  for (const v of await Voter.find({ organizationId: org._id }, { householdId: 1, fullName: 1 }).lean()) {
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

  // ---- stage: 4 prior evenings + today's morning-to-now wave ----
  const activities = [];
  const surveys = [];
  const overlapCandidates = [];
  const nowMin = nowLocalMinutes(tz);
  let todayKnocks = 0;

  function knockDoor({ hh, canvasserId, ts, passId, turfId }) {
    const wasOffline = rng.chance(0.1);
    const outcome = rng.weighted(OUTCOME_WEIGHTS);
    const voters = votersByHousehold.get(String(hh._id)) || [];
    if (outcome === 'survey' && template && voters.length) {
      const voter = voters[0];
      const support = rng.weighted(SUPPORT_WEIGHTS);
      const issues = [rng.pick(['public_schools', 'cost_of_living', 'public_safety', 'healthcare', 'roads_infrastructure'])];
      if (rng.chance(0.4)) issues.push(rng.pick(['cost_of_living', 'public_schools', 'healthcare']));
      const raw = [
        { questionKey: 'candidate_support', optionIds: [support] },
        { questionKey: 'top_issue', optionIds: [...new Set(issues)] },
        { questionKey: 'yard_sign', optionIds: [rng.chance(0.4) ? 'yes' : 'no'] },
      ];
      const answers = normalizeAndFilterAnswers(template, raw);
      const loc = jitterLocation(hh);
      const [hLng, hLat] = hh.location.coordinates;
      surveys.push({
        filter: { voterId: voter._id, passId },
        fields: {
          organizationId: hh.organizationId,
          campaignId: campaign._id,
          voterId: voter._id,
          householdId: hh._id,
          userId: canvasserId,
          surveyTemplateId: template._id,
          surveyTemplateVersion: template.version || 1,
          answers,
          note: null,
          location: loc,
          distanceFromHouseMeters: Math.round(haversineMeters(hLat, hLng, loc.lat, loc.lng)),
          submittedAt: ts,
          passId,
          turfId,
          effortId: hh.effortId,
          wasOfflineSubmission: wasOffline,
          editedBy: null,
          editedAt: null,
        },
      });
      activities.push(activityDoc({ hh, userId: canvasserId, actionType: 'survey_submitted', ts, passId, turfId, voterId: voter._id, wasOffline }));
    } else {
      const actionType = outcome === 'survey' ? 'not_home' : outcome;
      activities.push(activityDoc({ hh, userId: canvasserId, actionType, ts, passId, turfId, wasOffline }));
      if (actionType === 'not_home' && overlapCandidates.length < 3) {
        overlapCandidates.push({ hh, ts, canvasserId, passId, turfId });
      }
    }
  }

  for (let b = 0; b < stagedBooks.length; b += 1) {
    const turf = stagedBooks[b];
    const canvasserId = assignmentsByTurf.get(String(turf._id));
    const doorIds = (turf.householdIds || []).map(String).filter((id) => hhById.has(id));
    const fraction = BOOK_FRACTIONS[b % BOOK_FRACTIONS.length];
    const eveningCount = Math.round(doorIds.length * fraction * 0.8);

    // Evenings: -4..-1, ~4:30pm starts, crews out together.
    const sessionCount = eveningCount > 30 ? 2 : 1;
    const perSession = Math.ceil(eveningCount / sessionCount);
    for (let s = 0; s < sessionCount; s += 1) {
      const dayOffset = -4 + ((b + s) % 4);
      let minutes = 16 * 60 + 30 + rng.int(0, 40);
      for (const hhId of doorIds.slice(s * perSession, (s + 1) * perSession)) {
        const hh = hhById.get(hhId);
        knockDoor({ hh, canvasserId, ts: localTime(dayOffset, minutes, tz), passId: turf.passId, turfId: turf._id });
        minutes += rng.int(2, 5);
      }
    }

    // Today: crews out since mid-morning, knocking right up to "now" — never the
    // future. Early-morning runs shrink the window instead of time-traveling, and
    // a per-book cap keeps the day believable (a canvasser with several books
    // shouldn't appear to blitz their whole inventory in one afternoon).
    let start = 9 * 60 + 30 + rng.int(-30, 30);
    const cutoff = nowMin - 4;
    if (start >= cutoff) start = Math.max(7 * 60, cutoff - rng.int(60, 120));
    let minutes = start;
    const todayCap = rng.int(10, 22);
    let stagedToday = 0;
    for (const hhId of doorIds.slice(eveningCount)) {
      if (minutes >= cutoff || stagedToday >= todayCap) break;
      const hh = hhById.get(hhId);
      knockDoor({ hh, canvasserId, ts: localTime(0, minutes, tz), passId: turf.passId, turfId: turf._id });
      todayKnocks += 1;
      stagedToday += 1;
      minutes += rng.int(2, 5);
    }
  }

  // A couple of same-round overlaps (different canvasser re-knocks) for the
  // overlaps card + the timeline's billing reconciliation line.
  const allCanvassers = [...new Set([...assignmentsByTurf.values()].map(String))];
  for (const o of overlapCandidates.slice(0, 3)) {
    const others = allCanvassers.filter((id) => id !== String(o.canvasserId));
    if (!others.length) break;
    activities.push(
      activityDoc({
        hh: o.hh,
        userId: rng.pick(others),
        actionType: 'not_home',
        ts: new Date(Math.min(o.ts.getTime() + rng.int(30, 90) * 60000, Date.now() - 60000)),
        passId: o.passId,
        turfId: o.turfId,
      })
    );
  }

  await CanvassActivity.insertMany(activities);
  for (const s of surveys) {
    // Mirrors the mobile submit: atomic upsert on the unique (voterId, passId) key.
    await SurveyResponse.findOneAndUpdate(s.filter, { $set: s.fields }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  // Recompute door state exactly the way the app maintains it.
  const touched = [...new Set(activities.map((a) => String(a.householdId)))];
  await recomputeHouseholdStatusesByIds(touched, campaign.type);
  const lastByDoor = new Map();
  for (const a of activities) {
    const prev = lastByDoor.get(String(a.householdId));
    if (!prev || a.timestamp > prev.timestamp) lastByDoor.set(String(a.householdId), a);
  }
  if (lastByDoor.size) {
    await Household.bulkWrite(
      [...lastByDoor.values()].map((a) => ({
        updateOne: { filter: { _id: a.householdId }, update: { $set: { lastActionAt: a.timestamp, lastActionBy: a.userId } } },
      }))
    );
  }
  if (surveys.length) {
    await Voter.updateMany(
      { _id: { $in: surveys.map((s) => s.filter.voterId) } },
      { $set: { surveyStatus: 'surveyed' } }
    );
  }

  return {
    org: org.name,
    campaign: campaign.name,
    wiped: { activities: wActs.deletedCount, surveys: wResp.deletedCount, flagReviews: wFlags.deletedCount },
    staged: { activities: activities.length, surveys: surveys.length, todayKnocks, books: stagedBooks.length },
  };
}
