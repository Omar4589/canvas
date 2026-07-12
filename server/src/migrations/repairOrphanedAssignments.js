import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { TurfAssignment } from '../models/TurfAssignment.js';
import { EffortMember } from '../models/EffortMember.js';

// Hand back books that a departed canvasser is still holding.
//
// Removing someone from a campaign used to delete only their CampaignAssignment (the roster row),
// leaving every TurfAssignment and EffortMember row behind — so their books stayed "assigned" to
// somebody off the roster, those doors never resurfaced as unassignable, and effort-readiness kept
// counting them as crew. The route is fixed (it now calls releaseAssignedWork with a campaign
// scope), but rows orphaned BEFORE that fix are still sitting in the database. This finds and
// releases them.
//
//   node src/migrations/repairOrphanedAssignments.js            # dry run — report only, no writes
//   node src/migrations/repairOrphanedAssignments.js --apply    # release them
//   node src/migrations/repairOrphanedAssignments.js --apply --org=<slug>   # one org only
//
// Idempotent: a second run finds nothing. Safe to re-run.
//
// What it will NEVER touch:
//   · CanvassActivity / SurveyResponse — the knock ledger. A departed canvasser's doors stay in
//     every campaign total and on the invoice. That is the entire point; releasing the work someone
//     was HOLDING must not rewrite the work they DID.
//   · Anyone still on the campaign's roster, however inactive their account is. Deactivation is a
//     login question, not a "take their books away" question — an admin who deactivates someone
//     mid-shift and reactivates them tomorrow expects their books to still be there. Only people
//     with NO CampaignAssignment row for that campaign are considered orphaned.
//   · Books shared with other canvassers. TurfAssignment is one row per (turf, user), so releasing
//     the departed person leaves every co-assigned canvasser's row exactly as it was.
const APPLY = process.argv.includes('--apply');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;

async function main() {
  await connectDb();

  const orgFilter = {};
  if (ORG_SLUG) {
    const org = await Organization.findOne({ slug: ORG_SLUG }).lean();
    if (!org) {
      console.error(`No organization with slug "${ORG_SLUG}".`);
      process.exit(1);
    }
    orgFilter.organizationId = org._id;
  }

  const campaigns = await Campaign.find(orgFilter, 'name organizationId').lean();
  console.log(
    `${APPLY ? 'REPAIRING' : 'DRY RUN — no writes'} · ${campaigns.length} campaign(s)${ORG_SLUG ? ` in ${ORG_SLUG}` : ''}\n`
  );

  let totalTurf = 0;
  let totalEffort = 0;
  let totalPeople = 0;

  for (const c of campaigns) {
    // Who is legitimately on this campaign right now.
    const rostered = new Set(
      (await CampaignAssignment.find({ campaignId: c._id }).distinct('userId')).map(String)
    );
    // Who is holding work on it.
    const [turfHolders, crewHolders] = await Promise.all([
      TurfAssignment.find({ campaignId: c._id }).distinct('userId'),
      EffortMember.find({ campaignId: c._id }).distinct('userId'),
    ]);
    const holders = [...new Set([...turfHolders, ...crewHolders].map(String))];
    const orphans = holders.filter((uid) => !rostered.has(uid));
    if (!orphans.length) continue;

    const users = await User.find({ _id: { $in: orphans } }, 'firstName lastName email').lean();
    const nameOf = (uid) => {
      const u = users.find((x) => String(x._id) === uid);
      return u ? `${u.firstName} ${u.lastName} <${u.email}>` : `(unknown user ${uid})`;
    };

    console.log(`Campaign: ${c.name}`);
    for (const uid of orphans) {
      const [turfCount, crewCount] = await Promise.all([
        TurfAssignment.countDocuments({ campaignId: c._id, userId: uid }),
        EffortMember.countDocuments({ campaignId: c._id, userId: uid }),
      ]);
      console.log(
        `  ${nameOf(uid)} — off the roster, still holding ` +
          `${turfCount} book(s), ${crewCount} effort-crew row(s)`
      );
      if (APPLY) {
        // Scoped to (campaign, user): their books in OTHER campaigns are untouched, and other
        // canvassers on these same books keep their own rows.
        await Promise.all([
          TurfAssignment.deleteMany({ campaignId: c._id, userId: uid }),
          EffortMember.deleteMany({ campaignId: c._id, userId: uid }),
        ]);
      }
      totalTurf += turfCount;
      totalEffort += crewCount;
      totalPeople += 1;
    }
    console.log('');
  }

  if (!totalPeople) {
    console.log('Nothing to repair — no off-roster canvasser is holding work.');
  } else {
    console.log(
      `${APPLY ? 'Released' : 'Would release'}: ${totalTurf} book assignment(s), ` +
        `${totalEffort} effort-crew row(s), across ${totalPeople} person-campaign(s).`
    );
    console.log('Knock history touched: NONE.');
    if (!APPLY) console.log('\nRe-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
