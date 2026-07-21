import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { CoordinatorChange } from '../models/CoordinatorChange.js';
import { previewRestamp, restampLedgerCoordinator } from '../services/memberships/restampCoordinator.js';

// Bring the knock ledger's TEAM tag into line with every member's CURRENT coordinator.
//
//   npm run repair:team-stamps -- --preflight        # READ-ONLY audit. Run FIRST.
//   npm run repair:team-stamps                       # dry run — what would change
//   npm run repair:team-stamps -- --apply            # commit
//   npm run repair:team-stamps -- --apply --ready-only  # set the gate flag only, touch no rows
//   ...add --org=<slug> to scope any of the above to one organization.
//
// Three jobs, one script:
//
// 1. DAY-ONE CONFORMANCE. The rule "the current coordinator owns all of that canvasser's history"
//    only applies itself to people whose coordinator is edited after deploy. Existing history keeps
//    whatever the old frozen-on-the-knock behavior left. Running this once at deploy makes the
//    documented invariant true for everyone immediately.
// 2. DRIFT REPAIR. setMemberCoordinator writes Membership first and the ledger second (see the
//    ordering note there). If the ledger write ever fails, the drift is finite and shrinking and
//    THIS is what closes it. Compensation is a re-run, not a rollback.
// 3. THE GATE FIX. Organization.teamAttributionReadyAt used to be written only by
//    migrate:activity-coordinator, at a point BELOW two `continue` guards — so an org with nothing
//    to backfill (which includes every org created after that release) never got the flag and
//    silently showed no team surfaces at all. Organization.js now defaults it for new orgs; this
//    fixes the ones that already exist, and sets it UNCONDITIONALLY, above any `continue`, so the
//    flag hangs off "this script completed for this org" rather than "it found something to write".
//
// It calls the SAME restampLedgerCoordinator the routes call. An audit that can be wrong in the
// same way as the thing it audits is worth nothing.
//
// ⚠️ ONE DELIBERATE ASYMMETRY vs. the live path: this script only ever moves history ONTO a real
// coordinator, never down to "No team". See the guard in scanOrg — bulk-clearing a team is
// indistinguishable from a departure, and would undo the protection that keeps a departed
// coordinator's crew on their team.
//
// Idempotent: a second run reports 0 everywhere, because restampFilter only matches rows whose
// coordinatorId already differs from the target.
const APPLY = process.argv.includes('--apply');
const PREFLIGHT = process.argv.includes('--preflight');
const READY_ONLY = process.argv.includes('--ready-only');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;

const orgScope = async () => {
  if (!ORG_SLUG) return Organization.find({}, 'name slug teamAttributionReadyAt').lean();
  const org = await Organization.findOne({ slug: ORG_SLUG }, 'name slug teamAttributionReadyAt').lean();
  if (!org) {
    console.error(`No organization with slug "${ORG_SLUG}".`);
    process.exit(1);
  }
  return [org];
};

const nameOf = (u) => (u ? `${u.firstName} ${u.lastName}`.trim() : 'No team');

// Every member of the org and what their ledger would look like under the current rule. Shared by
// the preflight, the dry run and the apply, so the three can never disagree about the numbers.
const scanOrg = async (org) => {
  const members = await Membership.find({ organizationId: org._id }, 'userId coordinatorId').lean();
  const userIds = [...new Set(members.flatMap((m) => [m.userId, m.coordinatorId].filter(Boolean).map(String)))];
  const users = await User.find({ _id: { $in: userIds } }, 'firstName lastName').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rows = [];
  for (const m of members) {
    // ⚠️ NEVER re-stamp a real coordinator DOWN TO null in bulk. That combination — the ledger
    // names a team, the membership names nobody — is the exact signature of a DEPARTURE:
    // deleteAccount clears the crew's Membership.coordinatorId when their coordinator leaves the
    // org, deliberately leaving the ledger alone so the departed coordinator's team keeps the
    // doors it supervised. "Conforming" those rows would empty that team into the No-team bucket
    // admins exclude — the original 104-door under-report, reintroduced by the repair tool meant
    // to prevent drift. (Caught by running --preflight against a fixture where a coordinator had
    // just left: it proposed moving their crew's 12 doors to No team.)
    //
    // A deliberate clear made through the console DOES move history — the admin saw the door count
    // and confirmed it. This script simply can't tell the two apart from the data, so it declines
    // the destructive direction and leaves those rows where they are.
    if (!m.coordinatorId) continue;

    const counts = await previewRestamp({
      organizationId: org._id,
      userId: m.userId,
      coordinatorId: m.coordinatorId,
    });
    if (!counts.activities && !counts.surveys) continue;
    rows.push({
      userId: m.userId,
      coordinatorId: m.coordinatorId,
      who: nameOf(byId.get(String(m.userId))),
      toTeam: nameOf(m.coordinatorId ? byId.get(String(m.coordinatorId)) : null),
      ...counts,
    });
  }
  return rows;
};

const main = async () => {
  await connectDb(process.env.MONGODB_URI);
  const orgs = await orgScope();

  if (PREFLIGHT) {
    console.log('PREFLIGHT — read-only. Nothing will be written.\n');
    let totalDoors = 0;
    for (const org of orgs) {
      const rows = await scanOrg(org);
      const gate = org.teamAttributionReadyAt ? 'ready' : '⚠️  NOT READY (team surfaces hidden)';
      console.log(`${org.name} [${gate}]`);
      if (!rows.length) {
        console.log('  nothing to move — every row already matches its member\'s current coordinator');
      }
      for (const r of rows) {
        console.log(
          `  ${r.who} → ${r.toTeam}: ${r.doors} door(s) ` +
            `(${r.activities} activity row(s), ${r.surveys} survey row(s))`
        );
        totalDoors += r.doors;
      }
      console.log('');
    }
    console.log(`Total doors that would change team: ${totalDoors}`);
    console.log('\nReview this list before running --apply. Team numbers WILL move for these people.');
    await mongoose.disconnect();
    return;
  }

  let totalActivities = 0;
  let totalSurveys = 0;

  for (const org of orgs) {
    // UNCONDITIONAL and ABOVE any early-exit. This is the structural fix for the original gate bug.
    if (APPLY && !org.teamAttributionReadyAt) {
      await Organization.updateOne(
        { _id: org._id },
        { $set: { teamAttributionReadyAt: new Date() } }
      );
      console.log(`${org.name}: team surfaces ENABLED (teamAttributionReadyAt was unset)`);
    }
    if (READY_ONLY) continue;

    const rows = await scanOrg(org);
    if (!rows.length) continue;

    console.log(
      `${org.name}: ${APPLY ? 'moving' : 'would move'} ${rows.reduce((n, r) => n + r.doors, 0)} ` +
        `door(s) across ${rows.length} member(s)`
    );

    for (const r of rows) {
      console.log(`  ${r.who} → ${r.toTeam}: ${r.doors} door(s)`);
      if (!APPLY) {
        totalActivities += r.activities;
        totalSurveys += r.surveys;
        continue;
      }
      const moved = await restampLedgerCoordinator({
        organizationId: org._id,
        userId: r.userId,
        coordinatorId: r.coordinatorId,
      });
      await CoordinatorChange.create({
        organizationId: org._id,
        userId: r.userId,
        // The ledger held a MIX of stale values, so there is no single "from" to record. null here
        // means "various / unknown", which is honest; the per-row detail is the counts.
        fromCoordinatorId: null,
        toCoordinatorId: r.coordinatorId,
        byUserId: null,
        source: 'repair',
        activitiesMoved: moved.activities,
        surveysMoved: moved.surveys,
      });
      totalActivities += moved.activities;
      totalSurveys += moved.surveys;
    }
  }

  if (READY_ONLY) {
    console.log(`\n${APPLY ? 'Gate flag set where missing.' : 'Dry run — re-run with --apply to commit.'}`);
    console.log('No ledger rows were examined (--ready-only).');
  } else {
    console.log(
      `\n${APPLY ? 'Re-stamped' : 'Would re-stamp'}: ${totalActivities} activities, ${totalSurveys} surveys.`
    );
    console.log('Knocks created or deleted: NONE — this only changes which TEAM each row counts for.');
    console.log('Campaign totals, coverage, rates and invoices are unaffected (billing is team-blind).');
    if (!APPLY) console.log('\nDry run — re-run with --apply to commit.');
  }

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
