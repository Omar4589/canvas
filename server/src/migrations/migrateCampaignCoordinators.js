import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { Membership } from '../models/Membership.js';
import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { CanvassActivity } from '../models/CanvassActivity.js';

// Seed the per-campaign crew (CampaignAssignment.coordinatorId) from the old org-level one
// (Membership.coordinatorId).
//
//   npm run migrate:campaign-coordinators -- --preflight   # READ-ONLY. Run FIRST.
//   npm run migrate:campaign-coordinators                  # dry run — what would change
//   npm run migrate:campaign-coordinators -- --apply       # commit
//   ...add --org=<slug> to scope any of the above to one organization.
//
// ── What it does, and what it deliberately does NOT ──────────────────────────────────────────────
// A crew used to be one value per {user, org}. It is now one value per {user, campaign}, because
// the same canvasser can work two races under two different coordinators. This copies the single
// old value onto every roster row that person holds, so the day after the migration every campaign
// answers exactly what the org used to answer — and from then on the answers can diverge.
//
// It writes ONLY CampaignAssignment. Not one CanvassActivity, not one SurveyResponse. That is the
// property that makes it re-runnable and reversible-by-doing-nothing: every frozen team stamp stays
// exactly where it is, so no door changes hands as a result of running this.
//
// ── The honest limit, which is NOT the same as "counts cannot move" ──────────────────────────────
// Per-TEAM rows can still move after the deploy this migration accompanies, for a reason that has
// nothing to do with the copy above: the report's lead set (routes/admin/reports.js leadIdsForScope)
// is now derived per campaign from the ledger. Somebody who runs a crew in one campaign and knocks
// in another WITHOUT a crew there no longer folds onto their own team in the second campaign — they
// land in "No team", which is the per-campaign answer. The campaign's own billable total is
// team-blind and cannot move. Verify with `npm run audit:team-counts` before and after, comparing
// per-team ROWS, not just the totals.
//
// The old field is deliberately left in place. Dropping Membership.coordinatorId is a separate,
// later step: keeping it means that if a per-team row moves unexpectedly, the value it moved FROM
// is still on disk to compare against.
const APPLY = process.argv.includes('--apply');
const PREFLIGHT = process.argv.includes('--preflight');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;

const n = (v) => (v || 0).toLocaleString();

async function resolveOrgs() {
  if (!ORG_SLUG) return Organization.find({}, '_id name slug').lean();
  const org = await Organization.findOne({ slug: ORG_SLUG }, '_id name slug').lean();
  if (!org) {
    console.error(`No organization with slug "${ORG_SLUG}".`);
    process.exit(1);
  }
  return [org];
}

// READ-ONLY. The two things worth knowing before writing anything.
async function preflightOrg(org) {
  const withCrew = await Membership.find(
    { organizationId: org._id, coordinatorId: { $ne: null } },
    'userId coordinatorId'
  ).lean();
  const rosterRows = await CampaignAssignment.countDocuments({ organizationId: org._id });

  // ORPHANS: people with knocks in a campaign they hold no roster row for — removed from the
  // campaign, or an admin handed a book on the fly. Their history keeps the team already frozen on
  // it (the departure rule), but there is no roster row for this migration to seed, and no future
  // crew change can reach them. Worth naming rather than discovering later.
  const campaigns = await Campaign.find({ organizationId: org._id }, '_id name').lean();
  const orphans = [];
  for (const c of campaigns) {
    const [knocked, rostered] = await Promise.all([
      CanvassActivity.distinct('userId', { campaignId: c._id }),
      CampaignAssignment.distinct('userId', { campaignId: c._id }),
    ]);
    const have = new Set(rostered.map(String));
    const missing = knocked.map(String).filter((u) => !have.has(u));
    if (missing.length) orphans.push({ campaign: c.name, count: missing.length });
  }

  console.log(`\n── ${org.name} (${org.slug})`);
  console.log(`   members with a crew today : ${n(withCrew.length)}`);
  console.log(`   campaign roster rows      : ${n(rosterRows)}`);
  if (orphans.length) {
    console.log(`   knocked-but-not-rostered  :`);
    for (const o of orphans) console.log(`       ${o.campaign}: ${n(o.count)} canvasser(s)`);
    console.log(
      `     (their doors keep the team frozen on them — nothing to seed, nothing lost)`
    );
  } else {
    console.log(`   knocked-but-not-rostered  : none`);
  }
  return withCrew.length;
}

async function migrateOrg(org) {
  const withCrew = await Membership.find(
    { organizationId: org._id, coordinatorId: { $ne: null } },
    'userId coordinatorId'
  ).lean();
  if (!withCrew.length) {
    console.log(`── ${org.name}: nobody has a crew — nothing to seed.`);
    return 0;
  }

  // Only rows that do NOT already carry a crew, so a second run is a no-op and — more importantly —
  // a crew already set per-campaign (by a lead, after the deploy) is never overwritten by the stale
  // org-level value. Keying on `null` rather than `$exists:false` is right HERE, unlike the ledger
  // backfill: an unset roster row means "no crew chosen", not "deliberately no crew", because
  // nothing has ever been able to choose one.
  const ops = withCrew.map((m) => ({
    updateMany: {
      filter: { organizationId: org._id, userId: m.userId, coordinatorId: null },
      update: { $set: { coordinatorId: m.coordinatorId } },
    },
  }));

  if (!APPLY) {
    let would = 0;
    for (const m of withCrew) {
      would += await CampaignAssignment.countDocuments({
        organizationId: org._id,
        userId: m.userId,
        coordinatorId: null,
      });
    }
    console.log(`── ${org.name}: would seed ${n(would)} roster row(s) from ${n(withCrew.length)} member(s).`);
    return would;
  }

  const res = await CampaignAssignment.bulkWrite(ops, { ordered: false });
  const moved = res.modifiedCount || 0;
  console.log(`── ${org.name}: seeded ${n(moved)} roster row(s).`);
  return moved;
}

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const orgs = await resolveOrgs();

  if (PREFLIGHT) {
    console.log('PREFLIGHT — read-only. Nothing will be written.');
    for (const org of orgs) await preflightOrg(org);
    console.log(
      '\nNext: run without flags for a dry run, then with --apply. Run audit:team-counts before\n' +
      'and after and compare PER-TEAM ROWS — the campaign totals are team-blind and cannot move,\n' +
      'so they will agree either way and prove nothing.'
    );
    await mongoose.disconnect();
    return;
  }

  console.log(APPLY ? 'APPLYING.' : 'DRY RUN — nothing will be written. Add --apply to commit.');
  let total = 0;
  for (const org of orgs) total += await migrateOrg(org);
  console.log(
    APPLY
      ? `\n✓ Seeded ${n(total)} roster row(s). No ledger row was touched.`
      : `\nWould seed ${n(total)} roster row(s). No ledger row would be touched.`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
