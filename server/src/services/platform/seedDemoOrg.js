// Seed (or reset) the permanent Doorline demo environment: a fictional consulting
// org + campaign of ~1,145 households on REAL Des Moines (Beaverdale/Drake) addresses
// with ~2,600 fabricated voters, cut into books, assigned to demo canvassers, with
// staged canvass history, early-vote drops, and one published report + share link.
// The campaign permanently tells a 2-ROUND story: Round 1 archived (its knocks land
// on days −8..−12) and Round 2 active (knocks on today + the four prior evenings),
// so the knocks-by-pass report and round pickers always have real history to show.
// The "Refresh demo day" button restages the SAME 2-round story.
// Serves landing-page screenshots, Apple/Google app-review demo accounts, and live
// prospect demos. Addresses/coordinates are real (from demoAddresses.json); every
// voter identity is fabricated.
//
// THE ENGINE, not the CLI. `seedDemoOrg()` below is pure in the ways a web request needs:
// it never connects, never disconnects, never reads process.argv, and never calls
// process.exit — every failure throws an Error carrying `status`/`code`. The CLI wrapper
// (utils/seedDemoOrg.js) owns the connection, the flags, and stdout; the super-admin
// "Rebuild demo day" button (routes/superAdmin/platform.js) calls the same function with
// the destructive paths switched off. ONE engine, deliberately: two demo stagers that had
// to stay behaviourally identical is exactly what produced the attribution collapse this
// replaced (the old services/platform/refreshDemoDay.js, now deleted).
//
// Usage (from the repo root):
//   npm run seed:demo                       # dry run — prints plan, writes nothing
//   npm run seed:demo -- --apply            # full build (idempotent)
//   npm run seed:demo -- --reset --apply    # wipe activity layer, restage fresh
//                                           # (households/books/accounts/share link survive)
//   npm run seed:demo -- --rebuild --apply  # WIPE the campaign (doors, voters, books,
//                                           # history) and rebuild from scratch — use after
//                                           # the address set changes (org + users survive)
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

import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

// Only to locate the address fixture, which still lives beside the CLI in utils/demoData/.
// No dotenv here: the CLI loads server/.env before importing this module, and on a dyno the
// config vars are already in process.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import bcrypt from 'bcryptjs';
import { User } from '../../models/User.js';
import { Organization } from '../../models/Organization.js';
import { Membership } from '../../models/Membership.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Effort } from '../../models/Effort.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { FlagReview } from '../../models/FlagReview.js';
import { ImportJob } from '../../models/ImportJob.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { Subscription } from '../../models/Subscription.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { Person } from '../../models/Person.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { PersonMergeLog } from '../../models/PersonMergeLog.js';
import { deleteCampaignCascade } from '../campaigns/deleteCampaign.js';
import { buildImportRows } from '../import/csvImporter.js';
import { applyImport } from '../import/csvImporter.js';
import { DEFAULT_PROFILE_MAPPING } from '../import/canonicalFields.js';
import { reconcileIdentityFromImport } from '../person/reconcileIdentityFromImport.js';
import { recomputeCutAttributesForCampaign } from '../turf/computeCutAttributes.js';
import { createNextPass } from '../passes/createPass.js';
import { generateTurf } from '../turf/generateTurf.js';
import { ensureCampaignAssignments } from '../campaignRoster.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { computeWindowStats, buildFrozenMapPoints } from '../reports/computeReport.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { stageDemoActivity, persistDemoActivity, ARCHIVED_DAY_OFFSETS } from './demoActivity.js';
import { inStateBounds } from '../../utils/stateBounds.js';
import {
  makeRng,
  FIRST_NAMES,
  LAST_NAMES,
  DEMO_ORG_NAME,
  DEMO_ORG_SLUG,
  DEMO_CAMPAIGN_NAME,
  DEMO_CANDIDATE,
  DEMO_CANVASSERS,
} from '../../utils/demoData/namePools.js';

// Every failure in here used to be `console.error` + `process.exit(1)`. In a web dyno that
// kills the process and drops every other user's in-flight request, so they all throw now.
// `status` rides along for the route's error tail; the CLI just prints the message.
const seedError = (message, code, status = 500) =>
  Object.assign(new Error(message), { status, code });

// Hide credentials but keep host/db visible so the operator can confirm the target.
const maskUri = (uri) => (uri ? uri.replace(/\/\/[^@/]+@/, '//***:***@') : '(MONGODB_URI unset)');

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
// Resolved per RUN, not at import — see resolveSeedAccounts() below for why that matters.

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
  throw seedError(
    `${varName} has ${parts.length} password(s) but there are ${emails.length} email(s). `
      + 'Give exactly one (shared by all) or one per email, in the same order.',
    'SEED_PASSWORD_COUNT'
  );
}

// Read the four SEED_DEMO_* vars ON INVOCATION, never at import. passwordList throws on a
// mismatched pair, and a module-scope throw in a web dyno is a BOOT crash — the server would
// die before Express listens, taking the whole app down over a demo-seeding typo. Placement
// is load-bearing too: this must sit BELOW emailList and passwordList, because a const arrow
// referencing either from above hits the temporal dead zone and fails only when the button is
// pressed — passing every import-time smoke test on the way through.
const resolveSeedAccounts = () => {
  const adminEmails = emailList(process.env.SEED_DEMO_ADMIN_EMAIL, 'demo-admin@doorline.app');
  const reviewerEmails = emailList(process.env.SEED_DEMO_CANVASSER_EMAIL, 'demo-canvasser@doorline.app');
  return {
    adminEmails,
    reviewerEmails,
    adminPasswords: passwordList(
      process.env.SEED_DEMO_ADMIN_PASSWORD, 'admin1234!', adminEmails, 'SEED_DEMO_ADMIN_PASSWORD'
    ),
    canvasserPasswords: passwordList(
      process.env.SEED_DEMO_CANVASSER_PASSWORD, 'Victory26!', reviewerEmails, 'SEED_DEMO_CANVASSER_PASSWORD'
    ),
  };
};

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
    fs.readFileSync(path.resolve(__dirname, '../../utils/demoData/demoAddresses.json'), 'utf8')
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
// realistic answers). Each round's books are staged on that round's day window
// (`rounds` = [{ label, turfs, assignmentsByTurf, reviewerTurfIds, dayOffsets }]),
// the reviewer's book is excluded structurally by turf id, and EVERYTHING persists
// in ONE persistDemoActivity call — Household.status is latest-across-passes, so a
// door knocked in both rounds needs a single resolveStatus over all its actions
// (and one call keeps the writes batched / H12-safe).
async function stageCanvassHistory({ rng, campaign, template, rounds, votersByHousehold }) {
  // Who is on whose crew, in THIS campaign — read from the roster the crew block above just wrote,
  // rather than threaded through, so this cannot drift from what the console will show.
  const crewRows = await CampaignAssignment.find(
    { campaignId: campaign._id },
    'userId coordinatorId'
  ).lean();
  const crewByUser = new Map(
    crewRows.map((r) => [String(r.userId), r.coordinatorId ? String(r.coordinatorId) : null])
  );
  const allActivities = [];
  const allSurveys = [];
  const perRound = [];
  const doorSets = [];
  let overlaps = 0;
  let todayKnocks = 0;
  for (const round of rounds) {
    const stagedBooks = round.turfs.filter((t) => !round.reviewerTurfIds.has(String(t._id)));
    const staged = stageDemoActivity({
      rng, campaign, template, tz: CAMPAIGN_TZ, stagedBooks,
      assignmentsByTurf: round.assignmentsByTurf,
      hhById: votersByHousehold.docs, votersByHousehold: votersByHousehold.byId,
      crewByUser,
      ...(round.dayOffsets ? { dayOffsets: round.dayOffsets } : {}), // default = recent window
    });
    allActivities.push(...staged.activities);
    allSurveys.push(...staged.surveys);
    overlaps += staged.overlaps;
    todayKnocks += staged.todayKnocks;
    doorSets.push(new Set(staged.activities.map((a) => String(a.householdId))));
    perRound.push({ label: round.label, activities: staged.activities.length, surveys: staged.surveys.length });
  }
  // Cross-round re-knocks: distinct doors that took a knock in more than one round
  // (the "second pass" story the knocks-by-pass report tells).
  const hitCounts = new Map();
  for (const set of doorSets) for (const id of set) hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
  const reknockDoors = [...hitCounts.values()].filter((n) => n > 1).length;
  await persistDemoActivity({ campaign, activities: allActivities, surveys: allSurveys });
  return {
    activities: allActivities.length, surveys: allSurveys.length,
    overlaps, todayKnocks, perRound, reknockDoors,
  };
}

// Cut + publish + assign ONE round's books — reused for both rounds so the archived
// Round 1 and the active Round 2 each get real published books. Idempotent: an
// already-published round skips the cut; assignment is a CLEAN reassignment every
// run so a drifted org (e.g. every book stuck on one account) self-heals. Every
// review login gets a reserved clean book in EVERY round, marked isReviewerBook —
// the durable anchor both the staging exclusion and the refresh button's guard key
// on, so no round's staged history can ever walk a review account's doors.
async function buildRoundBooks({ pass, org, campaign, admin, bookedReviewers, background, log }) {
  let published = await Turf.countDocuments({ passId: pass._id, status: 'published' });
  let cut = 0;
  if (!published) {
    const { bookCount } = await generateTurf({
      campaignId: campaign._id, passId: pass._id, mode: 'geometric', params: { maxDoors: BOOK_MAX_DOORS },
    });
    const accepted = await Turf.updateMany(
      { campaignId: campaign._id, passId: pass._id, status: 'draft' },
      { $set: { status: 'published' } }
    );
    published = accepted.modifiedCount;
    cut = bookCount || 0;
    log(`   ${pass.name}: cut ${cut} books · published ${published}`);
  } else {
    log(`   ${pass.name}: books skipped (${published} already published)`);
  }
  const turfs = await Turf.find({ passId: pass._id, status: 'published' }).sort({ name: 1 });
  if (turfs.length <= bookedReviewers.length) {
    throw seedError(
      `only ${turfs.length} books on ${pass.name} but ${bookedReviewers.length} review login(s) — need at least one field book left over`,
      'SEED_TOO_FEW_BOOKS'
    );
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
  return {
    turfs, assignmentsByTurf, reviewerTurfIds: new Set(reviewerByTurfId.keys()), reviewerTurfs,
    cut, kept: published,
  };
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

async function ensureShareLink({ campaign, adminId, log, requireSharePassword }) {
  // A generated password is printed ONCE and only its hash is stored, so on the button's path
  // (log is a no-op) generating one would silently strand the client link behind a password
  // nobody has. Refuse instead, and name the config var that fixes it.
  if (requireSharePassword && !process.env.SEED_DEMO_SHARE_PASSWORD) {
    const existing = await ReportShareLink.findOne(
      { campaignId: campaign._id, isActive: true, passwordHash: { $ne: null } },
      '_id'
    ).lean();
    if (!existing) {
      throw seedError(
        'SEED_DEMO_SHARE_PASSWORD is not set and the demo share link has no password yet — set it in '
          + 'Heroku → Config Vars first, or the generated password is lost the moment it is created.',
        'SHARE_PASSWORD_UNSET',
        409
      );
    }
  }
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
      log(`  · demo share link upgraded: password ${process.env.SEED_DEMO_SHARE_PASSWORD ? 'from SEED_DEMO_SHARE_PASSWORD' : `generated → ${pw} (save it now — it is not shown again)`}`);
    }
    await ReportShareLink.updateOne({ _id: share._id }, { $set: patch });
    return share;
  }
  const pw = process.env.SEED_DEMO_SHARE_PASSWORD || randomBytes(9).toString('base64url');
  if (!process.env.SEED_DEMO_SHARE_PASSWORD) {
    log(`  · demo share link password generated → ${pw} (save it now — it is not shown again)`);
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

async function resetActivityLayer(campaign, log) {
  const campaignId = campaign._id;
  // FlagReview joins the wipe: its actionId is a required ref to a CanvassActivity we are about
  // to delete, so skipping it orphans every review row. Campaign-scoped like its five siblings.
  const [acts, resp, respArchives, voted, uploads, pending, flags] = await Promise.all([
    CanvassActivity.deleteMany({ campaignId }),
    SurveyResponse.deleteMany({ campaignId }),
    SurveyResponseArchive.deleteMany({ campaignId }),
    VotedVoter.deleteMany({ campaignId }),
    VotedUpload.deleteMany({ campaignId }),
    VotedPendingId.deleteMany({ campaignId }),
    FlagReview.deleteMany({ campaignId }),
  ]);
  const reports = await ClientReport.find({ campaignId }, '_id').lean();
  await ClientReportMapPoint.deleteMany({ clientReportId: { $in: reports.map((r) => r._id) } });
  await ClientReport.deleteMany({ campaignId });
  // fullyVoted is safe to clear — recomputeFullyVoted rebuilds it from the VotedVoter rows wiped
  // just above. fullyDnc is NOT: it derives from org-wide Voter.doNotContact.flagged, which this
  // reset never touches, and nothing here recomputes it. Clearing it let a do-not-contact door
  // back through KNOCKABLE_DOOR_FILTER and put staged knocks on a door we promise never to knock.
  await Household.updateMany(
    { campaignId },
    { $set: { status: 'unknocked', fullyVoted: false, lastActionAt: null, lastActionBy: null } }
  );
  const voterIds = await Voter.distinct('_id', { organizationId: campaign.organizationId });
  await Voter.updateMany({ _id: { $in: voterIds } }, { $set: { surveyStatus: 'not_surveyed' } });
  const wiped = {
    activities: acts.deletedCount,
    surveys: resp.deletedCount,
    surveyArchives: respArchives.deletedCount,
    votedMarks: voted.deletedCount,
    votedUploads: uploads.deletedCount,
    pendingIds: pending.deletedCount,
    flagReviews: flags.deletedCount,
    reports: reports.length,
  };
  log(
    `  wiped: ${wiped.activities} activities · ${wiped.surveys} surveys · ${wiped.votedMarks} voted marks · `
      + `${wiped.votedUploads} uploads · ${wiped.pendingIds} pending ids · ${wiped.flagReviews} flag reviews · `
      + `${wiped.reports} report(s)`
  );
  return wiped;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
/**
 * Build / reset / rebuild the demo environment. The caller owns the mongoose connection —
 * this never connects and never disconnects, so it is safe to await inside a request.
 *
 * @param apply         false = dry run, writes nothing (the CLI's default)
 * @param reset         wipe the activity layer and restage it
 * @param rebuild       WIPE the campaign (doors, voters, books) and rebuild — CLI only;
 *                      the button hard-codes false so it can never reach the cascade
 * @param allowImport   false = refuse rather than run the ~2,600-voter CSV import, which
 *                      blows Heroku's 30s H12 window and leaves the demo half-built
 * @param syncPasswords false = never rewrite an EXISTING review account's password. The
 *                      button passes false: a stray click must not be able to change the
 *                      credentials sitting in Apple's / Google's review notes to whatever
 *                      the SEED_DEMO_* vars happen to say today. New accounts are still
 *                      created with the env password — there is nothing to clobber.
 * @param requireExisting true = refuse when the org/campaign/voters aren't built yet, so a
 *                      request can never fall into the cold-build path
 * @param historySeed   seed for the staged-knock rng. The CLI pins it (identical day every
 *                      run); the button varies it so each press looks like a different day,
 *                      which is what the old refresh button did with unseeded Math.random.
 *                      NOT the household/voter rng — that stays RNG_SEED, permanently, or
 *                      the generated dataset stops matching what's already imported.
 * @param log           sink for the CLI's progress lines; the route passes a no-op because
 *                      three of them print credentials (see the summary block at the end).
 */
export async function seedDemoOrg({
  apply = false,
  reset = false,
  rebuild = false,
  allowImport = true,
  syncPasswords = true,
  requireExisting = false,
  requireSharePassword = false,
  historySeed = RNG_SEED + 1,
  log = () => {},
} = {}) {
  const startedAt = Date.now();
  const { adminEmails, reviewerEmails, adminPasswords, canvasserPasswords } = resolveSeedAccounts();
  const modeLabel = !apply
    ? 'DRY RUN (no writes)'
    : rebuild
      ? 'REBUILD + APPLY (existing demo campaign wiped, then rebuilt)'
      : reset
        ? 'RESET + APPLY (activity layer restaged)'
        : 'APPLY (writes WILL happen)';
  log(`mode: ${modeLabel}`);
  log(`DB:   ${maskUri(process.env.MONGODB_URI)}`);
  if (!/127\.0\.0\.1|localhost/.test(process.env.MONGODB_URI || '')) {
    log('⚠️  Non-local database — for production, take an Atlas snapshot first.');
  }

  const rng = makeRng(RNG_SEED);
  const plannedHouseholds = generateHouseholds(rng);
  const plannedVoters = generateVoters(rng, plannedHouseholds);
  log(`\nplan: org '${DEMO_ORG_NAME}' (${DEMO_ORG_SLUG}) · campaign '${DEMO_CAMPAIGN_NAME}'`);
  log(`  ${plannedHouseholds.length} households · ${plannedVoters.length} voters on ${new Set(plannedHouseholds.map((h) => h.precinct)).size} precincts of real Des Moines addresses`);
  log(`  accounts: admin(s) ${adminEmails.join(', ')} · review canvasser(s) ${reviewerEmails.join(', ')} · ${DEMO_CANVASSERS.length} field canvassers`);

  const existingOrg = await Organization.findOne({ slug: DEMO_ORG_SLUG });
  let existingCampaign = existingOrg
    ? await Campaign.findOne({ organizationId: existingOrg._id, name: DEMO_CAMPAIGN_NAME })
    : null;
  log(`  exists: org=${existingOrg ? existingOrg._id : 'no'} · campaign=${existingCampaign ? existingCampaign._id : 'no'}`);

  // The route's floor. A cold build imports ~2,600 voters and re-cuts turf — minutes of work
  // that a 30s request will abandon half-done, leaving the demo org in a state no reviewer
  // and no prospect should ever see. Build it from the CLI first, then the button maintains it.
  // BOTH floors are checked HERE, before the first write. resetActivityLayer commits its wipe
  // long before the import branch is reached, so refusing down there would leave the demo org
  // emptier than it started — the one outcome worse than not running at all.
  if (requireExisting && !(existingOrg && existingCampaign)) {
    throw seedError(
      `Demo org/campaign not built yet — run 'npm run seed:demo -- --apply' from the console first.`,
      'DEMO_NOT_BUILT',
      409
    );
  }
  if (!allowImport && existingOrg) {
    const haveVoters = await Voter.countDocuments({ organizationId: existingOrg._id });
    if (haveVoters < plannedVoters.length) {
      throw seedError(
        `Demo org has ${haveVoters} of ${plannedVoters.length} voters — run 'npm run seed:demo -- --apply' `
          + 'from the console to finish the build. The import is far too slow to run inside a request.',
        'DEMO_IMPORT_REQUIRED',
        409
      );
    }
  }

  if (!apply) {
    const next = rebuild
      ? 're-run with --rebuild --apply to WIPE the existing demo campaign and rebuild it'
      : 're-run with --apply to build (add --reset to restage activity, or --rebuild to wipe + rebuild)';
    log(`\nDry run — ${next}.`);
    return { mode: 'seed-dryrun', dryRun: true, org: null, campaign: null, durationMs: Date.now() - startedAt };
  }

  // --rebuild: hard-delete the existing demo campaign (cascade) + purge the fake
  // Persons it created, then fall through to a fresh build. Org + users survive.
  if (rebuild && existingCampaign) {
    log('\nrebuild: wiping the existing demo campaign (doors, voters, books, history, report)');
    const hhIds = await Household.find({ campaignId: existingCampaign._id }).distinct('_id');
    const personIds = hhIds.length
      ? await Voter.find({ householdId: { $in: hhIds }, personId: { $ne: null } }).distinct('personId')
      : [];
    const counts = await deleteCampaignCascade(existingCampaign);
    const purged = await purgeOrphanedDemoPersons(personIds);
    const nonzero = Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
    log(`  deleted: ${nonzero || '(nothing)'} · purged ${purged} orphaned demo Person(s)`);
    existingCampaign = null; // rebuilt below
  }

  // 1. Org + users -----------------------------------------------------------
  const org =
    existingOrg ||
    (await Organization.create({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, timeZone: CAMPAIGN_TZ, isInternal: true }));
  // Demo orgs are `internal` — permanently free, never gated, off the books, and staff enter
  // without a support grant (middleware/orgContext.js). `isInternal` is schema-immutable, so
  // an EXISTING org needs the sanctioned raw-collection write (same technique, and same
  // justification, as migrate:internal-orgs) — filter-guarded, idempotent, and reached only
  // via the DEMO_ORG_SLUG lookup above, so it can never touch a real org.
  await Organization.collection.updateOne(
    { _id: org._id, isInternal: { $ne: true } },
    { $set: { isInternal: true } }
  );
  await Subscription.updateOne(
    { organizationId: org._id },
    { $set: { status: 'internal', statusChangedAt: new Date() } },
    { upsert: true }
  );
  // Admin review logins (one per store). The first is the org's owner.
  // syncPasswords is false on the button's path: an EXISTING review account keeps the password
  // the store already has in its review notes. A brand-new one still gets the env password —
  // there is nothing to clobber, and an account with no known password is useless.
  const accountsCreated = [];
  const accountsExisting = [];
  const passwordsSynced = [];
  const noteAccount = (email, role, created, credentialSource) => {
    (created ? accountsCreated : accountsExisting).push({ email, role, credentialSource });
    if (!created && syncPasswords) passwordsSynced.push(email);
  };
  const admins = [];
  for (const [k, email] of adminEmails.entries()) {
    const { user, created } = await ensureUser({
      email, password: adminPasswords[k], ...adminName(email), syncPassword: syncPasswords,
    });
    noteAccount(email, 'admin', created, 'SEED_DEMO_ADMIN_PASSWORD');
    admins.push(user);
  }
  const admin = admins[0];

  // Canvasser review logins (one per store). These are the DISPOSABLE ones: a store reviewer is
  // asked to test account deletion, so they need an account they can actually destroy.
  const reviewers = [];
  for (const [k, email] of reviewerEmails.entries()) {
    const { user, created } = await ensureUser({
      email, password: canvasserPasswords[k], ...reviewerName(email), syncPassword: syncPasswords,
    });
    noteAccount(email, 'canvasser', created, 'SEED_DEMO_CANVASSER_PASSWORD');
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

  log(
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
  // Follow the campaign's OWN pointer first, falling back to the name only for a fresh build.
  // Resolving by name alone meant that renaming the demo survey in the console made this miss,
  // create a SECOND template, and leave the campaign pointing at the first — after which the
  // staged responses and the published report keyed off a template the campaign wasn't on, and
  // the template-scoped Survey Explorer drill-ins came back empty.
  let template = campaign.surveyTemplateId
    ? await SurveyTemplate.findById(campaign.surveyTemplateId)
    : null;
  if (!template) {
    template = await SurveyTemplate.findOne({ organizationId: org._id, name: 'Voter ID & persuasion' });
  }
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
    if (changed) log(`3. survey template reshaped → v${template.version}`);
  }
  if (!campaign.surveyTemplateId) {
    campaign.surveyTemplateId = template._id; // must be set before a round can activate
    await campaign.save();
  }
  log(`2. campaign ${campaign._id} ('${campaign.name}', ${campaign.type}, ${campaign.timeZone})`);
  log(`3. survey template ${template._id} (${template.questions.length} questions)`);

  let wipedSummary = null;
  if (reset) {
    log('\nreset: wiping activity layer (voters/books/accounts/share link survive)');
    wipedSummary = await resetActivityLayer(campaign, log);
  }

  // 4. Import voters through the real pipeline -------------------------------
  const voterCount = await Voter.countDocuments({ organizationId: org._id });
  if (voterCount >= plannedVoters.length) {
    log(`4. import: skipped (${voterCount} voters already present)`);
  } else {
    const csv = buildCsv(plannedVoters);
    const built = await buildImportRows(Buffer.from(csv, 'utf8'), 'demo-voters.csv', DEFAULT_PROFILE_MAPPING);
    if (built.errors.length) {
      throw seedError(
        `import produced ${built.errors.length} row errors — first: ${JSON.stringify(built.errors[0])}`,
        'SEED_IMPORT_ROWS'
      );
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
    log(`4. imported ${counts.newVoters} voters / ${counts.newHouseholds} households (persons linked)`);
  }

  // 5. Effort + rounds --------------------------------------------------------
  // The permanent 2-round story: Round 1 archived (walked the week before), Round 2
  // active (walked on the recent days). Both are found-or-created by their exact
  // (effortId, roundNumber) — the unique Pass index makes re-runs safe, and
  // createNextPass's E11000 retry covers a race.
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
  async function ensureRound(roundNumber) {
    let p = await Pass.findOne({ effortId: effort._id, roundNumber });
    if (!p) {
      p = await createNextPass({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId: admin._id });
      if (!p) throw seedError('createNextPass failed', 'SEED_PASS_CREATE');
      if (p.roundNumber !== roundNumber) {
        throw seedError(
          `expected round ${roundNumber} but createNextPass minted round ${p.roundNumber} — clean up stray passes on the demo effort`,
          'SEED_PASS_ROUND'
        );
      }
    }
    return p;
  }
  const r1 = await ensureRound(1);
  const r2 = await ensureRound(2);
  log(`5. effort '${effort.name}' · claimed ${claimed.modifiedCount} intake doors · rounds '${r1.name}' + '${r2.name}'`);

  // 6/7. Cut + publish + assign books for BOTH rounds (buildRoundBooks). EVERY
  // app-review login gets a reserved clean book in each round — the admins too,
  // because an admin can switch into canvass mode and a reviewer who finds an
  // empty book list reports that the app doesn't work. Only the background field
  // canvassers share the walked ones. Order is load-bearing: Round 2 is cut LAST
  // so the Household.turfId mirror ends pointed at the ACTIVE round's books.
  const bookedReviewers = [...admins, ...reviewers];
  log('6/7. books per round:');
  const round1 = await buildRoundBooks({ pass: r1, org, campaign, admin, bookedReviewers, background, log });
  const round2 = await buildRoundBooks({ pass: r2, org, campaign, admin, bookedReviewers, background, log });
  // Admins are on the crew too now: CampaignAssignment is what gates a campaign's visibility on
  // mobile, so without it an admin in canvass mode can't even see the campaign their reserved
  // book belongs to.
  const crewIds = [...bookedReviewers.map((u) => u._id), ...background.map((u) => u._id)];
  await ensureCampaignAssignments(campaign._id, crewIds, org._id, admin._id); // positional args

  // CREWS. A demo that shows every door under one nameless heap sells nothing — the by-team table
  // is a feature, so the demo has to have teams. Split the field canvassers across two
  // coordinators, both real accounts in this org and both admins (which is what a coordinator must
  // be). Written straight onto the roster because a crew is per-campaign now
  // (models/CampaignAssignment.js); the knocks below are stamped from the same split, so the
  // ledger and the roster agree from the first door.
  //
  // Omar leads by default; Dana (the seeded demo admin) takes the second crew. SEED_DEMO_CREW_LEADS
  // overrides with a comma-separated list of emails. Anyone not found is skipped rather than
  // failing the seed — a fresh database has no Omar, and a demo with one crew still beats none.
  const leadEmails = (process.env.SEED_DEMO_CREW_LEADS || 'omar@doorline.app,demo-admin@doorline.app')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const leadUsers = (await User.find({ email: { $in: leadEmails } }, '_id email').lean())
    .sort((a, b) => leadEmails.indexOf(a.email) - leadEmails.indexOf(b.email));
  const crewByUser = new Map();
  if (leadUsers.length) {
    // Round-robin so each coordinator gets a real crew rather than one taking everybody.
    const walkers = [...background, ...bookedReviewers.filter((u) => !leadEmails.includes(u.email))];
    for (const [i, u] of walkers.entries()) {
      const lead = leadUsers[i % leadUsers.length];
      if (String(lead._id) === String(u._id)) continue; // nobody coordinates themselves
      crewByUser.set(String(u._id), String(lead._id));
      await CampaignAssignment.updateOne(
        { campaignId: campaign._id, userId: u._id },
        { $set: { coordinatorId: lead._id } }
      );
    }
    log(`   crews: ${leadUsers.map((l) => l.email).join(' + ')} over ${crewByUser.size} canvasser(s)`);
  }
  for (const userId of crewIds) {
    await EffortMember.findOneAndUpdate(
      { effortId: effort._id, userId },
      { $setOnInsert: { organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId, addedBy: admin._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  const reviewerBookNote = round2.reviewerTurfs.map((t, k) => `'${t.name}' → ${bookedReviewers[k].email}`).join(', ');
  log(
    `   assigned ${round1.turfs.length}+${round2.turfs.length} books across ${background.length} field canvassers ` +
      `· ${bookedReviewers.length} review book(s) kept clean per round — active round: ${reviewerBookNote}`
  );

  // Round lifecycle. STATUSES are corrected on every run (the one-active-round-per-
  // effort invariant must always hold), but the DATE stamps move only in the same run
  // that (re)stages the knocks — a no-op `--apply` re-run must never slide activatedAt/
  // archivedAt past knocks that stay where they are, or every knock lands outside its
  // round's lifecycle window. R1 ran −14d → −7d (staged knocks on days −8..−12); R2
  // activated at the boundary (−6d) and owns today..−4. Refresh-demo-day re-stamps
  // dates the same way because it always restages.
  const activityCount = await CanvassActivity.countDocuments({ campaignId: campaign._id });
  const willStage = activityCount === 0;
  await Pass.updateMany(
    { campaignId: campaign._id, effortId: effort._id, status: 'active', _id: { $ne: r2._id } },
    { $set: { status: 'archived', archivedAt: new Date() } }
  );
  await Pass.updateOne(
    { _id: r1._id },
    {
      $set: {
        status: 'archived',
        ...(willStage ? { activatedAt: localTime(-14, 9 * 60), archivedAt: localTime(-7, 18 * 60) } : {}),
      },
    }
  );
  await Pass.updateOne(
    { _id: r2._id },
    {
      $set: {
        status: 'active',
        ...(willStage ? { activatedAt: localTime(-6, 9 * 60), archivedAt: null } : {}),
      },
    }
  );
  log(
    `   rounds: '${r1.name}' archived · '${r2.name}' active` +
      (willStage ? ' (dates stamped −14d/−7d and −6d with the staged history)' : ' (dates untouched — history kept)')
  );

  // 8. Staged canvass history --------------------------------------------------
  let stagedSummary = null;
  let votedSummary = null;
  let reportSummary = null;
  if (activityCount > 0) {
    log(`8. history: skipped (${activityCount} activities exist — use --reset --apply to restage)`);
  } else {
    // Lean + projected: nothing downstream calls .save(), a virtual, or an instance method, and
    // the .status write below works the same on a POJO. Hydrating ~1,145 + ~2,616 full mongoose
    // documents cost ~45MB and ~190ms for nothing — headroom that matters inside a request.
    const hhDocs = await Household.find(
      { campaignId: campaign._id, isActive: true },
      'organizationId campaignId effortId location status'
    ).lean();
    const voterDocs = await Voter.find(
      { organizationId: org._id, householdId: { $in: hhDocs.map((h) => h._id) } },
      'householdId stateVoterId'
    ).lean();
    const votersByHousehold = { docs: new Map(), byId: new Map() };
    for (const h of hhDocs) votersByHousehold.docs.set(String(h._id), h);
    for (const v of voterDocs) {
      const k = String(v.householdId);
      if (!votersByHousehold.byId.has(k)) votersByHousehold.byId.set(k, []);
      votersByHousehold.byId.get(k).push(v);
    }
    const staged = await stageCanvassHistory({
      rng: makeRng(historySeed), campaign, template, votersByHousehold,
      rounds: [
        { label: r1.name, ...round1, dayOffsets: ARCHIVED_DAY_OFFSETS }, // archived week
        { label: r2.name, ...round2 }, // default offsets: today + four prior evenings
      ],
    });
    log(`8. staged ${staged.activities} activities · ${staged.surveys} surveys · ${staged.overlaps} overlap doors`);
    log(
      `   rounds staged: ${staged.perRound.map((r) => `'${r.label}' ${r.activities} activities / ${r.surveys} surveys`).join(' · ')}` +
        ` · ${staged.reknockDoors} doors re-knocked across rounds`
    );

    // 9. Early voting ----------------------------------------------------------
    for (const h of await Household.find({ campaignId: campaign._id, isActive: true }, 'status')) {
      votersByHousehold.docs.get(String(h._id)).status = h.status; // refresh post-recompute
    }
    // Untouched doors are drawn from the ACTIVE round's books (the ones on the map).
    const voted = await stageEarlyVoting({
      campaign, adminId: admin._id, votersByHousehold,
      turfs: round2.turfs, reviewerTurfIds: round2.reviewerTurfIds,
    });
    log(`9. early voting: ${voted.voters} voters marked · ${voted.doorsDropped} doors dropped`);

    // 10. Client report + share link -------------------------------------------
    const report = await publishClientReport({ campaign, template: template.toObject(), adminId: admin._id });
    log(`10. published client report '${report.title}' (${report.weekStart} → ${report.weekEnd}, ${report.mapPointCount} map points)`);

    stagedSummary = {
      activities: staged.activities,
      surveys: staged.surveys,
      todayKnocks: staged.todayKnocks ?? 0,
      overlapDoors: staged.overlaps,
      reknockDoors: staged.reknockDoors,
      perRound: staged.perRound,
    };
    votedSummary = { voters: voted.voters, doorsDropped: voted.doorsDropped };
    reportSummary = {
      title: report.title,
      weekStart: report.weekStart,
      weekEnd: report.weekEnd,
      mapPointCount: report.mapPointCount,
    };
  }
  const share = await ensureShareLink({
    campaign, adminId: admin._id, log, requireSharePassword,
  });

  // Summary --------------------------------------------------------------------
  const [hh, vv, tt, aa, ss] = await Promise.all([
    Household.countDocuments({ campaignId: campaign._id }),
    Voter.countDocuments({ organizationId: org._id }),
    Turf.countDocuments({ passId: { $in: [r1._id, r2._id] }, status: 'published' }),
    CanvassActivity.countDocuments({ campaignId: campaign._id }),
    SurveyResponse.countDocuments({ campaignId: campaign._id }),
  ]);
  log('\n────────────────────────────────────────────');
  log(`Demo ready: '${DEMO_ORG_NAME}' / '${DEMO_CAMPAIGN_NAME}'`);
  log(`  campaignId: ${campaign._id}`);
  log(`  ${hh} doors · ${vv} voters · ${tt} books across 2 rounds · ${aa} activities · ${ss} surveys`);
  // Print exactly what goes into App Store Connect / Play Console, and say which account the
  // reviewer is meant to DELETE — the admins refuse deletion, so if the notes don't point at a
  // disposable one the reviewer concludes the feature doesn't work.
  // These three lines print CREDENTIALS and the client-portal URL. They are why the route
  // passes a no-op `log` and why the returned summary carries `credentialSource` (the name of
  // the config var) instead of the password itself: a mutation result lives in the react-query
  // cache and renders into the DOM, so a pitch-time screen-share would put a deletion-LOCKED
  // admin login on someone else's monitor. The operator reads the real values in Heroku.
  bookedReviewers.forEach((u, k) => {
    const isAdmin = k < admins.length;
    const pw = isAdmin ? adminPasswords[k] : canvasserPasswords[k - admins.length];
    const role = isAdmin ? 'ADMIN, deletion-LOCKED' : 'canvasser, DELETABLE — give this one to test deletion';
    log(`  ${u.email} / ${pw} — ${role} — book '${round2.reviewerTurfs[k].name}' kept clean`);
  });
  log(`  client portal:   /r/${share.token}`);
  // Print the command as it must be typed in Heroku's Run console, which starts at the REPO
  // ROOT — `node src/utils/…` is relative to server/ and just errors there. See docs/OPERATIONS.md.
  log(`  restage after reviewers knock (and to recreate a deleted review account):`);
  log(`    npm run seed:demo -- --reset --apply`);
  log(`  full teardown:   npm run cleanup:test-campaigns -- --ids=${campaign._id} --mock=${campaign._id} --apply`);

  return {
    mode: rebuild ? 'seed-rebuild' : reset ? 'seed-reset' : 'seed-apply',
    dryRun: false,
    org: { id: String(org._id), name: org.name, slug: org.slug },
    campaign: { id: String(campaign._id), name: campaign.name },
    wiped: wipedSummary,
    accounts: {
      created: accountsCreated,
      existing: accountsExisting,
      passwordsSynced,
      fieldCanvassers: background.length,
    },
    books: {
      cut: round1.cut + round2.cut,
      kept: round1.kept + round2.kept,
      total: tt,
      reviewer: round2.reviewerTurfs.map((t, k) => ({
        round: r2.name, name: t.name, assignedTo: bookedReviewers[k].email,
      })),
    },
    rounds: [
      { label: r1.name, roundNumber: r1.roundNumber, status: 'archived', books: round1.turfs.length },
      { label: r2.name, roundNumber: r2.roundNumber, status: 'active', books: round2.turfs.length },
    ].map((r) => {
      const staged = (stagedSummary?.perRound || []).find((p) => p.label === r.label);
      return { ...r, activities: staged?.activities ?? 0, surveys: staged?.surveys ?? 0 };
    }),
    staged: stagedSummary,
    earlyVoting: votedSummary,
    report: reportSummary,
    share: { token: share.token, url: `/r/${share.token}`, expiresAt: share.expiresAt },
    totals: { doors: hh, voters: vv, books: tt, activities: aa, surveys: ss },
    datesStamped: willStage,
    durationMs: Date.now() - startedAt,
  };
}
