import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';

// Switch an org's team surfaces on.
//
//   npm run repair:team-stamps                          # READ-ONLY: list any org whose team surfaces are off
//   npm run repair:team-stamps -- --apply --ready-only  # switch them on; touches no ledger rows
//   ...add --org=<slug> to scope either to one organization.
//
// THE GATE. Organization.teamAttributionReadyAt used to be written only by
// migrate:activity-coordinator, at a point BELOW two `continue` guards — so an org with nothing to
// backfill (which includes every org created after that release) never got the flag and silently
// showed no team surfaces at all. Organization.js now defaults it for new orgs; this switches it on
// for any org that predates the fix.
//
// THE CREW CHECKS THAT USED TO LIVE HERE moved into `npm run audit:team-counts` (read-only, per
// campaign). This tool was built for the old organization-wide crew (Membership.coordinatorId): it
// printed "nothing to move" over per-campaign drift, and its --apply re-stamped with no hold and no
// check of what the crew was, so it could overwrite a change made while it ran. Fixes are now made on
// the campaign's Team page with Finish it, which runs the same crew job as every change
// (services/memberships/setCoordinator.js). Any other flags print where the checks went and write
// nothing.
const APPLY = process.argv.includes('--apply');
const READY_ONLY = process.argv.includes('--ready-only');
const OTHER_FLAGS = process.argv.slice(2).some((a) => a.startsWith('--') && !a.startsWith('--org=') && a !== '--ready-only' && a !== '--apply');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;
const POINTER =
  'The crew checks are now in `npm run audit:team-counts` (read-only). Fixes are made on the Team page with Finish it.';

const orgScope = async () => {
  if (!ORG_SLUG) return Organization.find({}, 'name slug teamAttributionReadyAt').lean();
  const org = await Organization.findOne({ slug: ORG_SLUG }, 'name slug teamAttributionReadyAt').lean();
  if (!org) {
    console.error(`No organization with slug "${ORG_SLUG}".`);
    process.exit(1);
  }
  return [org];
};

const main = async () => {
  if (OTHER_FLAGS || (APPLY && !READY_ONLY)) {
    console.log(POINTER);
    console.log('Nothing was written. To switch team surfaces on: npm run repair:team-stamps -- --apply --ready-only');
    return;
  }
  await connectDb(process.env.MONGODB_URI);
  const off = (await orgScope()).filter((o) => !o.teamAttributionReadyAt);
  for (const o of off) console.log(`${o.name}: team surfaces are switched OFF (teamAttributionReadyAt unset)`);
  if (APPLY && READY_ONLY) {
    for (const o of off) {
      await Organization.updateOne({ _id: o._id }, { $set: { teamAttributionReadyAt: new Date() } });
      console.log(`${o.name}: team surfaces switched ON`);
    }
    console.log('No ledger rows were examined.');
  } else if (off.length) {
    console.log('\nSwitch them on with: npm run repair:team-stamps -- --apply --ready-only');
  } else {
    console.log('Every organization in scope has its team surfaces switched on.');
  }
  console.log(POINTER);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
