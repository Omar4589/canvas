// Seed (or reset) the permanent Doorline demo environment: a fictional consulting
// org + campaign of ~1,145 households on REAL Des Moines (Beaverdale/Drake) addresses
// with ~2,600 fabricated voters, cut into books, assigned to demo canvassers, with
// staged canvass history, early-vote drops, and one published report + share link.
// Serves landing-page screenshots, Apple/Google app-review demo accounts, and live
// prospect demos. Addresses/coordinates are real (from demoAddresses.json); every
// voter identity is fabricated.
//
// Usage (from server/):
//   node src/utils/seedDemoOrg.js                    # dry run — prints plan, writes nothing
//   node src/utils/seedDemoOrg.js --apply            # full build (idempotent)
//   node src/utils/seedDemoOrg.js --reset --apply    # wipe activity layer, restage fresh
//                                                    # (households/books/accounts/share link survive)
//   node src/utils/seedDemoOrg.js --rebuild --apply  # WIPE the campaign (doors, voters,
//                                                    # books, history) and rebuild from
//                                                    # scratch — use after the address set
//                                                    # changes (org + users survive)
// Full teardown (also purges the campaign's orphaned Persons):
//   npm run cleanup:test-campaigns -- --ids=<campaignId> --mock=<campaignId> --apply
//
// APP-REVIEW LOGINS. All four env vars are COMMA-SEPARATED lists, and the passwords line up
//   positionally with the emails — so Apple and Google can hold different credentials:
//
//     SEED_DEMO_ADMIN_EMAIL=apple@review.com,android@review.com
//     SEED_DEMO_ADMIN_PASSWORD=ApplePw1!,GooglePw2!
//     SEED_DEMO_CANVASSER_EMAIL=apple-delete@review.com,android-delete@review.com
//     SEED_DEMO_CANVASSER_PASSWORD=ApplePw3!,GooglePw4!
//
//   One password with several emails is fine (everybody shares it). A count that is neither 1
//   nor N is a typo and exits loudly. Re-running --apply syncs a changed password onto an
//   existing account, so rotating a credential is just an env change + a re-run.
//
//   ADMINS are deletion-LOCKED (they're the keys to the tenant; a reviewer pressing "Delete my
//   account" must not be able to destroy them). The CANVASSER accounts are deliberately NOT
//   locked — a reviewer has to be able to complete a deletion somewhere, or they fail you for
//   "unable to verify account deletion". Re-running this seeder recreates one after it's deleted.
//
//   Every review login gets its own clean, unwalked reserved book (isReviewerBook).
//   Defaults: demo-admin@doorline.app / admin1234! and demo-canvasser@doorline.app / Victory26!
//   Optional SEED_DEMO_SHARE_TOKEN pins the /r/<token> URL.
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
import { Subscription } from '../models/Subscription.js';
import { VotedPendingId } from '../models/VotedPendingId.js';
import { ClientReport } from '../models/ClientReport.js';
import { ClientReportMapPoint } from '../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../models/ReportShareLink.js';
import { Person } from '../models/Person.js';
import { PersonMergeCandidate } from '../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../models/PersonEditProposal.js';
import { PersonMergeLog } from '../models/PersonMergeLog.js';
import { deleteCampaignCascade } from '../services/campaigns/deleteCampaign.js';
import { buildImportRows } from '../services/import/csvImporter.js';
import { applyImport } from '../services/import/csvImporter.js';
import { DEFAULT_PROFILE_MAPPING } from '../services/import/canonicalFields.js';
import { reconcileIdentityFromImport } from '../services/person/reconcileIdentityFromImport.js';
import { recomputeCutAttributesForCampaign } from '../services/turf/computeCutAttributes.js';
import { createNextPass } from '../services/passes/createPass.js';
import { generateTurf } from '../services/turf/generateTurf.js';
import { ensureCampaignAssignments } from '../services/campaignRoster.js';
import { recomputeFullyVoted } from '../services/voted/recomputeFullyVoted.js';
import { computeWindowStats, buildFrozenMapPoints } from '../services/reports/computeReport.js';
import { zonedDayRange } from '../utils/timezone.js';
import { stageDemoActivity, persistDemoActivity } from '../services/platform/demoActivity.js';
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
// Full teardown of the existing demo campaign (doors, voters, books, history, report)
// before rebuilding — needed when the addresses themselves change and turf must re-cut.
// Keeps the org + user accounts. Set SEED_DEMO_SHARE_TOKEN to keep the /r/<token> URL.
const REBUILD = process.argv.includes('--rebuild');

// Hide credentials but keep host/db visible so the operator can confirm the target.
function maskUri(uri) {
  if (!uri) return '(MONGODB_URI unset)';
  return uri.replace(/\/\/[^@/]+@/, '//***:***@');
}

// Delete the canonical Persons this demo created that have no remaining linked voters
// (mirrors deleteTestCampaigns.js purgeOrphanedPersons — kept local because that CLI
// self-executes main() on import). Persons still linked to a real org are left alone.
async function purgeOrphanedDemoPersons(personIds) {
  let purged = 0;
  for (const pid of personIds) {
    if ((await Voter.countDocuments({ personId: pid })) > 0) continue;
    await Person.deleteOne({ _id: pid });
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: pid }, { personIdB: pid }] });
    await PersonEditProposal.deleteMany({ personId: pid });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: pid }, { victimId: pid }] });
    purged += 1;
  }
  return purged;
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
const emailList = (raw, fallback) => [...new Set(
  (raw || fallback).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
)];

// App-review logins, one set per store (Apple, Google, …). Both vars are comma-separated;
// a single value keeps the old behavior.
//
//   SEED_DEMO_ADMIN_EMAIL=apple@review.com,android@review.com
//   SEED_DEMO_CANVASSER_EMAIL=apple-delete@review.com,android-delete@review.com
//
// EVERY review login gets its own clean, unwalked reserved book — admins included. An admin can
// switch into canvass mode, and a reviewer who lands on an empty book list will (rightly) report
// that they couldn't see the app do anything. Reserving books only for the canvasser accounts
// left the admin logins — the ones actually handed to Apple and Google — staring at nothing.
const ADMIN_EMAILS = emailList(process.env.SEED_DEMO_ADMIN_EMAIL, 'demo-admin@doorline.app');
const REVIEWER_EMAILS = emailList(process.env.SEED_DEMO_CANVASSER_EMAIL, 'demo-canvasser@doorline.app');
const ADMIN_EMAIL = ADMIN_EMAILS[0]; // the org's owner: assignedBy / addedBy on seeded rows

// Passwords line up POSITIONALLY with the emails above, so Apple and Google can hold different
// credentials — a leak on one store's portal doesn't hand anyone the other's login:
//
//   SEED_DEMO_ADMIN_EMAIL=apple@review.com,android@review.com
//   SEED_DEMO_ADMIN_PASSWORD=ApplePw1!,GooglePw2!      ← apple gets the 1st, android the 2nd
//
// One password with several emails is still fine — everybody shares it. Anything in between (2
// passwords for 3 emails) is a typo, and we'd rather fail loudly than silently seed an account
// with a password you don't have.
function passwordList(raw, fallback, emails, varName) {
  const parts = (raw || fallback).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return emails.map(() => parts[0]);
  if (parts.length === emails.length) return parts;
  console.error(
    `${varName} has ${parts.length} password(s) but there are ${emails.length} email(s). ` +
      `Give exactly one (shared by all) or one per email, in the same order.`
  );
  process.exit(1);
}
const ADMIN_PASSWORDS = passwordList(
  process.env.SEED_DEMO_ADMIN_PASSWORD, 'admin1234!', ADMIN_EMAILS, 'SEED_DEMO_ADMIN_PASSWORD'
);
const CANVASSER_PASSWORDS = passwordList(
  process.env.SEED_DEMO_CANVASSER_PASSWORD, 'Victory26!', REVIEWER_EMAILS, 'SEED_DEMO_CANVASSER_PASSWORD'
);

// A friendly display name for a NEW review account, derived from its email
// (apple@review.com → "Apple Review"). Existing accounts keep their current name.
function reviewerName(email) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const first = local ? local.charAt(0).toUpperCase() + local.slice(1) : 'App';
  return { firstName: first, lastName: 'Review' };
}

function adminName(email) {
  // Keep the original demo persona for the default account; derive a name for review logins.
  return email === 'demo-admin@doorline.app'
    ? { firstName: 'Dana', lastName: 'Whitfield' }
    : reviewerName(email);
}

// ---------------------------------------------------------------------------
// Household generation — REAL addresses (real rooftops on real streets, from the
// demoAddresses.json fixture), with fabricated voters attached at seed time. Only
// the address + coordinates are real; every voter identity is synthetic.
// ---------------------------------------------------------------------------
function generateHouseholds(rng) {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'demoData/demoAddresses.json'), 'utf8')
  );
  const households = [];
  // Group precincts by street so a whole street shares one precinct (realistic).
  const precinctByStreet = new Map();
  for (const addr of fixture.addresses) {
    if (households.length >= MAX_HOUSEHOLDS) break;
    // Belt-and-suspenders: real IA coords always pass, but keep the guard.
    if (inStateBounds(CAMPAIGN_STATE, addr.lat, addr.lng) === false) continue;
    if (!precinctByStreet.has(addr.street)) {
      precinctByStreet.set(addr.street, `Des Moines ${41 + (precinctByStreet.size % 4)}`);
    }
    households.push({
      addressLine1: `${addr.housenumber} ${addr.street}`,
      city: addr.city || 'Des Moines',
      state: CAMPAIGN_STATE,
      // Real postcode when OSM had one, else split north/south (cosmetic only).
      zip: addr.zip || (addr.lat > 41.61 ? '50310' : '50311'),
      county: 'Polk',
      precinct: precinctByStreet.get(addr.street),
      lat: addr.lat,
      lng: addr.lng,
    });
  }
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
  // Quote every field (RFC-4180) so a stray comma in real address data can't shift columns.
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (arr) => arr.map(cell).join(',');
  const lines = [row(headers)];
  for (const v of voters) {
    lines.push(row([
      v.svid, v.firstName, v.lastName, v.phone, v.party, v.gender,
      v.dob, 'Active', CAMPAIGN_STATE, '3', '17', '34',
      v.household.precinct, v.household.addressLine1, '',
      v.household.city, v.household.zip, v.household.county,
      v.household.lat, v.household.lng,
    ]));
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

// ---------------------------------------------------------------------------
// Build steps
// ---------------------------------------------------------------------------

// Passwords are optional: without one the account is created with a random
// unusable password (it only exists so knocks/books have someone to attribute to).
// When an env password IS provided, it is synced onto an existing account too, so
// setting SEED_DEMO_*_PASSWORD later and re-running enables (or rotates) the login.
async function ensureUser({ email, password, firstName, lastName, syncPassword = false }) {
  let user = await User.findOne({ email });
  if (user) {
    if (password && syncPassword) {
      user.passwordHash = await User.hashPassword(password);
      user.mustChangePassword = false;
      await user.save();
    }
    return { user, created: false };
  }
  const passwordHash = await User.hashPassword(password || randomBytes(18).toString('base64url'));
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

// Modeled on a real door-to-door canvass survey: a support ask, a multi-select
// top-issue question, and an action-style yard-sign question shown only to
// supporters. Option `id`s are stable (reports/tags join on them); the support
// ids stay strong_support/lean_support but DISPLAY as "Support"/"Likely Support".
function surveyQuestions() {
  return [
    {
      key: 'candidate_support',
      label: `Can we count on your support for ${DEMO_CANDIDATE} for State House?`,
      type: 'single_choice',
      required: true,
      order: 0,
      options: [
        { id: 'strong_support', text: 'Support', tag: 'Supporter', script: `That's great to hear — ${DEMO_CANDIDATE} appreciates your support!`, order: 0 },
        { id: 'lean_support', text: 'Likely Support', tag: 'Supporter', order: 1 },
        { id: 'undecided', text: 'Undecided', order: 2 },
        { id: 'opposed', text: 'Opposed', order: 3 },
      ],
    },
    {
      key: 'top_issue',
      label: 'What is your top issue?',
      type: 'multiple_choice',
      order: 1,
      options: [
        { id: 'healthcare', text: 'Healthcare costs', order: 0 },
        { id: 'public_schools', text: 'Public schools & education', order: 1 },
        { id: 'cost_of_living', text: 'Cost of living', order: 2 },
        { id: 'public_safety', text: 'Public safety & law enforcement', order: 3 },
        { id: 'water_environment', text: 'Water quality & environment', order: 4 },
        { id: 'property_taxes', text: 'Property taxes', order: 5 },
        { id: 'roads_infrastructure', text: 'Roads & infrastructure', order: 6 },
      ],
    },
    {
      key: 'yard_sign',
      label: 'Could you help us by taking a yard sign?',
      type: 'multiple_choice',
      order: 2,
      visibleIf: {
        logic: 'any',
        rules: [{ questionKey: 'candidate_support', op: 'any_of', optionIds: ['strong_support', 'lean_support'] }],
      },
      options: [
        { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', order: 0 },
        { id: 'candidate_follow_up', text: 'Candidate Follow-Up', order: 1 },
        { id: 'volunteer_request', text: 'Volunteer Request', order: 2 },
      ],
    },
  ];
}

// Thin wrapper over the shared demo-activity generator (services/platform/demoActivity)
// — the SAME code the "Refresh demo day" button uses, so the seeded dashboard and a
// refreshed one look identical (per-canvasser scheduling, ~22% connection rate,
// realistic answers). The reviewer's book is excluded structurally by turf id.
async function stageCanvassHistory({ rng, campaign, template, turfs, assignmentsByTurf, reviewerTurfIds, votersByHousehold }) {
  const stagedBooks = turfs.filter((t) => !reviewerTurfIds.has(String(t._id)));
  const { activities, surveys, overlaps, todayKnocks } = stageDemoActivity({
    rng, campaign, template, tz: CAMPAIGN_TZ, stagedBooks, assignmentsByTurf,
    hhById: votersByHousehold.docs, votersByHousehold: votersByHousehold.byId,
  });
  await persistDemoActivity({ campaign, activities, surveys });
  return { activities: activities.length, surveys: surveys.length, overlaps, todayKnocks };
}

async function stageEarlyVoting({ campaign, adminId, votersByHousehold, turfs, reviewerTurfIds }) {
  // Pick 3 untouched doors from staged books so the "voted doors drop off" story shows.
  const candidates = [];
  for (const turf of turfs) {
    if (reviewerTurfIds.has(String(turf._id))) continue;
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
  // The demo link follows the same rules as every real link — password + expiry — because the
  // privacy policy speaks about links as a CLASS ('report links are protected by a password'),
  // and this seeder was the one remaining code path that minted an open, never-expiring link.
  // The data behind it is synthetic, but a class statement admits no exceptions. Password comes
  // from SEED_DEMO_SHARE_PASSWORD (so reviewers/demos get a stable one) or is generated and
  // printed once. Expiry refreshes on every demo reset, so the link never dies mid-demo.
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  let share = await ReportShareLink.findOne({ campaignId: campaign._id, isActive: true });
  if (share) {
    const patch = { expiresAt };
    if (!share.passwordHash) {
      const pw = process.env.SEED_DEMO_SHARE_PASSWORD || randomBytes(9).toString('base64url');
      patch.passwordHash = await bcrypt.hash(pw, 10);
      console.log(`  · demo share link upgraded: password ${process.env.SEED_DEMO_SHARE_PASSWORD ? 'from SEED_DEMO_SHARE_PASSWORD' : `generated → ${pw} (save it now — it is not shown again)`}`);
    }
    await ReportShareLink.updateOne({ _id: share._id }, { $set: patch });
    return share;
  }
  const pw = process.env.SEED_DEMO_SHARE_PASSWORD || randomBytes(9).toString('base64url');
  if (!process.env.SEED_DEMO_SHARE_PASSWORD) {
    console.log(`  · demo share link password generated → ${pw} (save it now — it is not shown again)`);
  }
  share = await ReportShareLink.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    token: process.env.SEED_DEMO_SHARE_TOKEN || randomBytes(24).toString('base64url'),
    label: 'Client demo link',
    passwordHash: await bcrypt.hash(pw, 10),
    expiresAt,
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
  const modeLabel = !APPLY
    ? 'DRY RUN (no writes)'
    : REBUILD
      ? 'REBUILD + APPLY (existing demo campaign wiped, then rebuilt)'
      : RESET
        ? 'RESET + APPLY (activity layer restaged)'
        : 'APPLY (writes WILL happen)';
  console.log(`mode: ${modeLabel}`);
  console.log(`DB:   ${maskUri(process.env.MONGODB_URI)}`);
  if (!/127\.0\.0\.1|localhost/.test(process.env.MONGODB_URI || '')) {
    console.log('⚠️  Non-local database — for production, take an Atlas snapshot first.');
  }

  const rng = makeRng(RNG_SEED);
  const plannedHouseholds = generateHouseholds(rng);
  const plannedVoters = generateVoters(rng, plannedHouseholds);
  console.log(`\nplan: org '${DEMO_ORG_NAME}' (${DEMO_ORG_SLUG}) · campaign '${DEMO_CAMPAIGN_NAME}'`);
  console.log(`  ${plannedHouseholds.length} households · ${plannedVoters.length} voters on ${new Set(plannedHouseholds.map((h) => h.precinct)).size} precincts of real Des Moines addresses`);
  console.log(`  accounts: admin(s) ${ADMIN_EMAILS.join(', ')} · review canvasser(s) ${REVIEWER_EMAILS.join(', ')} · ${DEMO_CANVASSERS.length} field canvassers`);

  await connectDb(process.env.MONGODB_URI);

  const existingOrg = await Organization.findOne({ slug: DEMO_ORG_SLUG });
  let existingCampaign = existingOrg
    ? await Campaign.findOne({ organizationId: existingOrg._id, name: DEMO_CAMPAIGN_NAME })
    : null;
  console.log(`  exists: org=${existingOrg ? existingOrg._id : 'no'} · campaign=${existingCampaign ? existingCampaign._id : 'no'}`);

  if (!APPLY) {
    const next = REBUILD
      ? 're-run with --rebuild --apply to WIPE the existing demo campaign and rebuild it'
      : 're-run with --apply to build (add --reset to restage activity, or --rebuild to wipe + rebuild)';
    console.log(`\nDry run — ${next}.`);
    await mongoose.disconnect();
    return;
  }

  // --rebuild: hard-delete the existing demo campaign (cascade) + purge the fake
  // Persons it created, then fall through to a fresh build. Org + users survive.
  if (REBUILD && existingCampaign) {
    console.log('\nrebuild: wiping the existing demo campaign (doors, voters, books, history, report)');
    const hhIds = await Household.find({ campaignId: existingCampaign._id }).distinct('_id');
    const personIds = hhIds.length
      ? await Voter.find({ householdId: { $in: hhIds }, personId: { $ne: null } }).distinct('personId')
      : [];
    const counts = await deleteCampaignCascade(existingCampaign);
    const purged = await purgeOrphanedDemoPersons(personIds);
    const nonzero = Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  deleted: ${nonzero || '(nothing)'} · purged ${purged} orphaned demo Person(s)`);
    existingCampaign = null; // rebuilt below
  }

  // 1. Org + users -----------------------------------------------------------
  const org =
    existingOrg ||
    (await Organization.create({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, timeZone: CAMPAIGN_TZ }));
  // Demo orgs are `internal` — permanently free, never gated, off the books.
  await Subscription.updateOne(
    { organizationId: org._id },
    { $set: { status: 'internal', statusChangedAt: new Date() } },
    { upsert: true }
  );
  // Admin review logins (one per store). The first is the org's owner.
  const admins = [];
  for (const [k, email] of ADMIN_EMAILS.entries()) {
    const { user } = await ensureUser({
      email, password: ADMIN_PASSWORDS[k], ...adminName(email), syncPassword: true,
    });
    admins.push(user);
  }
  const admin = admins[0];

  // Canvasser review logins (one per store). These are the DISPOSABLE ones: a store reviewer is
  // asked to test account deletion, so they need an account they can actually destroy.
  const reviewers = [];
  for (const [k, email] of REVIEWER_EMAILS.entries()) {
    const { user } = await ensureUser({
      email, password: CANVASSER_PASSWORDS[k], ...reviewerName(email), syncPassword: true,
    });
    reviewers.push(user);
  }
  const background = [];
  for (const c of DEMO_CANVASSERS) {
    const email = `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@demo.doorline.app`;
    const { user } = await ensureUser({
      email, password: randomBytes(18).toString('base64url'), firstName: c.firstName, lastName: c.lastName,
    });
    background.push(user);
  }
  for (const u of admins) await ensureMembership(u._id, org._id, 'admin');
  for (const u of [...reviewers, ...background]) await ensureMembership(u._id, org._id, 'canvasser');

  // The deletion lock, set here so it can't be forgotten before a submission.
  //
  // ADMINS LOCKED: these are the keys to the demo tenant. A reviewer WILL press "Delete my
  // account" — verifying it is exactly what App Store 5.1.1(v) asks of them — and if the admin
  // login is deletable they'd destroy the tenant on their way through, leaving the NEXT
  // submission with no way in.
  //
  // CANVASSERS DELIBERATELY NOT LOCKED: locking everything is its own rejection. A reviewer who
  // can't complete a deletion anywhere fails you for "unable to verify account deletion" — the
  // very thing they came to check. So these exist to be deleted; name them in the review notes.
  // Re-running this seeder recreates one after a reviewer destroys it (deletion releases the
  // email), which is why it's the pre-submission command.
  await User.updateMany({ _id: { $in: admins.map((u) => u._id) } }, { $set: { deletionLocked: true } });
  await User.updateMany({ _id: { $in: reviewers.map((u) => u._id) } }, { $set: { deletionLocked: false } });

  console.log(
    `\n1. org ${org._id} · ${admins.length} admin (deletion-LOCKED: ${admins.map((u) => u.email).join(', ')})` +
      `\n   ${reviewers.length} review canvasser (deletable: ${reviewers.map((u) => u.email).join(', ') || 'none'})` +
      ` + ${background.length} field canvassers`
  );

  // 2. Campaign + 3. survey template ----------------------------------------
  let campaign =
    existingCampaign ||
    (await Campaign.create({
      organizationId: org._id, name: DEMO_CAMPAIGN_NAME, type: 'survey',
      state: CAMPAIGN_STATE, timeZone: CAMPAIGN_TZ, createdBy: admin._id,
    }));
  const desiredQuestions = surveyQuestions();
  const desiredIntro = `Hi, my name is {{canvasser}} — I'm a volunteer with ${DEMO_CANDIDATE}'s campaign for State House. Do you have a quick minute?`;
  const desiredClosing = 'Thanks so much for your time — have a great evening!';
  // Compare only the fields that matter for reports/generation (subdoc _id/order noise excluded).
  const questionSig = (qs) => JSON.stringify((qs || []).map((q) => ({
    key: q.key, type: q.type, label: q.label,
    options: (q.options || []).map((o) => ({ id: o.id, text: o.text, tag: o.tag || null })),
  })));
  let template = await SurveyTemplate.findOne({ organizationId: org._id, name: 'Voter ID & persuasion' });
  if (!template) {
    template = await SurveyTemplate.create({
      organizationId: org._id,
      name: 'Voter ID & persuasion',
      isActive: true,
      intro: desiredIntro,
      closing: desiredClosing,
      questions: desiredQuestions,
      tags: ['Supporter'],
      createdBy: admin._id,
    });
  } else {
    // Repair: bring an existing demo template up to the current (reshaped) survey,
    // bumping version only when the questions actually changed.
    const changed = questionSig(template.questions) !== questionSig(desiredQuestions);
    template.intro = desiredIntro;
    template.closing = desiredClosing;
    template.questions = desiredQuestions;
    template.tags = ['Supporter'];
    if (changed) template.version = (template.version || 1) + 1;
    await template.save();
    if (changed) console.log(`3. survey template reshaped → v${template.version}`);
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

  // 7. Assign books — CLEAN reassignment so a drifted org (e.g. every book stuck on
  // one account) self-heals: wipe the pass's assignments, then reserve ONE marked
  // book per reviewer (kept clean for app review — Apple, Google, …) and distribute
  // the rest across the field canvassers. isReviewerBook is the durable anchor the
  // refresh button excludes by.
  // EVERY app-review login gets a reserved clean book — the admins too, because an admin can
  // switch into canvass mode and a reviewer who finds an empty book list reports that the app
  // doesn't work. Only the background field canvassers share the walked ones.
  const bookedReviewers = [...admins, ...reviewers];
  const turfs = await Turf.find({ passId: pass._id, status: 'published' }).sort({ name: 1 });
  if (turfs.length <= bookedReviewers.length) {
    console.error(`only ${turfs.length} books but ${bookedReviewers.length} review login(s) — need at least one field book left over`);
    process.exit(1);
  }
  // The last N books (by name) become the review logins' reserved books, one each.
  const reviewerTurfs = turfs.slice(turfs.length - bookedReviewers.length);
  const reviewerByTurfId = new Map(reviewerTurfs.map((t, k) => [String(t._id), bookedReviewers[k]]));
  await TurfAssignment.deleteMany({ campaignId: campaign._id, passId: pass._id });
  const assignmentsByTurf = new Map();
  let bgIdx = 0;
  const assignmentDocs = turfs.map((turf) => {
    const reviewerUser = reviewerByTurfId.get(String(turf._id));
    const user = reviewerUser || background[bgIdx++ % background.length];
    assignmentsByTurf.set(String(turf._id), user._id);
    return {
      turfId: turf._id, userId: user._id,
      organizationId: org._id, campaignId: campaign._id, passId: turf.passId,
      assignedBy: admin._id, assignedAt: new Date(), isReviewerBook: !!reviewerUser,
    };
  });
  await TurfAssignment.insertMany(assignmentDocs);
  const reviewerTurfIds = new Set(reviewerByTurfId.keys());
  // Admins are on the crew too now: CampaignAssignment is what gates a campaign's visibility on
  // mobile, so without it an admin in canvass mode can't even see the campaign their reserved
  // book belongs to.
  const crewIds = [...bookedReviewers.map((u) => u._id), ...background.map((u) => u._id)];
  await ensureCampaignAssignments(campaign._id, crewIds, org._id, admin._id); // positional args
  for (const userId of crewIds) {
    await EffortMember.findOneAndUpdate(
      { effortId: effort._id, userId },
      { $setOnInsert: { organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId, addedBy: admin._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  const reviewerBookNote = reviewerTurfs.map((t, k) => `'${t.name}' → ${bookedReviewers[k].email}`).join(', ');
  console.log(`7. assigned ${turfs.length} books across ${background.length} field canvassers · ${bookedReviewers.length} review book(s) kept clean: ${reviewerBookNote}`);

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
      rng: makeRng(RNG_SEED + 1), campaign, template, turfs,
      assignmentsByTurf, reviewerTurfIds, votersByHousehold,
    });
    console.log(`8. staged ${staged.activities} activities · ${staged.surveys} surveys · ${staged.overlaps} overlap doors`);

    // 9. Early voting ----------------------------------------------------------
    for (const h of await Household.find({ campaignId: campaign._id, isActive: true }, 'status')) {
      votersByHousehold.docs.get(String(h._id)).status = h.status; // refresh post-recompute
    }
    const voted = await stageEarlyVoting({
      campaign, adminId: admin._id, votersByHousehold, turfs, reviewerTurfIds,
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
  // Print exactly what goes into App Store Connect / Play Console, and say which account the
  // reviewer is meant to DELETE — the admins refuse deletion, so if the notes don't point at a
  // disposable one the reviewer concludes the feature doesn't work.
  bookedReviewers.forEach((u, k) => {
    const isAdmin = k < admins.length;
    const pw = isAdmin ? ADMIN_PASSWORDS[k] : CANVASSER_PASSWORDS[k - admins.length];
    const role = isAdmin ? 'ADMIN, deletion-LOCKED' : 'canvasser, DELETABLE — give this one to test deletion';
    console.log(`  ${u.email} / ${pw} — ${role} — book '${reviewerTurfs[k].name}' kept clean`);
  });
  console.log(`  client portal:   /r/${share.token}`);
  // Print the command as it must be typed in Heroku's Run console, which starts at the REPO
  // ROOT — `node src/utils/…` is relative to server/ and just errors there. See docs/OPERATIONS.md.
  console.log(`  restage after reviewers knock (and to recreate a deleted review account):`);
  console.log(`    npm run seed:demo -- --reset --apply`);
  console.log(`  full teardown:   npm run cleanup:test-campaigns -- --ids=${campaign._id} --mock=${campaign._id} --apply`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
