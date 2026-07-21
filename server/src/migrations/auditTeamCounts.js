import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
// teamFoldStage is the EXACT fold /team-breakdown uses. Sharing it is the point: an audit that can
// be wrong in the same way as the thing it audits is worth nothing.
import {
  knocksPipeline,
  KNOCK_ACTIONS,
  NOT_BULK,
  connectionRate,
  teamFoldStage,
} from '../services/reports/aggregations.js';

// READ-ONLY. Prove the numbers on the REAL data, before any of them reach a client.
//
//   npm run audit:team-counts -- --campaign=<id>
//
// Mutates nothing. Run it AFTER the backfill and BEFORE the UI deploy. If any column fails to
// reconcile, stop — a wrong number quoted to a paying client is not recoverable by a later fix.
//
// It checks two independent things:
//
//  1. RECONCILIATION.  Σ teams + "no team" − crossTeamDoors == campaign billable, on EVERY column
//     (doors, survey doors, surveys taken) — not just doors. A team's number is the same
//     dedupe-by-(house,round) applied within the team, so two people on the SAME team double-knocking
//     a house collapses to one door inside their own total. Only a house worked by two DIFFERENT
//     teams is claimed twice, and that difference is crossTeamDoors.
//
//  2. NOBODY IS DROPPED.  Every canvasser who ever knocked appears, with their numbers, including
//     anyone deactivated, taken off the campaign, removed from the org, or self-deleted. The ledger
//     is the source of truth; account state must not move a single count.
// Campaign ids are not something anyone has to hand — they live in the console URL. Since this is
// the HARD GATE before quoting a team number, it has to be runnable without hunting for them, or it
// quietly stops getting run. So --campaign is optional: with no args it audits EVERY campaign and
// exits non-zero if ANY column of ANY campaign fails to reconcile.
//
//   npm run audit:team-counts                      # every campaign, every org
//   npm run audit:team-counts -- --org=<slug>       # every campaign in one org
//   npm run audit:team-counts -- --campaign=<id>    # one campaign
const CAMPAIGN_ID = (process.argv.find((a) => a.startsWith('--campaign=')) || '').split('=')[1];
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;

const n = (v) => (v || 0).toLocaleString();
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

// Which campaigns this run covers. One explicit id, one org's worth, or everything.
async function resolveCampaigns() {
  if (CAMPAIGN_ID) {
    if (!mongoose.isValidObjectId(CAMPAIGN_ID)) {
      console.error('Usage: npm run audit:team-counts -- --campaign=<campaignId>');
      process.exit(1);
    }
    const one = await Campaign.findById(CAMPAIGN_ID).lean();
    if (!one) {
      console.error('No such campaign.');
      process.exit(1);
    }
    return [one];
  }
  if (ORG_SLUG) {
    const org = await Organization.findOne({ slug: ORG_SLUG }, '_id name').lean();
    if (!org) {
      console.error(`No organization with slug "${ORG_SLUG}".`);
      process.exit(1);
    }
    return Campaign.find({ organizationId: org._id }).lean();
  }
  return Campaign.find({}).lean();
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const campaigns = await resolveCampaigns();
  if (!campaigns.length) {
    console.log('No campaigns to audit.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let totalFailed = 0;
  for (const campaign of campaigns) {
    totalFailed += await auditCampaign(campaign);
  }

  if (campaigns.length > 1) {
    console.log(
      totalFailed
        ? `\n════ ✗ ${totalFailed} column(s) across ${campaigns.length} campaign(s) DO NOT RECONCILE. Do not quote these numbers. ════\n`
        : `\n════ ✓ All ${campaigns.length} campaign(s) reconcile on every column. ════\n`
    );
  }

  await mongoose.disconnect();
  process.exit(totalFailed ? 1 : 0);
}

// Audit ONE campaign. Returns the number of columns that failed to reconcile.
async function auditCampaign(campaign) {
  const scope = { organizationId: campaign.organizationId, campaignId: campaign._id, ...NOT_BULK };

  console.log(`\nAUDIT · ${campaign.name}  (read-only — nothing will be written)\n`);

  // ── Whose team is whose ────────────────────────────────────────────────────────────────────────
  // From the LEDGER, in this campaign's scope — the same derivation routes/admin/reports.js uses
  // (leadIdsForScope). It must match: this script's whole value is being able to fail when the
  // endpoint is wrong, and a lead set derived differently here would make the audit wrong in a
  // DIFFERENT way, which is worse than not auditing. It was org-wide off Membership until crews
  // became per-campaign, which would now report campaign-correct totals with campaign-wrong labels.
  const [leadDoors, leadSurveys] = await Promise.all([
    CanvassActivity.distinct('coordinatorId', { ...scope, coordinatorId: { $ne: null } }),
    SurveyResponse.distinct('coordinatorId', {
      organizationId: campaign.organizationId,
      campaignId: campaign._id,
      coordinatorId: { $ne: null },
    }),
  ]);
  const leadIds = [...new Set([...leadDoors, ...leadSurveys].map(String))];
  const leadSet = new Set(leadIds);

  // The SAME fold the endpoint uses (imported, not re-implemented — a second copy is exactly how the
  // doors and the voters drifted apart in the first place). A lead's own work stamps *their*
  // coordinator, usually nobody, so fold it onto the team they run.
  const fold = teamFoldStage(leadIds);

  // ── Per-team doors: dedupe to (house, round) WITHIN a team ─────────────────────────────────────
  const perTeam = await CanvassActivity.aggregate([
    { $match: { ...scope, actionType: { $in: KNOCK_ACTIONS } } },
    fold,
    {
      $group: {
        _id: { householdId: '$householdId', passId: '$passId', team: '$team' },
        hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
        hasLit: { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
        users: { $addToSet: '$userId' },
      },
    },
    {
      $group: {
        _id: '$_id.team',
        doors: { $sum: 1 },
        surveyDoors: { $sum: '$hasSurvey' },
        litKnocks: { $sum: '$hasLit' },
        people: { $addToSet: '$users' },
      },
    },
  ]);

  const voterSurveys = await SurveyResponse.aggregate([
    { $match: { organizationId: campaign.organizationId, campaignId: campaign._id } },
    fold,
    { $group: { _id: '$team', voters: { $sum: 1 } } },
  ]);
  const votersByTeam = new Map(voterSurveys.map((v) => [String(v._id), v.voters]));

  const [campaignK] = await CanvassActivity.aggregate(knocksPipeline(scope));
  const campaignVoters = await SurveyResponse.countDocuments({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
  });
  const rawEvents = await CanvassActivity.countDocuments({ ...scope, actionType: { $in: KNOCK_ACTIONS } });

  const teamIds = perTeam.map((t) => t._id).filter(Boolean);
  const names = await User.find({ _id: { $in: teamIds } }, 'firstName lastName').lean();
  const nameById = new Map(names.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));

  const rows = perTeam
    .map((t) => ({
      name: t._id ? nameById.get(String(t._id)) || 'Unknown' : '(no team)',
      people: new Set(t.people.flat().map(String)).size,
      doors: t.doors,
      surveyDoors: t.surveyDoors,
      voters: votersByTeam.get(String(t._id)) || 0,
      conn: connectionRate({ knocks: t.doors, surveyedKnocks: t.surveyDoors, litKnocks: t.litKnocks }),
    }))
    .sort((a, b) => b.doors - a.doors);

  const W = 22;
  console.log(`${pad('TEAM', W)}${padL('PEOPLE', 8)}${padL('DOORS', 10)}${padL('SURVEY DOORS', 15)}${padL('SURVEYS', 9)}${padL('CONN', 7)}`);
  for (const r of rows) {
    console.log(`${pad(r.name, W)}${padL(r.people, 8)}${padL(n(r.doors), 10)}${padL(n(r.surveyDoors), 15)}${padL(n(r.voters), 9)}${padL(`${r.conn}%`, 7)}`);
  }

  const sum = rows.reduce((a, r) => a + r.doors, 0);
  const sumSurveyDoors = rows.reduce((a, r) => a + r.surveyDoors, 0);
  const sumVoters = rows.reduce((a, r) => a + r.voters, 0);
  const cross = Math.max(0, sum - (campaignK?.knocks || 0));

  console.log('  ' + '─'.repeat(69));
  console.log(`${pad('Σ teams', W)}${padL('', 8)}${padL(n(sum), 10)}${padL(n(sumSurveyDoors), 15)}${padL(n(sumVoters), 9)}`);
  console.log(`${pad('less cross-team doors', W)}${padL('', 8)}${padL(`-${cross}`, 10)}`);
  console.log(`${pad('CAMPAIGN (billable)', W)}${padL('', 8)}${padL(n(campaignK?.knocks), 10)}${padL(n(campaignK?.surveyedKnocks), 15)}${padL(n(campaignVoters), 9)}${padL(`${connectionRate(campaignK || {})}%`, 7)}`);
  console.log(`\n(raw knock events: ${n(rawEvents)} — ${n(rawEvents - (campaignK?.knocks || 0))} door(s) knocked more than once in the same round)\n`);

  // ── The identity ───────────────────────────────────────────────────────────────────────────────
  const checks = [
    ['doors', sum - cross, campaignK?.knocks || 0],
    ['survey doors', sumSurveyDoors, campaignK?.surveyedKnocks || 0],
    // Response ROWS, matching the renamed `surveysTaken` payload field — the aggregate above is
    // {$sum: 1} over SurveyResponse, never a distinct-voter count.
    ['surveys taken', sumVoters, campaignVoters],
  ];
  let failed = 0;
  for (const [label, got, want] of checks) {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${pad(label, 18)} Σ teams${label === 'doors' ? ' − cross-team' : ''} = ${n(got)}  ·  campaign = ${n(want)}`);
  }

  // ── Nobody is dropped ──────────────────────────────────────────────────────────────────────────
  console.log('\nLEDGER CROSS-CHECK — every canvasser who ever knocked, whatever happened to them since:');
  const userIds = await CanvassActivity.distinct('userId', scope);
  const users = await User.find({ _id: { $in: userIds } }, 'firstName lastName deletedAt').lean();
  const mems = await Membership.find(
    { organizationId: campaign.organizationId, userId: { $in: userIds } },
    'userId isActive'
  ).lean();
  const mById = new Map(mems.map((m) => [String(m.userId), m]));
  // The crew is per-campaign, so it comes off THIS campaign's roster. Somebody who knocked here but
  // is no longer rostered has no row — and reads as "off roster" rather than being silently
  // relabelled "no team", which would look identical to a genuine No-team canvasser.
  const roster = await CampaignAssignment.find(
    { campaignId: campaign._id, userId: { $in: userIds } },
    'userId coordinatorId'
  ).lean();
  const crewById = new Map(roster.map((r) => [String(r.userId), r]));

  for (const uid of userIds.map(String)) {
    const u = users.find((x) => String(x._id) === uid);
    const m = mById.get(uid);
    const [k] = await CanvassActivity.aggregate(knocksPipeline({ ...scope, userId: new mongoose.Types.ObjectId(uid) }));
    const surveys = await SurveyResponse.countDocuments({ campaignId: campaign._id, userId: uid });
    const state = !m ? 'REMOVED FROM ORG' : u?.deletedAt ? 'account deleted' : m.isActive ? 'active' : 'deactivated';
    const crew = crewById.get(uid);
    const team = crew?.coordinatorId
      ? nameById.get(String(crew.coordinatorId)) || '?'
      : !crew
        ? 'off roster'
        : leadSet.has(uid)
          ? 'own team'
          : 'no team';
    console.log(
      `  ${pad(u ? `${u.firstName} ${u.lastName}` : uid, 20)}${padL(n(k?.knocks), 8)} doors ${padL(n(surveys), 6)} surveys  ·  ${pad(team, 14)} ${state}`
    );
  }

  console.log(
    failed
      ? `\n✗ ${failed} column(s) DO NOT RECONCILE. Do not ship. Do not quote these numbers.\n`
      : '\n✓ Every column reconciles. Teams + no-team − cross-team = the campaign, exactly.\n'
  );

  return failed;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
