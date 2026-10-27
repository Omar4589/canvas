import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personAccess, actionsFor, personFromMember, personFromRoster } from './personAccess.js';
import { standing } from './rosterView.js';

const ADMIN = { userId: 'me', isOrgAdmin: true, viewerBilling: false };
const LEAD = { userId: 'me', isOrgAdmin: false, viewerBilling: false };

const member = (over = {}, user = {}) => ({
  membershipId: 'm1',
  role: 'canvasser',
  isActive: true,
  billingAccess: false,
  addedAt: '2026-06-01T00:00:00Z',
  managedCampaignIds: [],
  user: {
    id: 'u7',
    firstName: 'Sam',
    lastName: 'Rivera',
    email: 'sam@t.co',
    isActive: true,
    isDeleted: false,
    isSuperAdmin: false,
    lastLoginAt: '2026-10-20T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    ...user,
  },
  ...over,
});
const rosterRow = (over = {}) => ({
  userId: 'u7',
  firstName: 'Sam',
  lastName: 'Rivera',
  email: 'sam@t.co',
  status: 'active',
  isSuperAdmin: false,
  lastLoginAt: '2026-10-20T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: null,
  assignedAt: '2026-10-01T00:00:00Z',
  ...over,
});

test('the two pages’ records read the same way', () => {
  const org = personFromMember(member({ isActive: false }));
  assert.equal(org.status, 'deactivated', 'a switched-off membership');
  assert.equal(personFromMember(member({}, { isDeleted: true })).status, 'deleted');
  const team = personFromRoster(rosterRow({ status: 'removed' }));
  assert.equal(standing(team), 'left', 'rosterView reads both');
  assert.equal(personFromRoster(rosterRow(), member({}, { isMultiOrg: true })).isMultiOrg, true, 'the org row adds the multi-org lock');
});

test('an org admin: everything for an ordinary person, never the temporary password or the switch on yourself', () => {
  const sam = personFromMember(member());
  const a = personAccess({ viewer: ADMIN, person: sam });
  assert.equal(a.canEditProfile && a.canSetTempPassword && a.canToggleActive && a.canEditRole && a.canRemoveFromOrg, true);
  assert.equal(a.canOfferDelete, true);
  assert.equal(a.showEverywhere, true);
  assert.equal(a.canResendInvite, false, 'they have signed in: no invite to resend');
  const self = personAccess({ viewer: { ...ADMIN, userId: 'u7' }, person: sam });
  assert.equal(self.canSetTempPassword, false, 'it would lock you out of the console');
  assert.equal(self.canToggleActive || self.canEditRole || self.canRemoveFromOrg || self.canOfferDelete, false);
  assert.equal(self.canEditProfile, true, 'your own name and phone');
});

test('a Doorline staff account and a deleted one are not the org’s to manage', () => {
  const staff = personAccess({ viewer: ADMIN, person: personFromMember(member({}, { isSuperAdmin: true })) });
  assert.equal(staff.staff, true);
  assert.equal(staff.canEditProfile || staff.canSetTempPassword || staff.canToggleActive || staff.canOfferDelete, false);
  assert.equal(staff.canRemoveFromOrg, true, 'Remove from org, as today');
  const gone = personAccess({ viewer: ADMIN, person: personFromMember(member({ billingAccess: true }, { isDeleted: true })) });
  assert.equal(gone.canEditProfile || gone.canOfferDelete || gone.showEverywhere, false);
  assert.equal(gone.canRemoveFromOrg, true, 'a deleted row is anyone’s to tidy, billing access or not');
});

test('billing: a billing admin’s row needs billing access to remove or delete', () => {
  const row = personFromMember(member({ role: 'admin', billingAccess: true }));
  const without = personAccess({ viewer: ADMIN, person: row });
  assert.equal(without.canRemoveFromOrg || without.canOfferDelete, false);
  assert.equal(without.canToggleActive, true, 'the switch is not part of the billing rule');
  const withBilling = personAccess({ viewer: { ...ADMIN, viewerBilling: true }, person: row });
  assert.equal(withBilling.canRemoveFromOrg && withBilling.canOfferDelete, true);
});

test('a team lead manages canvassers only, and never sees Role, Remove from org, Delete or Everywhere', () => {
  const sam = personFromRoster(rosterRow());
  const a = personAccess({ viewer: LEAD, person: sam, onTeam: true });
  assert.equal(a.canEditProfile && a.canSetTempPassword && a.canToggleActive && a.canRemoveFromCampaign, true);
  assert.equal(a.canEditRole || a.canRemoveFromOrg || a.canOfferDelete || a.showEverywhere, false);
  const otherLead = personAccess({ viewer: LEAD, person: personFromRoster(rosterRow({ role: 'lead' })), onTeam: true });
  assert.equal(otherLead.canEditProfile || otherLead.canToggleActive || otherLead.canRemoveFromCampaign, false, 'read-only');
  const left = personAccess({ viewer: LEAD, person: personFromRoster(rosterRow({ role: 'lead', status: 'removed' })), onTeam: true });
  assert.equal(left.canRemoveFromCampaign, true, 'someone no longer in the org is no one’s to protect');
  const self = personAccess({ viewer: { ...LEAD, userId: 'u7' }, person: personFromRoster(rosterRow({ role: 'lead' })), onTeam: true });
  assert.equal(self.canRemoveFromCampaign, true, 'themselves');
  const staff = personAccess({ viewer: LEAD, person: personFromRoster(rosterRow({ isSuperAdmin: true })), onTeam: true });
  assert.equal(staff.canRemoveFromCampaign, false);
});

test('Unpause: only a blocking pause the viewer can see, never on yourself; and never on an archived campaign’s remove', () => {
  const sam = personFromRoster(rosterRow());
  const open = { id: 'p1', status: 'paused', blocking: true };
  assert.equal(personAccess({ viewer: LEAD, person: sam, openPause: open }).canUnpause, true);
  assert.equal(personAccess({ viewer: LEAD, person: sam, openPause: { ...open, blocking: false } }).canUnpause, false);
  assert.equal(personAccess({ viewer: LEAD, person: sam, openPause: null }).canUnpause, false, 'paused elsewhere: no pause in their list');
  assert.equal(personAccess({ viewer: { ...ADMIN, userId: 'u7' }, person: sam, openPause: open }).canUnpause, false);
  assert.equal(personAccess({ viewer: ADMIN, person: sam, onTeam: true, archived: true }).canRemoveFromCampaign, false);
  // An org admin lifts any open pause, blocking or not (automatic pause switched off), as the profile did.
  const idle = { ...open, blocking: false };
  const adminIdle = personAccess({ viewer: ADMIN, person: sam, openPause: idle });
  assert.equal(adminIdle.canUnpause, true);
  assert.ok(actionsFor({ standing: standing(sam), access: adminIdle }).more.includes('unpause'), 'not paused right now: under More options');
});

test('Doorline staff under a support grant is offered no Role or Remove from org on another staff account', () => {
  const staffRow = personFromMember(member({}, { isSuperAdmin: true }));
  const grant = personAccess({ viewer: { ...ADMIN, underGrant: true }, person: staffRow });
  assert.equal(grant.canEditRole || grant.canRemoveFromOrg, false, 'the server answers STAFF_SELF_MINT');
  const customer = personAccess({ viewer: ADMIN, person: staffRow });
  assert.equal(customer.canEditRole && customer.canRemoveFromOrg, true, 'the customer’s own admin still may');
  const sam = personFromMember(member());
  assert.equal(personAccess({ viewer: { ...ADMIN, underGrant: true }, person: sam }).canRemoveFromOrg, true, 'only staff targets');
});

test('the state buttons follow Part 1’s table', () => {
  const at = (over, opts = {}) => {
    const person = personFromRoster(rosterRow(over));
    const access = personAccess({ viewer: ADMIN, person: { ...person, membership: member() }, onTeam: true, ...opts });
    return actionsFor({ standing: standing(person, opts.paused || new Set()), access, onTeam: true });
  };
  assert.deepEqual(at({ status: 'deactivated' }).top, ['reactivate']);
  assert.ok(!at({ status: 'deactivated' }).more.includes('deactivate'));
  const never = at({ lastLoginAt: null, createdAt: '2026-06-01T00:00:00Z' });
  assert.deepEqual(never.top, ['resend', 'temp-password']);
  const old = at({ lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' });
  assert.deepEqual(old.top, ['temp-password']);
  assert.ok(old.more.includes('resend'), 'Resend invite under More options');
  const paused = at({}, { paused: new Set(['u7']), openPause: { id: 'p', status: 'paused', blocking: true } });
  assert.deepEqual(paused.top, ['unpause']);
  assert.ok(paused.more.includes('temp-password'));
  assert.deepEqual(at({ status: 'removed' }).top, []);
  assert.deepEqual(at({ status: 'removed' }).more, ['remove-campaign'], 'No longer in the org: Remove from this campaign only');
  const active = at({});
  assert.deepEqual(active.top, ['temp-password']);
  assert.deepEqual(active.more, ['deactivate', 'remove-campaign', 'remove-org', 'delete']);
});

test('your own row never offers the temporary password; the Users page has no Remove from this campaign', () => {
  const person = personFromMember(member());
  const self = personAccess({ viewer: { ...ADMIN, userId: 'u7' }, person });
  assert.deepEqual(actionsFor({ standing: standing(person), access: self }), { top: [], more: [] });
  const other = personAccess({ viewer: ADMIN, person });
  assert.ok(!actionsFor({ standing: standing(person), access: other }).more.includes('remove-campaign'));
});

test('the rules the phone shares (mobile/lib/personActions.js): own-row invite, staff remove and staff crew', () => {
  // No invite on your own row, even an older account with no sign-in on record.
  const me = personFromRoster(rosterRow({ userId: 'me', lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }));
  assert.equal(personAccess({ viewer: ADMIN, person: me, onTeam: true }).canResendInvite, false);
  // A Doorline staff row with no membership here is still not a lead's to remove (the server's 403).
  const staffGone = personFromRoster(rosterRow({ isSuperAdmin: true, status: 'removed' }));
  assert.equal(personAccess({ viewer: LEAD, person: staffGone, onTeam: true }).canRemoveFromCampaign, false);
  assert.equal(personAccess({ viewer: ADMIN, person: staffGone, onTeam: true }).canRemoveFromCampaign, true);
  // A lead never sets a staff account's crew; an org admin does.
  const staff = personFromRoster(rosterRow({ isSuperAdmin: true }));
  assert.equal(personAccess({ viewer: LEAD, person: staff, onTeam: true }).canSetCrew, false);
  assert.equal(personAccess({ viewer: ADMIN, person: staff, onTeam: true }).canSetCrew, true);
  assert.equal(personAccess({ viewer: LEAD, person: personFromRoster(rosterRow()), onTeam: true }).canSetCrew, true);
});
