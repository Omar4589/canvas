import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { resolveDeletedIdentities } from '../users/deleteAccount.js';
import { NOT_BULK } from './aggregations.js';

// Who a canvasser IS, for a report that already knows what they DID.
//
// Every per-canvasser report is ledger-first: it aggregates CanvassActivity, and the row set is
// whoever knocked. This helper only decorates those rows with a name and a standing. It must
// NEVER filter — a departed canvasser's work stays in every total and on the invoice, so their
// row has to survive here even if their account is gone entirely.
//
// The standing is genuinely a composite, and the two flags behind it mean different things:
//
//   Membership.isActive  — what the admin "Deactivate" button writes. Per-org, reversible.
//   User.isActive        — written by NOTHING except terminal account deletion, which also
//                          sets deletedAt and scrubs the name to "Deleted user".
//
// Reports used to return User.isActive and label it "active", which in any real database just
// means "not deleted" — it never went false for someone an admin had deactivated. So the
// Inactive badge never appeared for the people it was meant for, and the mobile "hide inactive"
// switch hid the wrong set. `status` is the honest answer; `isActive` is kept as the boolean
// shorthand for it so existing consumers keep working, but now it tells the truth.
//
//   'active'      — on the team and able to log in
//   'deactivated' — membership exists but was switched off (reversible)
//   'removed'     — no membership row at all (removal from the org hard-deletes it)
//   'deleted'     — the account was deleted; the User row survives only to anchor the ledger
export function canvasserStanding(user, membership) {
  if (!user || user.deletedAt) return 'deleted';
  if (!membership) return 'removed';
  if (!membership.isActive || !user.isActive) return 'deactivated';
  return 'active';
}

// Does this organization carry this person: a membership here in any status, or a knock or survey
// of theirs on this org's ledger? The per-canvasser report drills answer only for people the org
// carries. They used to look the account up by id alone, which handed any admin or team lead who
// held another organization's user id that person's name, email, phone and last sign-in.
//
// Removal from the org hard-deletes the membership, so a departed canvasser is carried by their
// ledger rows instead. Their drill has to keep working; it is how an admin audits them. Desk marks
// (via: 'bulk') don't count: their userId is whoever pressed the button, which can be Doorline staff
// under a support grant, and no per-canvasser report ever shows a bulk-only person anyway.
//
// The ledger half filters on userId and NOT_BULK only, and compares the org in code. Adding
// organizationId to the filter hands the planner the organizationId index as a candidate, and a
// reviewer watched it take that index (on an $ne org probe) and walk 100,000 rows of other orgs'
// knocks. Without it, only a userId-prefixed index fits, and the query reads just this person's rows.
export const orgCarriesUser = async (userId, organizationId) => {
  if (await Membership.exists({ userId, organizationId })) return true;
  const [doorOrgs, surveyOrgs] = await Promise.all([
    CanvassActivity.distinct('organizationId', { userId, ...NOT_BULK }),
    SurveyResponse.distinct('organizationId', { userId }),
  ]);
  const org = String(organizationId);
  return [...doorOrgs, ...surveyOrgs].some((id) => String(id) === org);
};

// The same question for a team lead, whose view is their campaigns, not the whole org. A lead can be
// the paying client, so their per-person drills keep to the Users list's wall (leadVisibleUserIds in
// routes/admin/memberships.js): people on a campaign the lead manages. "On" means rostered there,
// granted to run it, coordinating a crew there, or with their own knocks or surveys there. It has to
// be ANY managed campaign, not just the one in ?campaignId: the phone's Users hub opens people from
// a lead's other campaigns with the currently selected campaign's id.
export const campaignsCarryUser = async (userId, campaignIds) => {
  if (!campaignIds.length) return false;
  const inCampaigns = { campaignId: { $in: campaignIds } };
  if (await CampaignAssignment.exists({ ...inCampaigns, userId })) return true;
  if (await CampaignManager.exists({ ...inCampaigns, userId })) return true;
  if (await CampaignAssignment.exists({ ...inCampaigns, coordinatorId: userId })) return true;
  const [doorCampaigns, surveyCampaigns] = await Promise.all([
    CanvassActivity.distinct('campaignId', { userId, ...NOT_BULK }),
    SurveyResponse.distinct('campaignId', { userId }),
  ]);
  const managed = new Set(campaignIds.map(String));
  return [...doorCampaigns, ...surveyCampaigns].some((id) => managed.has(String(id)));
};

// userIds -> Map(id -> { firstName, lastName, email, phone, status, isActive }).
// A user id with no User doc still gets an entry, so a caller mapping over the LEDGER's ids can
// always resolve one and never has to drop a row.
export async function hydrateCanvassers(userIds, orgId, { fields = '' } = {}) {
  const ids = [...new Set((userIds || []).map(String))];
  const out = new Map();
  if (!ids.length) return out;

  const select = `firstName lastName email isActive deletedAt${fields ? ` ${fields}` : ''}`;
  const [users, memberships] = await Promise.all([
    User.find({ _id: { $in: ids } }, select).lean(),
    Membership.find({ userId: { $in: ids }, organizationId: orgId }, 'userId isActive').lean(),
  ]);
  const mById = new Map(memberships.map((m) => [String(m.userId), m]));

  // Self-deletion scrubs the User row to "Deleted user" (App Store 5.1.1(v) requires a real delete),
  // but the org's record of the WORK survives — and a knock ledger you can't attach to a person is
  // useless for an audit or for telling a client who walked their district. DeletedUserRecord
  // snapshots the NAME for exactly this, and resolveDeletedIdentities() reads it. Name ONLY:
  // the published deletion promise is that contact details are removed immediately, so a deleted
  // user's email is blanked here — never the snapshot's (which no longer has one) and never the
  // tombstone address (which embeds the account id and would leak into the canvasser CSV).
  //
  // After the retention window lapses the snapshot is purged and the records no longer directly
  // identify the person. That is the intended end state, not a bug.
  const deletedIds = users.filter((u) => u.deletedAt).map((u) => u._id);
  const restored = deletedIds.length
    ? await resolveDeletedIdentities(deletedIds, { organizationId: orgId })
    : new Map();

  for (const id of ids) {
    const u = users.find((x) => String(x._id) === id) || null;
    const status = canvasserStanding(u, mById.get(id));
    const snap = u?.deletedAt ? restored.get(String(u._id)) : null;
    out.set(id, {
      firstName: snap?.firstName || u?.firstName || '',
      lastName: snap?.lastName || u?.lastName || '',
      email: u?.deletedAt ? '' : u?.email || '',
      phone: u?.deletedAt ? null : u?.phone || null,
      status,
      isActive: status === 'active',
    });
  }
  return out;
}
