// READ-ONLY audit of the early-voting "fully-voted door" invariant. Writes nothing.
//
// It proves the thing admins worry about: a door only drops off the canvassers'
// books when EVERY voter at that address has a VotedVoter row for the campaign.
// Mirrors the exact test in services/voted/recomputeFullyVoted.js.
//
// Per campaign it reports:
//   Totals     — households, fully-voted doors, voters marked voted
//                (cross-check these against the Early Voting page).
//   Check A    — PHANTOM DROPS (the one that matters): households flagged
//                fullyVoted=true that still have an un-voted (or zero) resident.
//                Expect 0. Any hit = a door dropped while someone there hadn't voted.
//   Check B    — MISSED DROPS: households where every voter has voted but
//                fullyVoted isn't true (wastes canvasser trips; not data loss).
//                Fixable by re-running recomputeFullyVoted.
//   Check C    — ORPHAN MARKS: VotedVoter rows whose voter no longer exists, or
//                whose denormalized householdId is stale. Hygiene only.
//
// Exit code is 1 if any phantom drops (Check A) are found, else 0.
//
// Usage (local, from server/):
//   node src/utils/auditVotedDoors.js                  # all campaigns
//   node src/utils/auditVotedDoors.js --campaign=<id>  # one campaign
//
// Heroku (run console / `heroku run`, cwd is the repo root /app):
//   npm run audit:voted-doors                          # via the root wrapper script
//   npm run audit:voted-doors -- --campaign=<id>       # scoped
//   node server/src/utils/auditVotedDoors.js           # direct, no redeploy needed

import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { VotedVoter } from '../models/VotedVoter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const SAMPLE = 10; // how many offenders to print per check
const campaignArg = (process.argv.find((a) => a.startsWith('--campaign=')) || '').split('=')[1];

function header(s) {
  console.log(`\n— ${s} —`);
}

// Query an _id $in over a possibly-large id list, in chunks, and concat results.
async function findChunked(Model, ids, projection, batch = 5000) {
  const out = [];
  for (let i = 0; i < ids.length; i += batch) {
    const rows = await Model.find({ _id: { $in: ids.slice(i, i + batch) } }, projection).lean();
    out.push(...rows);
  }
  return out;
}

async function findVotersByHousehold(hhIds, batch = 5000) {
  const out = [];
  for (let i = 0; i < hhIds.length; i += batch) {
    const rows = await Voter.find(
      { householdId: { $in: hhIds.slice(i, i + batch) } },
      { _id: 1, householdId: 1, fullName: 1 }
    ).lean();
    out.push(...rows);
  }
  return out;
}

function addr(h) {
  return `${h.addressLine1}, ${h.city} ${h.state}`;
}

async function auditCampaign(campaign) {
  header(`Campaign: ${campaign.name || '(unnamed)'}  [${campaign._id}] · org ${campaign.organizationId}`);

  const households = await Household.find(
    { campaignId: campaign._id },
    { _id: 1, addressLine1: 1, city: 1, state: 1, fullyVoted: 1, isActive: 1 }
  ).lean();
  const hhById = new Map(households.map((h) => [String(h._id), h]));
  const hhIds = households.map((h) => h._id);

  // Voters grouped by household.
  const voters = await findVotersByHousehold(hhIds);
  const votersByHh = new Map();
  const voterById = new Map();
  for (const v of voters) {
    voterById.set(String(v._id), v);
    const k = String(v.householdId);
    const arr = votersByHh.get(k) || [];
    arr.push(v);
    votersByHh.set(k, arr);
  }

  // Voted marks for this campaign.
  const votedRows = await VotedVoter.find(
    { campaignId: campaign._id },
    { voterId: 1, householdId: 1 }
  ).lean();
  const votedSet = new Set(votedRows.map((r) => String(r.voterId)));

  const fullyVotedDoors = households.filter((h) => h.fullyVoted === true).length;
  console.log(
    `  households: ${households.length} · fully-voted doors: ${fullyVotedDoors} · voters marked voted: ${votedRows.length}`
  );

  // Check A — phantom drops: fullyVoted=true but some/zero resident not voted.
  const phantom = [];
  for (const h of households) {
    if (h.fullyVoted !== true) continue;
    const hv = votersByHh.get(String(h._id)) || [];
    const unvoted = hv.filter((v) => !votedSet.has(String(v._id)));
    if (hv.length === 0 || unvoted.length > 0) phantom.push({ h, hv, unvoted });
  }
  console.log(`  Check A (phantom drops): ${phantom.length}  ${phantom.length === 0 ? '✓ PASS' : '✗ FAIL'}`);
  for (const p of phantom.slice(0, SAMPLE)) {
    const who = p.hv.length === 0 ? 'NO VOTERS at this door' : p.unvoted.map((v) => v.fullName).join(', ');
    console.log(`      ${p.h._id}  ${addr(p.h)}  — un-voted: ${who}`);
  }
  if (phantom.length > SAMPLE) console.log(`      …and ${phantom.length - SAMPLE} more`);

  // Check B — missed drops: every voter voted but not flagged fullyVoted.
  const missed = [];
  for (const h of households) {
    if (h.fullyVoted === true) continue;
    const hv = votersByHh.get(String(h._id)) || [];
    if (hv.length > 0 && hv.every((v) => votedSet.has(String(v._id)))) missed.push(h);
  }
  console.log(`  Check B (missed drops):  ${missed.length}  ${missed.length === 0 ? '✓ PASS' : '⚠ recompute'}`);
  for (const h of missed.slice(0, SAMPLE)) console.log(`      ${h._id}  ${addr(h)}`);
  if (missed.length > SAMPLE) console.log(`      …and ${missed.length - SAMPLE} more`);

  // Check C — orphan / stale VotedVoter rows.
  const votedVoterIds = votedRows.map((r) => r.voterId);
  const existing = await findChunked(Voter, votedVoterIds, { _id: 1, householdId: 1 });
  const existingById = new Map(existing.map((v) => [String(v._id), v]));
  let orphan = 0;
  let stale = 0;
  for (const r of votedRows) {
    const v = existingById.get(String(r.voterId));
    if (!v) orphan++;
    else if (r.householdId && String(r.householdId) !== String(v.householdId)) stale++;
  }
  console.log(`  Check C (orphan marks):  ${orphan} orphan · ${stale} stale householdId`);

  return { phantom: phantom.length, missed: missed.length, orphan, stale };
}

async function main() {
  console.log('mode: READ-ONLY (no writes)');
  await connectDb(process.env.MONGODB_URI);

  const filter = campaignArg ? { _id: campaignArg } : {};
  const campaigns = await Campaign.find(filter, { name: 1, organizationId: 1 }).lean();
  if (!campaigns.length) {
    console.log(campaignArg ? `  no campaign with _id ${campaignArg}` : '  no campaigns found.');
    await mongoose.disconnect();
    return;
  }

  let phantomTotal = 0;
  let missedTotal = 0;
  for (const c of campaigns) {
    const r = await auditCampaign(c);
    phantomTotal += r.phantom;
    missedTotal += r.missed;
  }

  header('Verdict');
  console.log(`  campaigns audited: ${campaigns.length}`);
  console.log(
    `  phantom drops (dropped doors hiding an un-voted resident): ${phantomTotal}  ${phantomTotal === 0 ? '✓ PASS — the drop invariant holds' : '✗ FAIL — investigate'}`
  );
  console.log(`  missed drops (all-voted doors not yet flagged): ${missedTotal}${missedTotal ? '  ⚠ re-run a voted-import/undo or recomputeFullyVoted to fix' : ''}`);

  await mongoose.disconnect();
  process.exitCode = phantomTotal > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
