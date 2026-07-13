import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';

// Backfill CanvassActivity.coordinatorId / SurveyResponse.coordinatorId — the TEAM each door and
// survey belongs to — from each canvasser's CURRENT Membership.coordinatorId.
//
//   node src/migrations/migrateActivityCoordinator.js --preflight   # READ-ONLY audit. Run FIRST.
//   node src/migrations/migrateActivityCoordinator.js               # dry run — what would change
//   node src/migrations/migrateActivityCoordinator.js --apply       # commit
//   ...add --org=<slug> to scope any of the above to one organization.
//
// Re-runnable and idempotent.
//
// ── The honest limit ────────────────────────────────────────────────────────────────────────────
// There is NO historical record of team membership — none exists to recover. This stamps history
// with TODAY's teams. For a canvasser who never changed coordinators that is exactly right. For one
// who HAS moved teams, their old doors get their new team. From the moment the write-path stamp
// ships, history is frozen and correct going forward; this is the one and only approximation.
//
// ── Two traps this script is built around ───────────────────────────────────────────────────────
// 1. The idempotency key is `{ coordinatorId: { $exists: false } }`, NEVER `{ coordinatorId: null }`.
//    In Mongo, `{field: null}` ALSO matches documents where the field is ABSENT. Keying on null
//    would, on a second run, re-stamp rows whose coordinator is DELIBERATELY null — a candidate
//    knocking their own district, an admin's bulk marks — and hand them to a team. The migration
//    would silently reintroduce the very bug it exists to fix.
// 2. A half-finished backfill is silently wrong AND plausible-looking: unstamped rows are invisible
//    to `coordinatorId: <team>` yet get swallowed by the No-coordinator bucket. So the run stamps
//    `Organization.teamAttributionReadyAt` only on a clean completion, and the reporting UI refuses
//    to show team numbers until it is set.
const APPLY = process.argv.includes('--apply');
const PREFLIGHT = process.argv.includes('--preflight');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;

const CHUNK = 1000;

async function orgScope() {
  if (!ORG_SLUG) return Organization.find({}, 'name slug').lean();
  const org = await Organization.findOne({ slug: ORG_SLUG }, 'name slug').lean();
  if (!org) {
    console.error(`No organization with slug "${ORG_SLUG}".`);
    process.exit(1);
  }
  return [org];
}

// READ-ONLY. Every canvasser who has ever knocked in this org, and whether a team can still be
// resolved for them. This is the question the whole feature rests on, and it is answered BEFORE a
// single byte is written — while there is still someone to ask about anyone unresolvable.
async function preflight(orgs) {
  console.log('PREFLIGHT — read-only. Nothing will be written.\n');
  let unresolvable = 0;

  for (const org of orgs) {
    const userIds = await CanvassActivity.distinct('userId', { organizationId: org._id });
    if (!userIds.length) continue;

    const [users, memberships] = await Promise.all([
      User.find({ _id: { $in: userIds } }, 'firstName lastName email deletedAt').lean(),
      Membership.find({ organizationId: org._id, userId: { $in: userIds } }, 'userId coordinatorId').lean(),
    ]);
    const uById = new Map(users.map((u) => [String(u._id), u]));
    const mById = new Map(memberships.map((m) => [String(m.userId), m]));

    const coordIds = [...new Set(memberships.map((m) => m.coordinatorId).filter(Boolean).map(String))];
    const coords = await User.find({ _id: { $in: coordIds } }, 'firstName lastName').lean();
    const cById = new Map(coords.map((c) => [String(c._id), `${c.firstName} ${c.lastName}`.trim()]));

    console.log(`${org.name} (${org.slug})`);
    for (const uid of userIds.map(String)) {
      const u = uById.get(uid);
      const m = mById.get(uid);
      const knocks = await CanvassActivity.countDocuments({ organizationId: org._id, userId: uid });
      const who = u ? `${u.firstName} ${u.lastName}` : `(unknown user ${uid})`;

      if (!m) {
        // Removal from the ORG hard-deletes the Membership, taking the coordinator with it. This
        // is unrecoverable from data — it needs a human to say who they belonged to.
        console.log(`  ⚠ ${who} — ${knocks} knocks — NO MEMBERSHIP: team cannot be resolved`);
        unresolvable += 1;
      } else if (!m.coordinatorId) {
        console.log(`  · ${who} — ${knocks} knocks — no coordinator (stays in the "No team" bucket)`);
      } else {
        const team = cById.get(String(m.coordinatorId)) || String(m.coordinatorId);
        console.log(`  ✓ ${who} — ${knocks} knocks — → ${team}`);
      }
    }
    console.log('');
  }

  if (unresolvable) {
    console.log(
      `⚠ ${unresolvable} canvasser(s) have knocks but NO org membership, so no team can be resolved\n` +
        `  for them. Their doors will land in the "No team" bucket. If they belonged to a team, that\n` +
        `  link was destroyed when they were removed from the org and cannot be recovered from data.\n`
    );
  } else {
    console.log('✓ Every canvasser with knocks resolves to a team (or to a deliberate "no team").\n');
  }
  console.log('Re-run without --preflight to see what the backfill would change.');
}

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const orgs = await orgScope();

  if (PREFLIGHT) {
    await preflight(orgs);
    await mongoose.disconnect();
    return;
  }

  console.log(
    `${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}${ORG_SLUG ? ` · org ${ORG_SLUG}` : ''}\n`
  );
  console.log(
    'NOTE: history has no record of past team membership, so this stamps TODAY\'s teams onto ALL\n' +
      '      history. Correct for anyone who never changed coordinators; an approximation for anyone\n' +
      '      who did. Going forward, every new knock freezes its own team at the moment it happens.\n'
  );

  let totalActivities = 0;
  let totalSurveys = 0;

  for (const org of orgs) {
    // Only members who actually HAVE a coordinator. A member with none is left alone: their rows
    // stay unstamped and read as "No team", which is already the right answer for them.
    const withCoord = await Membership.find(
      { organizationId: org._id, coordinatorId: { $ne: null } },
      'userId coordinatorId'
    ).lean();
    if (!withCoord.length) continue;

    const ops = withCoord.map((m) => ({
      updateMany: {
        // $exists:false — NOT null. See the header. This only ever touches rows that were never
        // stamped, so a deliberate null is never overwritten and a re-run is a no-op.
        filter: {
          organizationId: org._id,
          userId: m.userId,
          coordinatorId: { $exists: false },
        },
        update: { $set: { coordinatorId: m.coordinatorId } },
      },
    }));

    let orgActivities = 0;
    let orgSurveys = 0;
    for (const m of withCoord) {
      const [a, s] = await Promise.all([
        CanvassActivity.countDocuments({
          organizationId: org._id,
          userId: m.userId,
          coordinatorId: { $exists: false },
        }),
        SurveyResponse.countDocuments({
          organizationId: org._id,
          userId: m.userId,
          coordinatorId: { $exists: false },
        }),
      ]);
      orgActivities += a;
      orgSurveys += s;
    }

    if (!orgActivities && !orgSurveys) continue;
    console.log(
      `${org.name}: ${APPLY ? 'stamping' : 'would stamp'} ${orgActivities} activit(ies) + ` +
        `${orgSurveys} survey(s) across ${withCoord.length} member(s)`
    );

    if (APPLY) {
      for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        await CanvassActivity.bulkWrite(slice, { ordered: false });
        await SurveyResponse.bulkWrite(slice, { ordered: false });
      }
      // Only NOW is a team number trustworthy for this org. The reporting UI gates on this.
      await Organization.updateOne(
        { _id: org._id },
        { $set: { teamAttributionReadyAt: new Date() } }
      );
    }

    totalActivities += orgActivities;
    totalSurveys += orgSurveys;
  }

  console.log(
    `\n${APPLY ? 'Stamped' : 'Would stamp'}: ${totalActivities} activities, ${totalSurveys} surveys.`
  );
  console.log('Knock history rewritten: NONE — this only adds a team tag to existing rows.');
  if (!APPLY) console.log('\nDry run — re-run with --apply to commit.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
