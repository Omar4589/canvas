// Seed (or reset) the permanent Doorline demo environment: a fictional consulting
// org + campaign with ~1,100 fabricated households / ~2,500 fabricated voters placed
// along REAL Beaverdale (Des Moines, IA) streets, cut into books, assigned to demo
// canvassers, with six days of staged canvass history, early-vote drops, and one
// published client report + share link. Serves landing-page screenshots, Apple/Google
// app-review demo accounts, and live prospect demos.
//
// Usage (from server/):
//   node src/utils/seedDemoOrg.js                    # dry run — prints plan, writes nothing
//   node src/utils/seedDemoOrg.js --apply            # full build (idempotent)
//   node src/utils/seedDemoOrg.js --reset --apply    # wipe activity layer, restage fresh
//                                                    # (books/voters/accounts/share link survive)
// Full teardown (also purges the campaign's orphaned Persons):
//   npm run cleanup:test-campaigns -- --ids=<campaignId> --mock=<campaignId> --apply
//
// Env (server/.env): SEED_DEMO_ADMIN_EMAIL / SEED_DEMO_ADMIN_PASSWORD,
//   SEED_DEMO_CANVASSER_EMAIL / SEED_DEMO_CANVASSER_PASSWORD (both passwords required
//   for --apply), optional SEED_DEMO_SHARE_TOKEN (stable /r/<token> URL across reseeds).
//
// Identity safety: every stateVoterId is 'DEMO-IA-......' (real Iowa ids are numeric,
// so no collision with real data) and no vendor uid column is used, so the shared
// Person layer only ever gains clearly-marked, cleanly-orphanable demo people.
// ⚠️  Point MONGODB_URI carefully; for production, snapshot Atlas first.

import { config as loadEnv } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Organization } from '../models/Organization.js';
import { Membership } from '../models/Membership.js';
import { Campaign } from '../models/Campaign.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { Effort } from '../models/Effort.js';
import { EffortMember } from '../models/EffortMember.js';
import { Pass } from '../models/Pass.js';
import { Turf } from '../models/Turf.js';
import { TurfAssignment } from '../models/TurfAssignment.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { ImportJob } from '../models/ImportJob.js';
import { VotedUpload } from '../models/VotedUpload.js';
import { VotedVoter } from '../models/VotedVoter.js';
import { VotedPendingId } from '../models/VotedPendingId.js';
import { ClientReport } from '../models/ClientReport.js';
import { ClientReportMapPoint } from '../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../models/ReportShareLink.js';
import { buildImportRows } from '../services/import/csvImporter.js';
import { applyImport } from '../services/import/csvImporter.js';
import { DEFAULT_PROFILE_MAPPING } from '../services/import/canonicalFields.js';
import { reconcileIdentityFromImport } from '../services/person/reconcileIdentityFromImport.js';
import { recomputeCutAttributesForCampaign } from '../services/turf/computeCutAttributes.js';
import { createNextPass } from '../services/passes/createPass.js';
import { generateTurf } from '../services/turf/generateTurf.js';
import { ensureCampaignAssignments } from '../services/campaignRoster.js';
import { recomputeHouseholdStatusesByIds } from '../services/canvass/status.js';
import { recomputeFullyVoted } from '../services/voted/recomputeFullyVoted.js';
import { normalizeAndFilterAnswers } from '../services/surveys/normalizeAnswers.js';
import { computeWindowStats, buildFrozenMapPoints } from '../services/reports/computeReport.js';
import { zonedDayRange } from '../utils/timezone.js';
import { haversineMeters } from '../utils/normalizeAddress.js';
import { inStateBounds } from '../utils/stateBounds.js';
import {
  makeRng,
  FIRST_NAMES,
  LAST_NAMES,
  DEMO_ORG_NAME,
  DEMO_ORG_SLUG,
  DEMO_CAMPAIGN_NAME,
  DEMO_CANDIDATE,
  DEMO_CANVASSERS,
} from './demoData/namePools.js';

const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');

// Hide credentials but keep host/db visible so the operator can confirm the target.
function maskUri(uri) {
  if (!uri) return '(MONGODB_URI unset)';
  return uri.replace(/\/\/[^@/]+@/, '//***:***@');
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const RNG_SEED = 20260704; // fixed → identical dataset every run
const MAX_HOUSEHOLDS = 1150;
const BOOK_MAX_DOORS = 55;
const CAMPAIGN_TZ = 'America/Chicago';
const CAMPAIGN_STATE = 'IA';
const SVID_PREFIX = 'DEMO-IA-';
// Per-book completion fractions, cycled in book order; the reviewer's book is forced to 0.
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

const ADMIN_EMAIL = (process.env.SEED_DEMO_ADMIN_EMAIL || 'demo-admin@doorline.app').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.SEED_DEMO_ADMIN_PASSWORD;
const CANVASSER_EMAIL = (process.env.SEED_DEMO_CANVASSER_EMAIL || 'demo-canvasser@doorline.app').toLowerCase().trim();
const CANVASSER_PASSWORD = process.env.SEED_DEMO_CANVASSER_PASSWORD;

// ---------------------------------------------------------------------------
// Synthetic data generation (deterministic — same voters every run)
// ---------------------------------------------------------------------------

// Move `meters` along the bearing perpendicular to segment a→b, to `side` (+1/-1).
function offsetPoint([lng, lat], [lng2, lat2], meters, side) {
  const dLat = lat2 - lat;
  const dLng = (lng2 - lng) * Math.cos((lat * Math.PI) / 180);
  const len = Math.hypot(dLat, dLng) || 1e-9;
  // Unit normal (perpendicular), in degree-space corrected for latitude.
  const nLat = (-dLng / len) * side;
  const nLng = (dLat / len) * side;
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  return [lng + (nLng * meters) / mPerDegLng, lat + (nLat * meters) / mPerDegLat];
}

function generateHouseholds(rng) {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'demoData/demoStreets.json'), 'utf8')
  );
  const households = [];
  fixture.streets.forEach((street, streetIdx) => {
    if (households.length >= MAX_HOUSEHOLDS) return;
    // Plausible Des Moines block numbering: stable per street segment.
    let houseNumber = rng.int(26, 42) * 100 + rng.int(0, 12) * 2;
    const precinct = `Des Moines ${41 + (streetIdx % 4)}`;
    const zip = street.coords[0][1] > 41.608 ? '50310' : '50311';
    let side = 1;
    // Walk the polyline dropping a house every 16–26 m, alternating sides.
    for (let i = 1; i < street.coords.length; i += 1) {
      const a = street.coords[i - 1];
      const b = street.coords[i];
      const segMeters = haversineMeters(a[1], a[0], b[1], b[0]);
      let along = rng.int(8, 16);
      while (along < segMeters && households.length < MAX_HOUSEHOLDS) {
        const t = along / segMeters;
        const center = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const setback = rng.int(10, 14) + rng.next() * 3;
        const [lng, lat] = offsetPoint(center, b, setback, side);
        if (inStateBounds(CAMPAIGN_STATE, lat, lng) !== false) {
          households.push({
            addressLine1: `${houseNumber + (side > 0 ? 0 : 1)} ${street.name}`,
            city: 'Des Moines',
            state: CAMPAIGN_STATE,
            zip,
            county: 'Polk',
            precinct,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          });
        }
        houseNumber += 2;
        side = -side;
        // Houses alternate street sides, so ~11 m along = ~22 m between same-side neighbors.
        along += rng.int(9, 13);
      }
    }
  });
  return households;
}

function generateVoters(rng, households) {
  const voters = [];
  let svidSeq = 1;
  for (const hh of households) {
    const familyLast = rng.pick(LAST_NAMES);
    const count = rng.weighted([[1, 25], [2, 40], [3, 20], [4, 10], [5, 5]]);
    for (let i = 0; i < count; i += 1) {
      const birthYear = rng.int(1940, 2004);
      voters.push({
        svid: `${SVID_PREFIX}${String(svidSeq).padStart(6, '0')}`,
        firstName: rng.pick(FIRST_NAMES),
        lastName: rng.chance(0.8) ? familyLast : rng.pick(LAST_NAMES),
        party: rng.weighted([['Democratic', 40], ['Republican', 34], ['No Party', 23], ['Libertarian', 3]]),
        gender: rng.pick(['M', 'F']),
        dob: `${birthYear}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        phone: rng.chance(0.6) ? `(515) 555-${String(rng.int(0, 9999)).padStart(4, '0')}` : '',
        household: hh,
      });
      svidSeq += 1;
    }
  }
  return voters;
}

function buildCsv(voters) {
  const headers = [
    'State Voter ID', 'First Name', 'Last Name', 'Phone', 'Party', 'Gender',
    'Date of Birth', 'Registration Status', 'Registered State',
    'Official Congressional Districts', 'Official State Senate Districts',
    'Official State House District', 'Precinct', 'Address', 'Address Line 2',
    'City', 'Zip Code', 'County', 'p_Latitude', 'p_Longitude',
  ];
  const lines = [headers.join(',')];
  for (const v of voters) {
    lines.push([
      v.svid, v.firstName, v.lastName, v.phone, v.party, v.gender,
      v.dob, 'Active', CAMPAIGN_STATE, '3', '17', '34',
      v.household.precinct, v.household.addressLine1, '',
      v.household.city, v.household.zip, v.household.county,
      v.household.lat, v.household.lng,
    ].join(','));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Time helpers — all staged history is relative to "now" so the demo stays fresh.
// ---------------------------------------------------------------------------

// YYYY-MM-DD for (today + offsetDays) in the campaign timezone.
function dayStr(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPAIGN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// A Date at local `minutesAfterMidnight` on the campaign-tz day `offsetDays` from today.
function localTime(offsetDays, minutesAfterMidnight) {
  const day = dayStr(offsetDays);
  const midnightUtc = zonedDayRange(day, day, CAMPAIGN_TZ).$gte;
  return new Date(midnightUtc.getTime() + minutesAfterMidnight * 60000);
}

function jitterLocation(rng, hh) {
  const [lng, lat] = hh.location.coordinates;
  const meters = 4 + rng.next() * 12;
  const angle = rng.next() * Math.PI * 2;
  const dLat = (meters * Math.sin(angle)) / 111320;
  const dLng = (meters * Math.cos(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng, accuracy: rng.int(5, 20) };
}

function activityDoc({ hh, userId, actionType, ts, rng, passId, turfId, voterId = null, wasOffline = false }) {
  const loc = jitterLocation(rng, hh);
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

// ---------------------------------------------------------------------------
// Build steps
// ---------------------------------------------------------------------------

async function ensureUser({ email, password, firstName, lastName }) {
  let user = await User.findOne({ email });
  if (user) return { user, created: false };
  const passwordHash = await User.hashPassword(password);
  user = await User.create({
    firstName, lastName, email, passwordHash,
    isActive: true, mustChangePassword: false, // app-store reviewers must log straight in
  });
  return { user, created: true };
}

async function ensureMembership(userId, organizationId, role) {
  await Membership.findOneAndUpdate(
    { userId, organizationId },
    { $setOnInsert: { userId, organizationId, role, isActive: true, acknowledgedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

function surveyQuestions() {
  return [
    {
      key: 'candidate_support',
      label: `If the election were held today, would you support ${DEMO_CANDIDATE} for State House?`,
      type: 'single_choice',
      required: true,
      order: 0,
      options: [
        { id: 'strong_support', text: 'Strongly support', tag: 'Supporter', script: `That's great to hear — ${DEMO_CANDIDATE} appreciates your support!`, order: 0 },
        { id: 'lean_support', text: 'Lean support', tag: 'Supporter', order: 1 },
        { id: 'undecided', text: 'Undecided', order: 2 },
        { id: 'opposed', text: 'Opposed', order: 3 },
      ],
    },
    {
      key: 'top_issue',
      label: 'Which issues matter most to you this year?',
      type: 'multiple_choice',
      order: 1,
      options: [
        { id: 'public_schools', text: 'Public schools', order: 0 },
        { id: 'cost_of_living', text: 'Cost of living', order: 1 },
        { id: 'public_safety', text: 'Public safety', order: 2 },
        { id: 'healthcare', text: 'Healthcare', order: 3 },
        { id: 'roads_infrastructure', text: 'Roads & infrastructure', order: 4 },
      ],
    },
    {
      key: 'yard_sign',
      label: 'Would you like a yard sign?',
      type: 'single_choice',
      order: 2,
      visibleIf: {
        logic: 'any',
        rules: [{ questionKey: 'candidate_support', op: 'any_of', optionIds: ['strong_support', 'lean_support'] }],
      },
      options: [
        { id: 'yes', text: 'Yes', order: 0 },
        { id: 'no', text: 'No', order: 1 },
      ],
    },
  ];
}

async function stageCanvassHistory({ rng, campaign, template, pass, turfs, assignmentsByTurf, reviewerTurfId, votersByHousehold }) {
  const activities = [];
  const surveys = [];
  const overlapCandidates = [];
  const stagedBooks = turfs.filter((t) => String(t._id) !== String(reviewerTurfId));

  for (let b = 0; b < stagedBooks.length; b += 1) {
    const turf = stagedBooks[b];
    const canvasserId = assignmentsByTurf.get(String(turf._id));
    const fraction = BOOK_FRACTIONS[b % BOOK_FRACTIONS.length];
    const doorIds = turf.householdIds.map(String);
    const visitedCount = Math.round(doorIds.length * fraction);
    if (!visitedCount) continue;

    // Split this book's visited doors across 2–3 evening sessions in the last 6 days.
    const sessionCount = visitedCount > 25 ? 3 : 2;
    const perSession = Math.ceil(visitedCount / sessionCount);
    for (let s = 0; s < sessionCount; s += 1) {
      const dayOffset = -6 + ((b + s * 2) % 6); // spread books across the week
      let minutes = 16 * 60 + 30 + rng.int(0, 40); // ~4:30pm local start
      const doors = doorIds.slice(s * perSession, (s + 1) * perSession);
      for (const hhId of doors) {
        const hh = votersByHousehold.docs.get(hhId);
        if (!hh) continue;
        const ts = localTime(dayOffset, minutes);
        minutes += rng.int(2, 5);
        const outcome = rng.weighted(OUTCOME_WEIGHTS);
        const wasOffline = rng.chance(0.1);
        if (outcome === 'survey') {
          const voters = votersByHousehold.byId.get(hhId) || [];
          if (!voters.length) continue;
          const voter = voters[0];
          const support = rng.weighted(SUPPORT_WEIGHTS);
          const issues = [rng.pick(['public_schools', 'cost_of_living', 'public_safety', 'healthcare', 'roads_infrastructure'])];
          if (rng.chance(0.4)) issues.push(rng.pick(['cost_of_living', 'public_schools', 'healthcare']));
          const raw = [
            { questionKey: 'candidate_support', optionIds: [support] },
            { questionKey: 'top_issue', optionIds: [...new Set(issues)] },
            { questionKey: 'yard_sign', optionIds: [rng.chance(0.4) ? 'yes' : 'no'] },
          ];
          const answers = normalizeAndFilterAnswers(template, raw); // drops yard_sign when hidden
          const loc = jitterLocation(rng, hh);
          const [hLng, hLat] = hh.location.coordinates;
          surveys.push({
            filter: { voterId: voter._id, passId: pass._id },
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
              passId: pass._id,
              turfId: turf._id,
              effortId: hh.effortId,
              wasOfflineSubmission: wasOffline,
              editedBy: null,
              editedAt: null,
            },
          });
          activities.push(activityDoc({
            hh, userId: canvasserId, actionType: 'survey_submitted', ts, rng,
            passId: pass._id, turfId: turf._id, voterId: voter._id, wasOffline,
          }));
        } else {
          activities.push(activityDoc({
            hh, userId: canvasserId, actionType: outcome, ts, rng,
            passId: pass._id, turfId: turf._id, wasOffline,
          }));
          if (outcome === 'not_home' && overlapCandidates.length < 3 && b >= 1) {
            overlapCandidates.push({ hh, turf, ts, canvasserId });
          }
        }
      }
    }
  }

  // Overlaps: a second canvasser re-knocks 2–3 already-visited doors in the same
  // round (different userId, so the within-pass replace doesn't apply) — feeds the
  // overlaps view and the timeline's billing reconciliation line.
  for (const o of overlapCandidates) {
    const others = [...assignmentsByTurf.values()].filter((id) => String(id) !== String(o.canvasserId));
    if (!others.length) break;
    activities.push(activityDoc({
      hh: o.hh, userId: rng.pick(others), actionType: 'not_home',
      ts: new Date(o.ts.getTime() + rng.int(30, 90) * 60000), rng,
      passId: pass._id, turfId: o.turf._id,
    }));
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
  await Household.bulkWrite(
    [...lastByDoor.values()].map((a) => ({
      updateOne: {
        filter: { _id: a.householdId },
        update: { $set: { lastActionAt: a.timestamp, lastActionBy: a.userId } },
      },
    }))
  );
  const surveyedVoterIds = surveys.map((s) => s.filter.voterId);
  await Voter.updateMany({ _id: { $in: surveyedVoterIds } }, { $set: { surveyStatus: 'surveyed' } });

  return { activities: activities.length, surveys: surveys.length, overlaps: overlapCandidates.length };
}

async function stageEarlyVoting({ campaign, adminId, votersByHousehold, turfs, reviewerTurfId }) {
  // Pick 3 untouched doors from staged books so the "voted doors drop off" story shows.
  const candidates = [];
  for (const turf of turfs) {
    if (String(turf._id) === String(reviewerTurfId)) continue;
    for (const hhId of turf.householdIds.map(String)) {
      const hh = votersByHousehold.docs.get(hhId);
      if (hh && hh.status === 'unknocked' && (votersByHousehold.byId.get(hhId) || []).length) {
        candidates.push(hh);
        if (candidates.length >= 3) break;
      }
    }
    if (candidates.length >= 3) break;
  }
  const votedVoters = candidates.flatMap((hh) => votersByHousehold.byId.get(String(hh._id)) || []);
  const upload = await VotedUpload.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    fileName: 'county-early-vote-file.csv',
    uploadedBy: adminId,
    totalRows: votedVoters.length,
    alreadyVoted: 0,
    notFound: 0,
  });
  const votedAt = localTime(-2, 10 * 60);
  await VotedVoter.bulkWrite(
    votedVoters.map((v) => ({
      updateOne: {
        filter: { campaignId: campaign._id, voterId: v._id },
        update: {
          $setOnInsert: {
            organizationId: campaign.organizationId,
            campaignId: campaign._id,
            voterId: v._id,
            householdId: v.householdId,
            stateVoterId: v.stateVoterId,
            votedAt,
            uploadId: upload._id,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  const hhIds = [...new Set(votedVoters.map((v) => String(v.householdId)))];
  const { updated } = await recomputeFullyVoted(campaign._id, hhIds);
  await VotedUpload.updateOne({ _id: upload._id }, { $set: { matched: votedVoters.length, doorsDropped: updated } });
  return { voters: votedVoters.length, doorsDropped: updated };
}

async function publishClientReport({ campaign, template, adminId }) {
  const weekStart = dayStr(-7);
  const weekEnd = dayStr(-1);
  const range = zonedDayRange(weekStart, weekEnd, CAMPAIGN_TZ);
  const keys = template.questions
    .filter((q) => q.type === 'single_choice' || q.type === 'multiple_choice')
    .map((q) => q.key);
  const supportQuestionKey = 'candidate_support';

  const report = new ClientReport({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    campaignType: campaign.type,
    title: 'Weekly field report',
    weekStart,
    weekEnd,
    timeZone: CAMPAIGN_TZ,
    rangeStartUtc: range.$gte,
    rangeEndUtc: range.$lt,
    status: 'draft',
    supportQuestionKey,
    visibility: { visibleQuestionKeys: keys, mapAnswerKeys: keys, showMap: true },
    observations: [
      {
        heading: 'This week on the doors',
        body: 'Crews completed the first sweep through the north Beaverdale books. Support is strongest along the avenues; the undecided share is concentrated in the newer blocks south of Franklin. We are re-cutting follow-up books for undecided doors next week.',
      },
      {
        heading: 'What we heard',
        body: 'Cost of living and public schools continue to lead as top issues. Yard-sign uptake among supporters is running high — a sign install run is scheduled for the weekend.',
      },
    ],
    createdBy: adminId,
  });

  const base = { orgId: campaign.organizationId, campaignId: campaign._id, campaignType: campaign.type, template, supportQuestionKey };
  const [cumulative, period] = await Promise.all([
    computeWindowStats({ ...base, range: { $lt: report.rangeEndUtc } }),
    computeWindowStats({ ...base, range: { $gte: report.rangeStartUtc, $lt: report.rangeEndUtc } }),
  ]);
  report.stats = { cumulative, period };
  report.markModified('stats');
  await report.save();

  // Publish sequence, mirroring routes/admin/clientReports.js.
  const { points, coverage, count } = await buildFrozenMapPoints({
    report, campaign, mapAnswerKeys: report.visibility?.mapAnswerKeys || [],
  });
  await ClientReportMapPoint.deleteMany({ clientReportId: report._id });
  if (points.length) await ClientReportMapPoint.insertMany(points);
  report.stats.cumulative.coverage = coverage;
  report.markModified('stats');
  report.mapPointCount = count;
  report.status = 'published';
  report.publishedAt = new Date();
  report.publishedBy = adminId;
  await report.save();
  return report;
}

async function ensureShareLink({ campaign, adminId }) {
  let share = await ReportShareLink.findOne({ campaignId: campaign._id, isActive: true });
  if (share) return share;
  share = await ReportShareLink.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    token: process.env.SEED_DEMO_SHARE_TOKEN || randomBytes(24).toString('base64url'),
    label: 'Client demo link',
    passwordHash: null,
    createdBy: adminId,
  });
  return share;
}

async function resetActivityLayer(campaign) {
  const campaignId = campaign._id;
  const [acts, resp, voted, uploads, pending] = await Promise.all([
    CanvassActivity.deleteMany({ campaignId }),
    SurveyResponse.deleteMany({ campaignId }),
    VotedVoter.deleteMany({ campaignId }),
    VotedUpload.deleteMany({ campaignId }),
    VotedPendingId.deleteMany({ campaignId }),
  ]);
  const reports = await ClientReport.find({ campaignId }, '_id').lean();
  await ClientReportMapPoint.deleteMany({ clientReportId: { $in: reports.map((r) => r._id) } });
  await ClientReport.deleteMany({ campaignId });
  await Household.updateMany(
    { campaignId },
    { $set: { status: 'unknocked', fullyVoted: false, lastActionAt: null, lastActionBy: null } }
  );
  const voterIds = await Voter.distinct('_id', { organizationId: campaign.organizationId });
  await Voter.updateMany({ _id: { $in: voterIds } }, { $set: { surveyStatus: 'not_surveyed' } });
  console.log(
    `  wiped: ${acts.deletedCount} activities · ${resp.deletedCount} surveys · ${voted.deletedCount} voted marks · ${uploads.deletedCount} uploads · ${pending.deletedCount} pending ids · ${reports.length} report(s)`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`mode: ${APPLY ? (RESET ? 'RESET + APPLY (activity layer restaged)' : 'APPLY (writes WILL happen)') : 'DRY RUN (no writes)'}`);
  console.log(`DB:   ${maskUri(process.env.MONGODB_URI)}`);
  if (!/127\.0\.0\.1|localhost/.test(process.env.MONGODB_URI || '')) {
    console.log('⚠️  Non-local database — for production, take an Atlas snapshot first.');
  }

  const rng = makeRng(RNG_SEED);
  const plannedHouseholds = generateHouseholds(rng);
  const plannedVoters = generateVoters(rng, plannedHouseholds);
  console.log(`\nplan: org '${DEMO_ORG_NAME}' (${DEMO_ORG_SLUG}) · campaign '${DEMO_CAMPAIGN_NAME}'`);
  console.log(`  ${plannedHouseholds.length} households · ${plannedVoters.length} voters along ${new Set(plannedHouseholds.map((h) => h.addressLine1.split(' ').slice(1).join(' '))).size} real Beaverdale streets`);
  console.log(`  accounts: admin ${ADMIN_EMAIL} · canvasser ${CANVASSER_EMAIL} · ${DEMO_CANVASSERS.length} background canvassers`);

  await connectDb(process.env.MONGODB_URI);

  const existingOrg = await Organization.findOne({ slug: DEMO_ORG_SLUG });
  const existingCampaign = existingOrg
    ? await Campaign.findOne({ organizationId: existingOrg._id, name: DEMO_CAMPAIGN_NAME })
    : null;
  console.log(`  exists: org=${existingOrg ? existingOrg._id : 'no'} · campaign=${existingCampaign ? existingCampaign._id : 'no'}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to build (add --reset to restage activity).');
    await mongoose.disconnect();
    return;
  }
  if (!ADMIN_PASSWORD || !CANVASSER_PASSWORD) {
    console.error('SEED_DEMO_ADMIN_PASSWORD and SEED_DEMO_CANVASSER_PASSWORD are required for --apply.');
    process.exit(1);
  }

  // 1. Org + users -----------------------------------------------------------
  const org =
    existingOrg ||
    (await Organization.create({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, timeZone: CAMPAIGN_TZ }));
  const { user: admin } = await ensureUser({
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, firstName: 'Dana', lastName: 'Whitfield',
  });
  const { user: reviewer } = await ensureUser({
    email: CANVASSER_EMAIL, password: CANVASSER_PASSWORD, firstName: 'Sam', lastName: 'Reyes',
  });
  const background = [];
  for (const c of DEMO_CANVASSERS) {
    const email = `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@demo.doorline.app`;
    const { user } = await ensureUser({
      email, password: randomBytes(18).toString('base64url'), firstName: c.firstName, lastName: c.lastName,
    });
    background.push(user);
  }
  await ensureMembership(admin._id, org._id, 'admin');
  for (const u of [reviewer, ...background]) await ensureMembership(u._id, org._id, 'canvasser');
  console.log(`\n1. org ${org._id} · admin ${admin.email} · ${1 + background.length} canvassers`);

  // 2. Campaign + 3. survey template ----------------------------------------
  let campaign =
    existingCampaign ||
    (await Campaign.create({
      organizationId: org._id, name: DEMO_CAMPAIGN_NAME, type: 'survey',
      state: CAMPAIGN_STATE, timeZone: CAMPAIGN_TZ, createdBy: admin._id,
    }));
  let template = await SurveyTemplate.findOne({ organizationId: org._id, name: 'Voter ID & persuasion' });
  if (!template) {
    template = await SurveyTemplate.create({
      organizationId: org._id,
      name: 'Voter ID & persuasion',
      isActive: true,
      intro: `Hi, my name is {{canvasser}} — I'm a volunteer with ${DEMO_CANDIDATE}'s campaign for State House. Do you have a quick minute?`,
      closing: 'Thanks so much for your time — have a great evening!',
      questions: surveyQuestions(),
      tags: ['Supporter'],
      createdBy: admin._id,
    });
  }
  if (!campaign.surveyTemplateId) {
    campaign.surveyTemplateId = template._id; // must be set before a round can activate
    await campaign.save();
  }
  console.log(`2. campaign ${campaign._id} ('${campaign.name}', ${campaign.type}, ${campaign.timeZone})`);
  console.log(`3. survey template ${template._id} (${template.questions.length} questions)`);

  if (RESET) {
    console.log('\nreset: wiping activity layer (voters/books/accounts/share link survive)');
    await resetActivityLayer(campaign);
  }

  // 4. Import voters through the real pipeline -------------------------------
  const voterCount = await Voter.countDocuments({ organizationId: org._id });
  if (voterCount >= plannedVoters.length) {
    console.log(`4. import: skipped (${voterCount} voters already present)`);
  } else {
    const csv = buildCsv(plannedVoters);
    const built = await buildImportRows(Buffer.from(csv, 'utf8'), 'demo-voters.csv', DEFAULT_PROFILE_MAPPING);
    if (built.errors.length) {
      console.error(`import produced ${built.errors.length} row errors — first: ${JSON.stringify(built.errors[0])}`);
      process.exit(1);
    }
    // Order is load-bearing: reconcile stamps personId onto rows BEFORE applyImport persists them.
    await reconcileIdentityFromImport(built.validRows, { orgId: org._id, uidSource: null });
    const counts = await applyImport({ campaign, orgId: org._id, validRows: built.validRows, householdMap: built.householdMap });
    await recomputeCutAttributesForCampaign(campaign._id);
    await ImportJob.create({
      organizationId: org._id, campaignId: campaign._id,
      filename: 'demo-voters.csv', uploadedBy: admin._id,
      status: 'completed', kind: 'apply',
      totalRows: built.totalRows, processedRows: built.totalRows, progress: 100,
      uniqueVoters: counts.uniqueVoters, uniqueHouseholds: counts.uniqueHouseholds,
      newVoters: counts.newVoters, updatedVoters: counts.updatedVoters, newHouseholds: counts.newHouseholds,
      duplicateStateVoterIds: Array.from(built.dupSvids),
      errors: [], errorCount: 0,
      insertedHouseholdIds: counts.insertedHouseholdIds, insertedVoterIds: counts.insertedVoterIds,
      fieldMapping: DEFAULT_PROFILE_MAPPING, explode: true, uidSource: null,
      startedAt: new Date(), completedAt: new Date(),
    });
    console.log(`4. imported ${counts.newVoters} voters / ${counts.newHouseholds} households (persons linked)`);
  }

  // 5. Effort + pass ----------------------------------------------------------
  let effort = await Effort.findOne({ campaignId: campaign._id, name: 'Beaverdale' });
  if (!effort) {
    effort = await Effort.create({
      organizationId: org._id, campaignId: campaign._id, name: 'Beaverdale',
      surveyTemplateId: null, seededFromWalkListId: null, status: 'active', createdBy: admin._id,
    });
  }
  const claimed = await Household.updateMany(
    { campaignId: campaign._id, isActive: true, effortId: null },
    { $set: { effortId: effort._id } }
  );
  let pass = await Pass.findOne({ effortId: effort._id }).sort({ roundNumber: -1 });
  if (!pass) {
    pass = await createNextPass({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId: admin._id });
    if (!pass) { console.error('createNextPass failed'); process.exit(1); }
  }
  console.log(`5. effort '${effort.name}' · claimed ${claimed.modifiedCount} intake doors · ${pass.name} (${pass.status})`);

  // 6. Cut + publish books ----------------------------------------------------
  let published = await Turf.countDocuments({ passId: pass._id, status: 'published' });
  if (!published) {
    const { bookCount } = await generateTurf({
      campaignId: campaign._id, passId: pass._id, mode: 'geometric', params: { maxDoors: BOOK_MAX_DOORS },
    });
    const accepted = await Turf.updateMany(
      { campaignId: campaign._id, passId: pass._id, status: 'draft' },
      { $set: { status: 'published' } }
    );
    published = accepted.modifiedCount;
    console.log(`6. cut ${bookCount} books · published ${published}`);
  } else {
    console.log(`6. books: skipped (${published} already published)`);
  }

  // 7. Assign books (reviewer gets the last book, kept clean for app review) --
  const turfs = await Turf.find({ passId: pass._id, status: 'published' }).sort({ name: 1 });
  const reviewerTurf = turfs[turfs.length - 1];
  const assignmentsByTurf = new Map();
  for (let i = 0; i < turfs.length; i += 1) {
    const turf = turfs[i];
    const user = String(turf._id) === String(reviewerTurf._id) ? reviewer : background[i % background.length];
    assignmentsByTurf.set(String(turf._id), user._id);
    await TurfAssignment.findOneAndUpdate(
      { turfId: turf._id, userId: user._id },
      { $setOnInsert: { organizationId: org._id, campaignId: campaign._id, passId: turf.passId, assignedBy: admin._id, assignedAt: new Date() } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  const crewIds = [reviewer._id, ...background.map((u) => u._id)];
  await ensureCampaignAssignments(campaign._id, crewIds, org._id, admin._id); // positional args
  for (const userId of crewIds) {
    await EffortMember.findOneAndUpdate(
      { effortId: effort._id, userId },
      { $setOnInsert: { organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId, addedBy: admin._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`7. assigned ${turfs.length} books · reviewer book '${reviewerTurf.name}' → ${reviewer.email}`);

  // Activate the round (mirrors routes/admin/passes.js invariants).
  if (pass.status !== 'active') {
    await Pass.updateMany(
      { campaignId: campaign._id, effortId: pass.effortId, status: 'active', _id: { $ne: pass._id } },
      { $set: { status: 'archived', archivedAt: new Date() } }
    );
    pass.status = 'active';
    if (!pass.activatedAt) pass.activatedAt = localTime(-7, 9 * 60); // before all staged knocks
    await pass.save();
    console.log(`   round activated (${pass.name})`);
  }

  // 8. Staged canvass history --------------------------------------------------
  const activityCount = await CanvassActivity.countDocuments({ campaignId: campaign._id });
  if (activityCount > 0) {
    console.log(`8. history: skipped (${activityCount} activities exist — use --reset --apply to restage)`);
  } else {
    const hhDocs = await Household.find({ campaignId: campaign._id, isActive: true });
    const voterDocs = await Voter.find({ organizationId: org._id, householdId: { $in: hhDocs.map((h) => h._id) } });
    const votersByHousehold = { docs: new Map(), byId: new Map() };
    for (const h of hhDocs) votersByHousehold.docs.set(String(h._id), h);
    for (const v of voterDocs) {
      const k = String(v.householdId);
      if (!votersByHousehold.byId.has(k)) votersByHousehold.byId.set(k, []);
      votersByHousehold.byId.get(k).push(v);
    }
    const staged = await stageCanvassHistory({
      rng: makeRng(RNG_SEED + 1), campaign, template, pass, turfs,
      assignmentsByTurf, reviewerTurfId: reviewerTurf._id, votersByHousehold,
    });
    console.log(`8. staged ${staged.activities} activities · ${staged.surveys} surveys · ${staged.overlaps} overlap doors`);

    // 9. Early voting ----------------------------------------------------------
    for (const h of await Household.find({ campaignId: campaign._id, isActive: true }, 'status')) {
      votersByHousehold.docs.get(String(h._id)).status = h.status; // refresh post-recompute
    }
    const voted = await stageEarlyVoting({
      campaign, adminId: admin._id, votersByHousehold, turfs, reviewerTurfId: reviewerTurf._id,
    });
    console.log(`9. early voting: ${voted.voters} voters marked · ${voted.doorsDropped} doors dropped`);

    // 10. Client report + share link -------------------------------------------
    const report = await publishClientReport({ campaign, template: template.toObject(), adminId: admin._id });
    console.log(`10. published client report '${report.title}' (${report.weekStart} → ${report.weekEnd}, ${report.mapPointCount} map points)`);
  }
  const share = await ensureShareLink({ campaign, adminId: admin._id });

  // Summary --------------------------------------------------------------------
  const [hh, vv, tt, aa, ss] = await Promise.all([
    Household.countDocuments({ campaignId: campaign._id }),
    Voter.countDocuments({ organizationId: org._id }),
    Turf.countDocuments({ passId: pass._id, status: 'published' }),
    CanvassActivity.countDocuments({ campaignId: campaign._id }),
    SurveyResponse.countDocuments({ campaignId: campaign._id }),
  ]);
  console.log('\n────────────────────────────────────────────');
  console.log(`Demo ready: '${DEMO_ORG_NAME}' / '${DEMO_CAMPAIGN_NAME}'`);
  console.log(`  campaignId: ${campaign._id}`);
  console.log(`  ${hh} doors · ${vv} voters · ${tt} books · ${aa} activities · ${ss} surveys`);
  console.log(`  admin login:     ${admin.email}  (SEED_DEMO_ADMIN_PASSWORD)`);
  console.log(`  canvasser login: ${reviewer.email}  (SEED_DEMO_CANVASSER_PASSWORD) — book '${reviewerTurf.name}' is clean for reviewers`);
  console.log(`  client portal:   /r/${share.token}`);
  console.log(`  restage after reviewers knock: node src/utils/seedDemoOrg.js --reset --apply`);
  console.log(`  full teardown:   npm run cleanup:test-campaigns -- --ids=${campaign._id} --mock=${campaign._id} --apply`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
