import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Voter } from '../models/Voter.js';
import { Household } from '../models/Household.js';
import { Person } from '../models/Person.js';
import { PersonMergeCandidate } from '../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../models/PersonEditProposal.js';
import { PersonMergeLog } from '../models/PersonMergeLog.js';
import { resolvePerson } from '../services/person/resolvePerson.js';
import { normalizePersonKeys } from '../services/person/normalizePersonKeys.js';

// Backfill the canonical Person layer from existing per-org Voter rows. Builds one
// Person per real human (deduped across orgs on the same key the live importer
// uses), links each Voter via Voter.personId, and flags ambiguous cases as
// PersonMergeCandidates for the super-admin. Person identity is seeded
// most-recent-wins; owner stays null (no land-grab). Idempotent: Voters that
// already have a personId are skipped, so a re-run resumes / re-sweeps.
//
// uid keying: existing Voters have no recorded uidSource (it's a new field), so by
// default the backfill dedups on (registeredState, stateVoterId) only — uid keys
// get added later as orgs re-import under uidSource-configured profiles. If ALL
// existing data is from a single vendor, pass --uid-source=<name> to also key on
// uid now (and backfill Voter.uidSource).
//
// Usage:
//   node src/migrations/migratePersons.js                         # DRY RUN (projection, no writes)
//   node src/migrations/migratePersons.js --apply                 # svid-only dedup
//   node src/migrations/migratePersons.js --apply --uid-source=i360
// Run --apply BEFORE deploying the build that registers Person's unique indexes,
// then re-run --apply AFTER deploy to re-link any Voters created in the meantime.

const APPLY = process.argv.includes('--apply');
const uidSourceArg = process.argv.find((a) => a.startsWith('--uid-source='));
const UID_SOURCE = uidSourceArg ? uidSourceArg.split('=')[1] : null;
const BATCH = 2000;

function deriveKeys(voter, householdState) {
  return normalizePersonKeys({
    uidSource: UID_SOURCE && voter.uid ? UID_SOURCE : null,
    uid: voter.uid,
    registeredState: voter.registeredState || householdState || null,
    stateVoterId: voter.stateVoterId,
  });
}

async function loadHouseholdStates() {
  const map = new Map();
  const cur = Household.find({}, { _id: 1, state: 1 }).lean().cursor();
  for await (const h of cur) map.set(String(h._id), h.state || null);
  return map;
}

// DRY RUN: project the result with union-find over the match keys — no writes.
async function dryRun(hhState) {
  const parent = new Map();
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) { const nx = parent.get(x); parent.set(x, root); x = nx; }
    return root;
  };
  const union = (a, b) => { add(a); add(b); const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  let voters = 0;
  let keyless = 0;
  let stateMissing = 0;
  const keyedVoters = []; // [node, orgId]
  const cur = Voter.find(
    { personId: null },
    { organizationId: 1, uid: 1, registeredState: 1, stateVoterId: 1, householdId: 1 }
  ).lean().cursor();
  for await (const v of cur) {
    voters++;
    const k = deriveKeys(v, hhState.get(String(v.householdId)));
    const hasUid = !!(k.uidSource && k.uid);
    const hasSvid = !!(k.registeredState && k.stateVoterId);
    if (!hasUid && !hasSvid) { if (k.stateVoterId) stateMissing++; else keyless++; continue; }
    const uNode = hasUid ? `u:${k.uidSource} ${k.uid}` : null;
    const sNode = hasSvid ? `s:${k.registeredState} ${k.stateVoterId}` : null;
    if (uNode) add(uNode);
    if (sNode) add(sNode);
    if (uNode && sNode) union(uNode, sNode);
    keyedVoters.push([uNode || sNode, String(v.organizationId)]);
  }

  const compOrgs = new Map();
  const compCount = new Map();
  for (const [node, org] of keyedVoters) {
    const r = find(node);
    if (!compOrgs.has(r)) { compOrgs.set(r, new Set()); compCount.set(r, 0); }
    compOrgs.get(r).add(org);
    compCount.set(r, compCount.get(r) + 1);
  }
  const keyedPersons = compOrgs.size;
  let crossOrgPersons = 0;
  let dedupCollapsed = 0;
  for (const [r, orgs] of compOrgs) {
    if (orgs.size > 1) crossOrgPersons++;
    dedupCollapsed += compCount.get(r) - 1;
  }

  console.log('\nDRY RUN projection (no writes):');
  console.log(`  voters to process:                    ${voters}`);
  console.log(`  → projected persons:                  ${keyedPersons + keyless + stateMissing}`);
  console.log(`     keyed (uid/svid):                  ${keyedPersons}`);
  console.log(`     keyless (no usable key):           ${keyless}`);
  console.log(`     state-missing (svid, no state):    ${stateMissing}`);
  console.log(`  voters deduped into existing persons: ${dedupCollapsed}`);
  console.log(`  cross-org persons (span 2+ orgs):     ${crossOrgPersons}`);
  console.log(`  uid keying: ${UID_SOURCE ? `ON (uidSource='${UID_SOURCE}')` : 'OFF (svid-only; uid keys added on later imports)'}`);
  console.log('  NOTE: approximate where a uid and svid disagree (--apply raises a review candidate, does not merge).');
}

// APPLY: resolve each Voter to a Person and link it.
async function apply(hhState) {
  let processed = 0;
  let linked = 0;
  let ops = [];
  // Most-recent-wins seeding: newest-updated Voters first, so each match group's
  // Person is created (identity seeded) from its most recent row.
  const cur = Voter.find({ personId: null })
    .sort({ updatedAt: -1 })
    .allowDiskUse(true)
    .select({
      organizationId: 1, uid: 1, registeredState: 1, stateVoterId: 1, householdId: 1,
      firstName: 1, lastName: 1, fullName: 1, phone: 1, phoneType: 1, cellPhone: 1,
      party: 1, gender: 1, dateOfBirth: 1, registrationStatus: 1,
    })
    .lean()
    .cursor();

  for await (const v of cur) {
    const keys = deriveKeys(v, hhState.get(String(v.householdId)));
    const identity = {
      firstName: v.firstName, lastName: v.lastName, fullName: v.fullName,
      phone: v.phone, phoneType: v.phoneType, cellPhone: v.cellPhone,
      party: v.party, gender: v.gender, dateOfBirth: v.dateOfBirth,
      registrationStatus: v.registrationStatus,
    };
    const { person } = await resolvePerson(keys, identity, { source: 'backfill' });
    const set = { personId: person._id };
    if (UID_SOURCE && v.uid) set.uidSource = UID_SOURCE;
    ops.push({ updateOne: { filter: { _id: v._id }, update: { $set: set } } });
    processed++;
    if (ops.length >= BATCH) {
      const r = await Voter.bulkWrite(ops, { ordered: false });
      linked += r.modifiedCount || 0;
      ops = [];
      if (processed % 20000 === 0) console.log(`  …${processed} processed`);
    }
  }
  if (ops.length) {
    const r = await Voter.bulkWrite(ops, { ordered: false });
    linked += r.modifiedCount || 0;
  }

  // Build the Person* unique indexes now — after dedup, with keys populated. All four
  // collections (autoIndex is off in prod), not just the two the backfill writes to.
  console.log('Syncing Person indexes (after dedup)…');
  await Person.syncIndexes();
  await PersonMergeCandidate.syncIndexes();
  await PersonEditProposal.syncIndexes();
  await PersonMergeLog.syncIndexes();

  const persons = await Person.countDocuments({ mergedInto: null });
  const candidates = await PersonMergeCandidate.countDocuments({ status: 'open' });
  console.log('\nAPPLIED:');
  console.log(`  voters linked:   ${linked}/${processed}`);
  console.log(`  persons created: ${persons}`);
  console.log(`  open candidates: ${candidates}`);
  console.log(`  uid keying: ${UID_SOURCE ? `ON ('${UID_SOURCE}')` : 'OFF (svid-only)'}`);
}

async function main() {
  // Never auto-build Person's unique indexes on connect — we build them via
  // syncIndexes() AFTER the backfill dedups (see config/db.js for the prod default).
  mongoose.set('autoIndex', false);
  await connectDb(process.env.MONGODB_URI);

  const total = await Voter.countDocuments({});
  const pending = await Voter.countDocuments({ personId: null });
  console.log(`Voters: ${total} total · ${pending} unlinked · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (!pending) {
    console.log('Nothing to backfill.');
    await mongoose.disconnect();
    return;
  }

  const hhState = await loadHouseholdStates();
  console.log(`Loaded ${hhState.size} household states for derivation.`);

  if (APPLY) await apply(hhState);
  else await dryRun(hhState);

  console.log(APPLY ? '\nPersons backfill applied.' : '\nDry run — re-run with --apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
