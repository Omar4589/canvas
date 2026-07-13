import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { Effort } from '../models/Effort.js';
import { Pass } from '../models/Pass.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { Person } from '../models/Person.js';
import { PersonMergeCandidate } from '../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../models/PersonEditProposal.js';
import { PersonMergeLog } from '../models/PersonMergeLog.js';
import { deleteCampaignCascade } from '../services/campaigns/deleteCampaign.js';

// One-off cleanup: HARD-DELETE test campaigns and, for a single --mock campaign, also
// purge the fake voter identities it created. Reuses deleteCampaignCascade (the same
// cascade the admin route uses) but INTENTIONALLY bypasses the route's "has canvassing
// activity" guard, so it can remove campaigns that were already walked. Dry-run by
// default; nothing is written without --apply, and nothing is deleted without --ids.
//
// Usage (from server/, or via `npm run cleanup:test-campaigns -- <args>` from root):
//   node src/utils/deleteTestCampaigns.js                                  # inventory (pick ids)
//   node src/utils/deleteTestCampaigns.js --ids=<a,b,c> [--mock=<id>]      # preview
//   node src/utils/deleteTestCampaigns.js --ids=<a,b,c> [--mock=<id>] --apply
//
// "keep the voters": a campaign you DON'T list is untouched, and canonical Person
// identities always survive a delete. Only the --mock campaign's orphaned Persons
// (now linked to zero voters) are removed — Persons shared with a kept campaign stay.

const APPLY = process.argv.includes('--apply');
const argVal = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const ids = (argVal('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
const mockId = argVal('mock');
const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Hide credentials but keep host/db visible so the operator can confirm the target.
function maskUri(uri) {
  if (!uri) return '(MONGODB_URI unset)';
  return uri.replace(/\/\/[^@/]+@/, '//***:***@');
}
const nonzero = (counts) =>
  Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || '(nothing)';

async function campaignStats(campaignId) {
  const householdIds = await Household.find({ campaignId }).distinct('_id');
  const [voters, efforts, passes, knock, survey] = await Promise.all([
    householdIds.length ? Voter.countDocuments({ householdId: { $in: householdIds } }) : 0,
    Effort.countDocuments({ campaignId }),
    Pass.countDocuments({ campaignId }),
    CanvassActivity.exists({ campaignId }),
    SurveyResponse.exists({ campaignId }),
  ]);
  return { households: householdIds.length, voters, efforts, passes, walked: Boolean(knock || survey) };
}

async function inventory() {
  const campaigns = await Campaign.find({}).sort({ organizationId: 1, createdAt: 1 }).lean();
  if (!campaigns.length) { console.log('\nNo campaigns found.'); return; }
  const orgIds = [...new Set(campaigns.map((c) => String(c.organizationId)))];
  const orgs = new Map(
    (await Organization.find({ _id: { $in: orgIds } }, { name: 1 }).lean()).map((o) => [String(o._id), o.name])
  );
  console.log(`\n${campaigns.length} campaign(s):\n`);
  for (const c of campaigns) {
    const s = await campaignStats(c._id);
    const created = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '?';
    console.log(
      `  ${c._id}  [${orgs.get(String(c.organizationId)) || 'org?'}]  "${c.name}"  ${c.type}  ` +
      `${c.isActive ? 'active' : 'archived'}  ${s.walked ? 'WALKED' : 'never-walked'}  ` +
      `· ${s.households} doors · ${s.voters} voters · ${s.efforts} walk lists · ${s.passes} passes · created ${created}`
    );
  }
  // Printed as it must be typed in Heroku's Run console, which starts at the REPO ROOT —
  // `node src/utils/…` is relative to server/ and just errors there. See docs/OPERATIONS.md.
  console.log('\nNext: npm run cleanup:test-campaigns -- --ids=<id,id,...> [--mock=<id>]   (dry run), then add --apply.');
}

async function purgeOrphanedPersons(personIds) {
  let purged = 0;
  for (const pid of personIds) {
    if ((await Voter.countDocuments({ personId: oid(pid) })) > 0) continue; // still linked elsewhere → keep
    await Person.deleteOne({ _id: oid(pid) });
    await PersonMergeCandidate.deleteMany({ $or: [{ personIdA: oid(pid) }, { personIdB: oid(pid) }] });
    await PersonEditProposal.deleteMany({ personId: oid(pid) });
    await PersonMergeLog.deleteMany({ $or: [{ survivorId: oid(pid) }, { victimId: oid(pid) }] });
    purged += 1;
  }
  return purged;
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes WILL happen)' : 'DRY RUN (no writes)'}`);
  console.log(`DB:   ${maskUri(process.env.MONGODB_URI)}`);
  await connectDb(process.env.MONGODB_URI);

  if (!ids.length) {
    await inventory();
    await mongoose.disconnect();
    return;
  }

  if (mockId && !ids.includes(mockId)) {
    console.log(`\n⚠️  --mock=${mockId} is not in --ids — its Persons are only purged if the campaign is deleted. Add it to --ids.`);
  }
  console.log(
    APPLY
      ? '\n⚠️  HARD DELETE — irreversible. Bypasses the in-app "has canvassing activity" guard.\n'
      : '\nPreview of what --apply would do:\n'
  );

  const grand = {};
  for (const id of ids) {
    if (!mongoose.isValidObjectId(id)) { console.log(`  ${id}: invalid id — skipping`); continue; }
    const campaign = await Campaign.findById(id);
    if (!campaign) { console.log(`  ${id}: not found (already deleted?) — skipping`); continue; }
    const isMock = String(id) === String(mockId);
    const s = await campaignStats(campaign._id);
    console.log(
      `  ${campaign._id}  "${campaign.name}"  ${s.walked ? 'WALKED' : 'never-walked'}  ` +
      `· ${s.households} doors · ${s.voters} voters${isMock ? '   [MOCK → purge its orphaned Persons]' : ''}`
    );

    // Capture the mock campaign's Person links BEFORE the cascade deletes its voters.
    let personIds = [];
    if (isMock) {
      const hhIds = await Household.find({ campaignId: campaign._id }).distinct('_id');
      personIds = hhIds.length
        ? await Voter.find({ householdId: { $in: hhIds }, personId: { $ne: null } }).distinct('personId')
        : [];
      console.log(`      ${personIds.length} linked Person id(s) captured for the orphan check`);
    }

    if (!APPLY) continue;

    const counts = await deleteCampaignCascade(campaign);
    for (const [k, v] of Object.entries(counts)) grand[k] = (grand[k] || 0) + v;
    console.log(`      deleted: ${nonzero(counts)}`);

    if (isMock && personIds.length) {
      const purged = await purgeOrphanedPersons(personIds);
      grand.Person = (grand.Person || 0) + purged;
      console.log(`      purged ${purged}/${personIds.length} orphaned mock Person(s) (kept ${personIds.length - purged} still linked elsewhere)`);
    }
  }

  console.log(
    APPLY
      ? `\nDone. Totals: ${nonzero(grand)}`
      : '\nDry run — re-run with --apply to delete for good. Back up the DB (Atlas snapshot) first.'
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
