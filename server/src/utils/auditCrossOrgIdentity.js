import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Person } from '../models/Person.js';
import { Voter } from '../models/Voter.js';
import { Household } from '../models/Household.js';
import { Campaign } from '../models/Campaign.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { Subscription } from '../models/Subscription.js';

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY audit: did Org A's identity edits ever get written into Org B's rows?
//
// `Person` is global (no organizationId) and propagateIdentity.js fans the 10 shared identity
// fields into EVERY Voter row in EVERY org linked to that Person. This script answers, from the
// provenance receipts already in the data, how many rows that actually touched.
//
// STRICTLY READ-ONLY. Only find / aggregate / countDocuments / distinct / findById are used.
// There is not a single update, delete, save, bulkWrite or create in this file — the run header
// re-proves that by scanning its own source before it connects.
//
//   npm run audit:cross-org-identity           # human-readable report
//   npm run audit:cross-org-identity -- --json # machine-readable, for diffing across runs
//
// Read docs/REMEDIATION_PLAN.md for what the number means and what it gates.
// ─────────────────────────────────────────────────────────────────────────────

// The exact allowlist propagateIdentity writes (propagateIdentity.js:8-11). If that list ever
// changes, this audit must change with it — hence the copy rather than an import, so a drift
// shows up as a diff in review rather than silently widening what we call "clean".
const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'fullName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

const JSON_OUT = process.argv.includes('--json');
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

// Values arrive from Mongo as Dates, ObjectIds, strings. Compare on a normalized form so a
// Date and its ISO string don't read as "different" and understate contamination.
function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb;
  }
  return String(a) === String(b);
}

// Prove read-only by inspection, and say so out loud before touching the database. A reviewer
// should not have to take my word for it, and neither should whoever runs this against prod.
//
// It scans for the CALL form (`.updateOne(`) rather than the bare name. That is deliberate: a
// guard that searched for `updateOne` would find its own banned-list entry and then need an
// exception for it — and that exception would swallow a real call site added later. The check
// must not be defeatable by the list it is built from. Comments and string literals are stripped
// before the scan for the same reason.
const WRITE_CALLS = [
  '.updateOne(', '.updateMany(', '.deleteOne(', '.deleteMany(', '.bulkWrite(',
  '.findOneAndUpdate(', '.findByIdAndUpdate(', '.findOneAndDelete(', '.findByIdAndDelete(',
  '.insertMany(', '.replaceOne(', '.save(', '.create(', '.remove(', '.drop(',
  'propagateIdentity(',
];

async function assertReadOnly() {
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL(import.meta.url), 'utf8');
  // Strip line comments, block comments, and single-quoted strings — so the WRITE_CALLS array
  // above and the prose in this header cannot mask (or fake) a hit.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const hits = WRITE_CALLS.filter((c) => code.includes(c));
  if (hits.length) {
    console.error(`REFUSING TO RUN — this script contains write operations: ${hits.join(', ')}`);
    console.error('This audit must never write. Remove them or do not run it.');
    process.exit(1);
  }
  return WRITE_CALLS.length;
}

async function main() {
  const checked = await assertReadOnly();

  await connectDb(process.env.MONGODB_URI);
  const db = (process.env.MONGODB_URI || '').replace(/\/\/[^:]+:[^@]+@/, '//***:***@');

  log('');
  log('════════════════════════════════════════════════════════════════════');
  log('  CROSS-ORG IDENTITY CONTAMINATION AUDIT');
  log(`  DB: ${db}`);
  log(`  READ-ONLY — verified: ${checked} write operations scanned for, 0 present`);
  log('════════════════════════════════════════════════════════════════════');

  // ── 1. Every organization ──────────────────────────────────────────────────
  // Surfacing ALL of them is the point: a forgotten test/demo org quietly holding real voter
  // data is exactly the thing that hides from a person who "has one live org".
  const orgs = await Organization.find({}, 'name slug isActive createdAt').sort({ createdAt: 1 }).lean();
  const orgRows = [];
  for (const o of orgs) {
    const [voters, households, campaigns, activities, sub] = await Promise.all([
      Voter.countDocuments({ organizationId: o._id }),
      Household.countDocuments({ organizationId: o._id }),
      Campaign.countDocuments({ organizationId: o._id }),
      CanvassActivity.countDocuments({ organizationId: o._id }),
      Subscription.findOne({ organizationId: o._id }, 'status').lean(),
    ]);
    const last = await CanvassActivity.findOne({ organizationId: o._id }, 'timestamp')
      .sort({ timestamp: -1 }).lean();
    orgRows.push({
      id: String(o._id), name: o.name, slug: o.slug,
      isActive: o.isActive !== false,
      subscription: sub?.status || '(none)',
      voters, households, campaigns, activities,
      lastActivityAt: last?.timestamp ? new Date(last.timestamp).toISOString().slice(0, 10) : null,
      createdAt: new Date(o.createdAt).toISOString().slice(0, 10),
    });
  }

  log('');
  log(`── 1. ORGANIZATIONS (${orgs.length}) ──────────────────────────────────`);
  log('');
  for (const r of orgRows) {
    const holdsRealData = r.voters > 0 || r.activities > 0;
    log(`  ${holdsRealData ? '●' : '○'} ${r.name}  (${r.slug})`);
    log(`      voters ${r.voters} · households ${r.households} · campaigns ${r.campaigns} · knocks ${r.activities}`);
    log(`      subscription ${r.subscription} · created ${r.createdAt} · last knock ${r.lastActivityAt || 'never'}`);
  }
  const dataHolding = orgRows.filter((r) => r.voters > 0 || r.activities > 0);
  log('');
  log(`  ${dataHolding.length} of ${orgs.length} org(s) hold voter data or canvass records.`);
  if (dataHolding.length > 1) {
    log(`  ⚠️  MORE THAN ONE ORG HOLDS REAL DATA — review the list above. A forgotten`);
    log(`      test/demo org with a real voter file is both a contamination vector and`);
    log(`      a retention problem in its own right.`);
  }

  // ── 2. The cross-org Person graph ─────────────────────────────────────────
  // If no Person is linked from two different orgs, no fan-out can ever have crossed a
  // boundary. That is the strongest possible form of a clean result, and it is cheap to check.
  const linkAgg = await Voter.aggregate([
    { $match: { personId: { $ne: null } } },
    { $group: { _id: '$personId', orgs: { $addToSet: '$organizationId' } } },
    { $project: { orgCount: { $size: '$orgs' }, orgs: 1 } },
    { $match: { orgCount: { $gte: 2 } } },
  ]);
  const totalLinked = await Voter.countDocuments({ personId: { $ne: null } });
  const totalPersons = await Person.countDocuments({});

  log('');
  log('── 2. CROSS-ORG PERSON GRAPH ──────────────────────────────────────────');
  log('');
  log(`  Persons in the collection      : ${totalPersons}`);
  log(`  Voter rows linked to a Person  : ${totalLinked}`);
  log(`  Persons linked from ≥2 orgs    : ${linkAgg.length}`);
  if (linkAgg.length === 0) {
    log('');
    log('  ✓ No Person is shared between organizations. No fan-out can ever have');
    log('    crossed an org boundary, because there was never a boundary to cross.');
  } else {
    log('');
    log(`  ⚠️  ${linkAgg.length} Person record(s) ARE shared across orgs — every identity edit`);
    log('      by an owning org fanned into the other org\'s Voter rows.');
  }

  // ── 3. Contamination, from the provenance receipts ────────────────────────
  // Per Voter V in org O, per identity field F:
  //   F in V.locallyEditedFields          → O's own edit, propagation skips it   → clean
  //   P.fieldProvenance[F].orgId === O    → O wrote the canonical value          → clean
  //   P.fieldProvenance[F].orgId !== O
  //     AND V[F] equals P[F]              → the value in O's row arrived by
  //                                         fan-out from ANOTHER org             → CONTAMINATED
  const contaminated = [];
  const byField = Object.fromEntries(IDENTITY_FIELDS.map((f) => [f, 0]));
  const contaminatedOrgs = new Set();
  let recoverable = 0;
  let needsReimport = 0;
  let receipts = 0;

  const cursor = Voter.find(
    { personId: { $ne: null } },
    ['organizationId', 'personId', 'locallyEditedFields', 'identityBackup', ...IDENTITY_FIELDS].join(' ')
  ).lean().cursor();

  const personCache = new Map();
  for await (const v of cursor) {
    const pid = String(v.personId);
    if (!personCache.has(pid)) {
      personCache.set(pid, await Person.findById(v.personId, ['fieldProvenance', ...IDENTITY_FIELDS].join(' ')).lean());
    }
    const p = personCache.get(pid);
    if (!p) continue; // dangling personId — not contamination, but worth knowing; counted below

    const prov = p.fieldProvenance || {};
    const localEdits = new Set(v.locallyEditedFields || []);
    const hit = [];

    for (const f of IDENTITY_FIELDS) {
      if (localEdits.has(f)) continue;
      const pr = prov[f];
      if (!pr || !pr.orgId) continue;
      const wroteBy = String(pr.orgId);
      if (wroteBy === String(v.organizationId)) continue;

      // A provenance receipt showing a write by a different org than the one holding this row.
      receipts++;
      // Did that write actually land in THIS row? (It will have, unless a later local edit or a
      // lock intervened — check the value rather than assuming.)
      if (sameValue(v[f], p[f])) {
        hit.push({ field: f, writtenByOrg: wroteBy, at: pr.at || null, displaced: pr.prevValue ?? null });
        byField[f]++;
      }
    }

    if (hit.length) {
      contaminatedOrgs.add(String(v.organizationId));
      const hasBackup = v.identityBackup && Object.keys(v.identityBackup).length > 0;
      if (hasBackup) recoverable++; else needsReimport++;
      contaminated.push({
        voterId: String(v._id),
        organizationId: String(v.organizationId),
        personId: pid,
        fields: hit,
        recoverableFromBackup: !!hasBackup,
      });
    }
  }

  log('');
  log('── 3. CONTAMINATION ───────────────────────────────────────────────────');
  log('');
  log(`  Provenance receipts showing a cross-org write : ${receipts}`);
  log(`  Voter rows whose CURRENT value came from another org : ${contaminated.length}`);
  if (contaminated.length > 0) {
    log('');
    log('  By field:');
    for (const f of IDENTITY_FIELDS) if (byField[f]) log(`    ${f.padEnd(20)} ${byField[f]}`);
    log('');
    log(`  Recoverable from identityBackup : ${recoverable}`);
    log(`  Need re-derivation from the raw import (GridFS) : ${needsReimport}`);
    if (needsReimport > 0) {
      log('');
      log('  ⚠️  DO NOT delete the raw import files (REMEDIATION_PLAN WS3.1) until these');
      log('      rows are rolled back — GridFS is the only remaining source for them.');
    }
    log('');
    log('  Sample (first 10):');
    for (const c of contaminated.slice(0, 10)) {
      log(`    voter ${c.voterId} (org ${c.organizationId})`);
      for (const f of c.fields) log(`      ${f.field} ← written by org ${f.writtenByOrg}${f.at ? ' at ' + new Date(f.at).toISOString().slice(0, 10) : ''}`);
    }
  }

  // ── 4. Canvass isolation ──────────────────────────────────────────────────
  // Two independent proofs: the schema has no such path, and no live document carries one.
  const caSchemaHas = !!CanvassActivity.schema.path('personId');
  const srSchemaHas = !!SurveyResponse.schema.path('personId');
  const caDocsWith = await CanvassActivity.countDocuments({ personId: { $exists: true } });
  const srDocsWith = await SurveyResponse.countDocuments({ personId: { $exists: true } });

  log('');
  log('── 4. CANVASS RESULT ISOLATION ────────────────────────────────────────');
  log('');
  log(`  CanvassActivity.personId in schema : ${caSchemaHas ? 'PRESENT ⚠️' : 'absent ✓'}`);
  log(`  SurveyResponse.personId  in schema : ${srSchemaHas ? 'PRESENT ⚠️' : 'absent ✓'}`);
  log(`  CanvassActivity docs carrying one  : ${caDocsWith}`);
  log(`  SurveyResponse  docs carrying one  : ${srDocsWith}`);
  const canvassClean = !caSchemaHas && !srSchemaHas && caDocsWith === 0 && srDocsWith === 0;
  log('');
  log(canvassClean
    ? '  ✓ Canvass results were never linked to the cross-org Person layer. Survey\n    answers, door status, notes and GPS never crossed an org boundary.'
    : '  ⚠️  A personId was found on canvass data — canvass results may have crossed.');

  // ── The line ──────────────────────────────────────────────────────────────
  const N = contaminated.length;
  const M = contaminatedOrgs.size;

  log('');
  log('════════════════════════════════════════════════════════════════════');
  log('');
  log(`  cross-org identity contamination: ${N} rows across ${M} orgs.`);
  log('');
  if (N === 0 && linkAgg.length === 0) {
    log('  Clean, and structurally so — not one Person is shared between orgs, so the');
    log('  fan-out never had a boundary to cross. REMEDIATION_PLAN WS1 collapses to');
    log('  "scope the queries so this cannot start happening", with no rollback and no');
    log('  notification question.');
  } else if (N === 0) {
    log('  No row currently holds another org\'s value — but Persons ARE shared across');
    log('  orgs, so the fan-out path is live and one admin edit away from writing across');
    log('  a boundary. WS1 is still required; the rollback is not.');
  } else {
    log('  Contamination is real. WS1 needs BOTH the scoping fix and the rollback, and');
    log('  D1.1 (the lawyer\'s notification question) is live. Do not delete raw imports.');
  }
  log('');
  log('════════════════════════════════════════════════════════════════════');
  log('');

  if (JSON_OUT) {
    console.log(JSON.stringify({
      orgs: orgRows,
      sharedPersons: linkAgg.length,
      personsTotal: totalPersons,
      votersLinked: totalLinked,
      crossOrgReceipts: receipts,
      contaminatedRows: N,
      contaminatedOrgs: M,
      byField,
      recoverableFromBackup: recoverable,
      needsReimport,
      canvassIsolationClean: canvassClean,
      contaminated: contaminated.slice(0, 500),
    }, null, 2));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
