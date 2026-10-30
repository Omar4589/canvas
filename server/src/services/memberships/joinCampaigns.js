import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign } from '../../models/Campaign.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { NOT_DELETING } from '../campaigns/deletionState.js';
import { CAMPAIGN_ARCHIVED } from '../../middleware/campaignWritable.js';
import { resolveCoordinatorId } from './createMember.js';
import { joinCampaignCrew, restampSummary, CREW_JOB } from './setCoordinator.js';
import { historyByTeam, historiesByCampaign } from './restampCoordinator.js';
import { mapWithLimit } from '../../utils/mapWithLimit.js';
import { sendMail } from '../mail/mailer.js';
import { inviteSetPassword, addedToOrg, addedToCampaign } from '../mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../auth/passwordReset.js';

// Putting one person on SEVERAL campaigns at once, each with its own crew — the org view's add by email
// (POST /admin/memberships/by-email) and a profile's Add to campaigns (POST /admin/memberships/:userId/
// campaigns). docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §B, §C.1.
//
// Nothing here writes a crew itself: every join is joinCampaignCrew (services/memberships/setCoordinator.js),
// the choke point, so a returning person's earlier doors on each campaign move to the crew they join
// exactly as the campaign Team page's add moves them. What this module adds is the part a one-campaign add
// never needed: every pick checked before the first write, so one bad pick can't leave someone on half of
// what was asked; one roster read; and ONE email naming every campaign joined.

// More than any organization runs at once; a cap so a request can't ask for a thousand joins.
export const MAX_CAMPAIGN_PICKS = 100;

// [{ campaignId, coordinatorId }] — coordinatorId an id, or null (or absent) for No crew.
export const campaignPicksSchema = z
  .array(
    z.object({
      campaignId: z.string(),
      coordinatorId: z.string().nullable().optional(),
    })
  )
  .max(MAX_CAMPAIGN_PICKS)
  .refine((picks) => new Set(picks.map((p) => String(p.campaignId))).size === picks.length, {
    message: 'Each campaign can be picked once.',
  });

// Check every pick before anything is written. Returns { ok, value: [{ campaignId, campaignName,
// coordinatorId }] } or { ok: false, status, error, code? }.
//
// `memberUserId` is the person being added, for the can't-be-your-own-coordinator check, and is passed
// only for someone NAMED in this organization. For an address that resolved `outside`, comparing against
// the account behind it would make the 400 say whether the address has one — the cross-tenant oracle
// leadCrew.js avoids the same way. An outside person can't be a coordinator here anyway: they aren't a
// member, and resolveCoordinatorId wants an active admin or lead of this organization.
export const checkCampaignPicks = async ({ orgId, picks, memberUserId = null }) => {
  if (!picks?.length) return { ok: true, value: [] };
  if (picks.some((p) => !mongoose.isValidObjectId(p.campaignId))) {
    return { ok: false, status: 400, error: 'Invalid campaignId.' };
  }
  const campaigns = await Campaign.find(
    { _id: { $in: picks.map((p) => p.campaignId) }, organizationId: orgId, ...NOT_DELETING },
    'name isActive'
  ).lean();
  const byId = new Map(campaigns.map((c) => [String(c._id), c]));
  const value = [];
  for (const p of picks) {
    const campaign = byId.get(String(p.campaignId));
    if (!campaign) return { ok: false, status: 400, error: 'One or more campaigns are not in this organization.' };
    // An archived campaign is read-only (middleware/campaignWritable.js); the screens offer active ones
    // only, so this is a campaign archived while the step was open.
    if (campaign.isActive === false) {
      return {
        ok: false,
        status: 409,
        code: CAMPAIGN_ARCHIVED,
        error: `${campaign.name} is archived, so nobody can be added to it. Uncheck it and try again.`,
      };
    }
    const coord = await resolveCoordinatorId({ orgId, raw: p.coordinatorId ?? null, memberUserId });
    if (!coord.ok) return { ok: false, status: 400, error: `${campaign.name}: ${coord.error}` };
    value.push({ campaignId: campaign._id, campaignName: campaign.name, coordinatorId: coord.value ?? null });
  }
  return { ok: true, value };
};

// Names for the teams a person's earlier doors came from, for an answer's `restamp.sources`.
export const namedSources = async (sources) => {
  const ids = (sources || []).map((x) => x.coordinatorId).filter(Boolean);
  const people = ids.length ? await User.find({ _id: { $in: ids } }, 'firstName lastName').lean() : [];
  const nameOf = new Map(people.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  return (sources || []).map((x) => {
    const id = x.coordinatorId ? String(x.coordinatorId) : null;
    return { coordinatorId: id, name: id ? nameOf.get(id) || 'Unknown' : null, doors: x.doors || 0 };
  });
};

const NOTHING_MOVED = { ...restampSummary({ changed: false }), sources: [] };

// Put the person on each checked campaign with its crew. The roster is read once: a campaign they're
// already on is skipped (`already-on`) and its crew never changes — re-crewing is what Move to crew is
// for — and so is one another admin's add reached first (joinCampaignCrew's insert settles that race).
// The joins run four at a time, like the Team page's bulk add. A join that throws is reported for that
// campaign and the others go ahead; one whose earlier doors didn't finish moving stays `joined`, with
// `restamp.error` set, for Finish it on that campaign.
export const joinCampaigns = async ({ orgId, userId, picks, actorUserId }) => {
  if (!picks.length) return [];
  const onRoster = new Set(
    (
      await CampaignAssignment.find(
        { userId, organizationId: orgId, campaignId: { $in: picks.map((p) => p.campaignId) } },
        'campaignId'
      ).lean()
    ).map((r) => String(r.campaignId))
  );
  return mapWithLimit(picks, CREW_JOB.sideBySide, async (p) => {
    const row = {
      campaignId: String(p.campaignId),
      campaignName: p.campaignName,
      coordinatorId: p.coordinatorId ? String(p.coordinatorId) : null,
    };
    if (onRoster.has(row.campaignId)) return { ...row, result: 'already-on', restamp: NOTHING_MOVED };
    let joined;
    try {
      joined = await joinCampaignCrew({
        organizationId: orgId,
        campaignId: p.campaignId,
        userId,
        coordinatorId: p.coordinatorId,
        actorUserId,
        source: 'campaign_join',
      });
    } catch (err) {
      return { ...row, result: 'error', error: err?.message || String(err), restamp: NOTHING_MOVED };
    }
    if (!joined.joined) return { ...row, result: 'already-on', restamp: NOTHING_MOVED };
    // Joined, whatever happens next: naming the teams their doors came from is only for the sentence, and
    // a failed read must not report a campaign they ARE on as not joined (it would also leave it out of
    // the email and the deletion convergence).
    const sources = await namedSources(joined.sources).catch(() => []);
    return { ...row, result: 'joined', restamp: { ...restampSummary({ ...joined, changed: true }), sources } };
  });
};

// A named person's doors on a campaign, by the team they count for today, newest team first, so an add
// step can say "120 doors here from before: 100 on Dana's team" and pre-pick the newest team when its
// coordinator can still run a crew (`canLead`, the same rule resolveCoordinatorId enforces). `histories`
// are historiesByCampaign's { teams, doors }; the coordinators' names and who can still lead are read once
// for all of them.
const shapeHistories = async (orgId, histories) => {
  const teamsOf = (h) => h.teams.filter((t) => t.doors > 0);
  const ids = [...new Set(histories.flatMap((h) => teamsOf(h).map((t) => t.coordinatorId).filter(Boolean).map(String)))];
  const [people, leaders] = await Promise.all([
    ids.length ? User.find({ _id: { $in: ids } }, 'firstName lastName').lean() : [],
    ids.length ? Membership.find({ organizationId: orgId, userId: { $in: ids }, isActive: true, role: { $in: ['admin', 'lead'] } }, 'userId').lean() : [],
  ]);
  const nameOf = new Map(people.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  const canLead = new Set(leaders.map((m) => String(m.userId)));
  return histories.map((h) => ({
    doors: h.doors,
    sources: teamsOf(h).map((t) => {
      const id = t.coordinatorId ? String(t.coordinatorId) : null;
      return { coordinatorId: id, name: id ? nameOf.get(id) || 'Unknown' : null, doors: t.doors, canLead: id ? canLead.has(id) : false };
    }),
  }));
};

// ONE campaign — the campaign Team page's lookup (leadCrew.js POST /resolve). The same passes and the same
// shaping as the org view's campaignHistories below, so a campaign's numbers are the same whichever screen
// asks.
export const campaignHistory = async ({ orgId, campaignId, userId }) => {
  const history = await historyByTeam({ organizationId: orgId, userId, campaignId });
  return (await shapeHistories(orgId, [history]))[0];
};

// Every ACTIVE campaign the person is on or has knocked: [{ campaignId, onCampaign, history }], newest
// campaign first. Campaigns with neither are left out — the screens already list every active campaign, and
// "not on it, no doors" is what a missing row means. One pass per ledger over the person's history for all
// the organization's active campaigns at once (historiesByCampaign), not one per campaign.
export const campaignHistories = async ({ orgId, userId }) => {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const oid = new mongoose.Types.ObjectId(String(orgId));
  const [live, roster] = await Promise.all([
    Campaign.find({ organizationId: oid, isActive: true, ...NOT_DELETING }, '_id').sort({ createdAt: -1 }).lean(),
    CampaignAssignment.find({ userId: uid, organizationId: oid }, 'campaignId').lean(),
  ]);
  if (!live.length) return [];
  const onIds = new Set(roster.map((r) => String(r.campaignId)));
  const byCampaign = await historiesByCampaign({ organizationId: oid, userId: uid, campaignIds: live.map((c) => c._id) });
  const ids = live.map((c) => String(c._id));
  const shaped = await shapeHistories(oid, ids.map((id) => byCampaign.get(id)));
  return ids
    .map((id, i) => ({ campaignId: id, onCampaign: onIds.has(id), history: shaped[i] }))
    .filter((r) => r.onCampaign || r.history.doors > 0);
};

// Who can run a crew here: any active admin or team lead of the organization — the rule
// resolveCoordinatorId enforces, so a picker built from this never offers someone the write refuses.
// Name and role only, no email: a list of who can be picked, not a directory. GET …/crew answers it too.
export const coordinatorChoices = async (orgId) => {
  const rows = await Membership.find({ organizationId: orgId, isActive: true, role: { $in: ['admin', 'lead'] } })
    .populate({ path: 'userId', select: 'firstName lastName isActive' })
    .lean();
  return rows
    .filter((m) => m.userId && m.userId.isActive)
    .map((m) => ({
      id: String(m.userId._id),
      firstName: m.userId.firstName,
      lastName: m.userId.lastName,
      role: m.role,
    }));
};

// The ONE email an add sends, naming every campaign it joined — never one per campaign. Best-effort and
// never awaited (a mail hiccup must not fail the add); only the invite's token is awaited, because the
// link has to exist before the email names it.
//   created   a new account: the set-password invite (a team lead's names no campaigns, as before)
//   attached  an account from elsewhere linked in: the no-credentials "added to the org" note
//   joined    someone already here who joined at least one campaign: "You've been added to …" — unless
//             they haven't set a password yet, whose pending invite is still their way in
export const sendJoinedEmail = async ({ kind, user, role, campaignNames, org }) => {
  if (!user?.email) return;
  const meta = { organizationId: org._id, organizationName: org.name, userId: user._id };
  if (kind === 'created') {
    const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });
    // A url only comes back null for an account deleted in the meantime; there is nobody to invite.
    if (url) {
      sendMail({
        to: user.email,
        ...inviteSetPassword({ firstName: user.firstName, orgName: org.name, campaignNames, setPasswordUrl: url, role }),
        kind: 'inviteSetPassword',
        meta,
      });
    }
    return;
  }
  if (kind === 'attached') {
    sendMail({ to: user.email, ...addedToOrg({ firstName: user.firstName, orgName: org.name, campaignNames, role }), kind: 'addedToOrg', meta });
    return;
  }
  if (kind === 'joined' && campaignNames.length && !user.mustChangePassword) {
    sendMail({
      to: user.email,
      ...addedToCampaign({ firstName: user.firstName, orgName: org.name, campaignNames, role }),
      kind: 'addedToCampaign',
      meta,
    });
  }
};
