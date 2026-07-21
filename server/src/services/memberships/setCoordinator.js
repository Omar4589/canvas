import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { restampLedgerCoordinator } from './restampCoordinator.js';

// THE choke point for changing an existing member's crew, within ONE campaign.
//
// Every surface that reassigns a canvasser goes through here — the campaign Team tab on web, the
// mobile crew screen, and (via createOrgMember) the lead's create-a-canvasser path — so the ledger
// re-stamp cannot be forgotten by a new caller. test/coordinatorChokePoint.test.js asserts
// structurally that only this file and its two sanctioned siblings write
// CampaignAssignment.coordinatorId.
//
// resolveCoordinatorId() is deliberately NOT this seam: it is a pure validator that performs no
// write and runs on the create paths BEFORE the roster row exists.
//
// Returns { changed, previous, next, activities, surveys, restampError }, or null when the member
// is not on this campaign.
export const setMemberCoordinator = async ({
  organizationId,
  userId,
  campaignId,
  coordinatorId,
  actorUserId = null,
  source,
}) => {
  if (!campaignId) throw new Error('setMemberCoordinator: campaignId is required');
  // The crew lives on the campaign ROSTER row, so no roster row means there is nothing to set:
  // this person is not on this campaign. Callers surface that as a 404 rather than creating a
  // membership-shaped side effect.
  const assignment = await CampaignAssignment.findOne({ userId, campaignId });
  if (!assignment) return null;

  const previous = assignment.coordinatorId ?? null;
  const next = coordinatorId ?? null;

  // A re-picked select that lands on the same value must be completely silent — no membership
  // write, no ledger write, and above all no audit row. Otherwise CoordinatorChange fills with
  // noise and the log stops being able to answer "why did this team's number move?".
  if (String(previous) === String(next)) {
    return { changed: false, previous, next, activities: 0, surveys: 0, restampError: null };
  }

  // ORDER MATTERS: roster first, ledger second. Both orderings can tear (no transactions are
  // available — the test harness runs a standalone mongod), but they are not equally bad:
  //   · Roster first — if the ledger write fails, new knocks already stamp `next` and the
  //     drift is a FINITE, SHRINKING set of old rows that a retry or repair:team-stamps fixes.
  //     The two sources converge.
  //   · Ledger first — if the roster write fails, the ledger says `next` while the roster
  //     still says `previous`, so EVERY SUBSEQUENT KNOCK writes more drift. They diverge without
  //     bound.
  // Compensation is therefore a re-run, not a rollback — the same idempotence that makes reversal
  // "just set it back".
  await CampaignAssignment.updateOne({ userId, campaignId }, { $set: { coordinatorId: next } });

  let moved = { activities: 0, surveys: 0 };
  let restampError = null;
  try {
    moved = await restampLedgerCoordinator({ organizationId, userId, campaignId, coordinatorId: next });
  } catch (err) {
    restampError = err?.message || String(err);
  }

  await CoordinatorChange.create({
    organizationId,
    campaignId,
    userId,
    fromCoordinatorId: previous,
    toCoordinatorId: next,
    byUserId: actorUserId,
    source,
    activitiesMoved: moved.activities,
    surveysMoved: moved.surveys,
    restampError,
  });

  return { changed: true, previous, next, ...moved, restampError };
};

// The `restamp` block every assignment endpoint appends to its 200. One shape, so the org Users
// admin and the team-lead crew panel can't drift into reporting the same act differently.
export const restampSummary = (r) => ({
  changed: !!r?.changed,
  activities: r?.activities || 0,
  surveys: r?.surveys || 0,
  error: r?.restampError || null,
});
