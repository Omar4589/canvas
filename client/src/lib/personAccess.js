import { billingLocked, canOfferDelete } from './memberDeletion.js';

// The person panel's who-sees-and-does-what (docs/PROPOSAL_PEOPLE_PAGES.md §D.5), mirroring the
// server. Pure, so it is tested directly (personAccess.test.js). The server decides; this only
// decides what to OFFER:
//   - an org admin manages anyone but a Doorline staff account, a deleted one and (for the switch
//     and the temporary password) themselves;
//   - a team lead manages canvassers (memberships.js leadMayManageTarget), removes canvassers, people
//     no longer in the org and themselves (item 41), and never sees Role, Remove from org, Delete
//     account or "Everywhere".

// One person as the panel reads them. The Users page has the org membership row; a Team page has the
// campaign roster row and, for an org admin, the membership row too (role, billing, multi-org).
export const personFromMember = (m) => ({
  userId: String(m.user.id),
  firstName: m.user.firstName || '',
  lastName: m.user.lastName || '',
  email: m.user.email || '',
  phone: m.user.phone || '',
  role: m.role || 'canvasser',
  // canvasserStanding's words (services/reports/canvasserIdentity.js), so rosterView.standing() reads both.
  status: m.user.isDeleted ? 'deleted' : m.isActive && m.user.isActive ? 'active' : 'deactivated',
  isSuperAdmin: !!m.user.isSuperAdmin,
  isMultiOrg: !!m.user.isMultiOrg,
  lastLoginAt: m.user.lastLoginAt || null,
  createdAt: m.user.createdAt || null,
  joinedAt: m.addedAt || null,
  membership: m,
  roster: null,
});

export const personFromRoster = (row, membership = null) => ({
  userId: String(row.userId),
  firstName: row.firstName || '',
  lastName: row.lastName || '',
  email: row.email || '',
  phone: row.phone || '',
  role: row.role || 'canvasser',
  status: row.status || 'active',
  isSuperAdmin: !!row.isSuperAdmin,
  isMultiOrg: !!membership?.user?.isMultiOrg,
  lastLoginAt: row.lastLoginAt || null,
  createdAt: row.createdAt || null,
  joinedAt: row.assignedAt || null,
  membership,
  roster: row,
});

export const fullNameOf = (p) => `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || p?.email || 'this person';
export const firstNameOf = (p) => (p?.firstName || '').trim() || fullNameOf(p);

export const ROLE_LABEL = { admin: 'Admin', lead: 'Team lead', canvasser: 'Canvasser' };

// The state words (rosterView.standing), with the Badge variant each one wears. "No sign-in recorded"
// is plain on purpose: it isn't a problem, only an account older than the sign-in clock.
export const STANDING_LABEL = {
  deleted: 'Account deleted',
  left: 'No longer in the org',
  deactivated: 'Deactivated',
  paused: 'Paused for review',
  'never-signed-in': 'Never signed in',
  'no-sign-in-recorded': 'No sign-in recorded',
  active: 'Active',
};
export const STANDING_VARIANT = {
  deleted: 'danger',
  left: 'neutral',
  deactivated: 'warning',
  paused: 'danger',
  'never-signed-in': 'warning',
  'no-sign-in-recorded': 'neutral',
  active: 'success',
};

// viewer: { userId, isOrgAdmin, viewerBilling, underGrant }. `underGrant` is Doorline staff working in a
// customer's org without a membership there (a support grant): the server refuses them every membership
// write on another staff account (services/memberships/vendorGuards.js), Role and Remove from org included.
// openPause: the person's open pause from the pause list, which the server already narrows to the
// campaigns a lead manages — so a lead only ever gets an Unpause for a pause on one of theirs, and (§D.5)
// only while it blocks; an org admin can lift any open pause, as the profile always could.
export const personAccess = ({ viewer, person, onTeam = false, archived = false, openPause = null }) => {
  const admin = !!viewer?.isOrgAdmin;
  const isSelf = !!viewer?.userId && String(viewer.userId) === String(person.userId);
  const deleted = person.status === 'deleted';
  const left = person.status === 'removed';
  const staff = !!person.isSuperAdmin;
  const canvasser = (person.role || 'canvasser') === 'canvasser';
  const membership = person.membership || null;
  const viewerBilling = !!viewer?.viewerBilling;
  const manage = !deleted && !left && !staff && (admin || canvasser);
  const staffUnderGrant = staff && !!viewer?.underGrant;
  return {
    admin,
    isSelf,
    staff,
    canEditProfile: manage,
    // Never on your own row: it would lock you out of the console until you choose a new one.
    canSetTempPassword: manage && !isSelf,
    // Never-signed-in only: a fresh link kills any earlier one, so a working account never gets offered it.
    // Never on your own row (the phone's rule too).
    canResendInvite: manage && !isSelf && !person.lastLoginAt,
    canToggleActive: manage && !isSelf,
    canUnpause: !isSelf && openPause?.status === 'paused' && (admin || !!openPause.blocking),
    // A Doorline staff row is never a lead's to remove, even with no membership here (the server's 403).
    canRemoveFromCampaign: onTeam && !archived && (admin || isSelf || (!staff && (left || canvasser))),
    // Their crew here: anyone on the team, but a lead never sets Doorline staff's (the bulk route's rule,
    // and the phone's).
    canSetCrew: admin || !staff,
    canEditRole: admin && !isSelf && !!membership && !deleted && !staffUnderGrant,
    canRemoveFromOrg: admin && !isSelf && !!membership && !billingLocked(membership, viewerBilling) && !staffUnderGrant,
    canOfferDelete: !!membership && canOfferDelete({ isOrgAdmin: admin, isSelf, membership, viewerBilling }),
    showEverywhere: admin && !deleted,
  };
};

// The buttons for a person's state (Part 1's table): `top` sit in the row at the top, `more` behind
// More options ▸. Anything the state doesn't put at the top but the viewer may still do goes in
// `more`, so no power is lost to the layout.
//   deactivated          Reactivate account
//   never signed in      Resend invite, Set temporary password
//   no sign-in recorded  Set temporary password; Resend invite under More options
//   paused for review    Unpause (or, when this viewer can't, Set temporary password)
//   no longer in the org none; Remove from this campaign under More options
//   otherwise            Set temporary password
export const actionsFor = ({ standing, access: a, onTeam = false }) => {
  const top = [];
  const more = [];
  const add = (list, id, ok) => {
    if (ok) list.push(id);
  };
  if (standing === 'deactivated') {
    add(top, 'reactivate', a.canToggleActive);
  } else if (standing === 'never-signed-in') {
    add(top, 'resend', a.canResendInvite);
    add(top, 'temp-password', a.canSetTempPassword);
  } else if (standing === 'no-sign-in-recorded') {
    add(top, 'temp-password', a.canSetTempPassword);
    add(more, 'resend', a.canResendInvite);
  } else if (standing === 'paused') {
    add(top, 'unpause', a.canUnpause);
    add(a.canUnpause ? more : top, 'temp-password', a.canSetTempPassword);
    add(more, 'resend', a.canResendInvite);
  } else if (standing === 'active') {
    add(top, 'temp-password', a.canSetTempPassword);
  }
  const member = standing !== 'deleted' && standing !== 'left';
  // An open pause that doesn't block right now (automatic pause switched off) can still be lifted.
  add(more, 'unpause', member && standing !== 'paused' && a.canUnpause);
  add(more, 'deactivate', member && standing !== 'deactivated' && a.canToggleActive);
  add(more, 'remove-campaign', onTeam && a.canRemoveFromCampaign);
  add(more, 'remove-org', member && a.canRemoveFromOrg);
  add(more, 'delete', member && a.canOfferDelete);
  return { top, more };
};
