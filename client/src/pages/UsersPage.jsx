import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import Pager from '../components/Pager.jsx';
import PersonPanel from '../components/people/PersonPanel.jsx';
import AddPeopleDialog from '../components/team/AddPeopleDialog.jsx';
import CampaignChips from '../components/integrations/CampaignChips.jsx';
import { tempPasswordProblem } from '../lib/validators.js';
import { DELETED_ACCOUNT, deletionLine } from '../lib/memberDeletion.js';
import { pausedUserIds } from '../lib/pacePause.js';
import { personFromMember } from '../lib/personAccess.js';
import { pageFor } from '../lib/personStepping.js';
import { clampPage, isAccountOn, pageOf, standing } from '../lib/rosterView.js';
import { useListParams } from '../lib/useListParams.js';
import {
  Card,
  Button,
  Badge,
  Avatar,
  DataTable,
  EmptyState,
  SkeletonRows,
  Input,
  PhoneInput,
  Select,
  IconSearch,
  IconChevronRight,
  IconUsers,
} from '../components/ui';

// The organization's members (/users; docs/PROPOSAL_PEOPLE_PAGES.md §F). 25 to a page, filtered by role,
// status and campaign, with the filters, sort, page and the open person in the address (replace, so Back
// leaves the page; lib/listParams.js). Clicking a person opens the person panel — the same one every
// campaign's Team page uses. Add member adds someone to the organization; for a canvasser it can also
// take a Campaign, which hands what was typed to that campaign's add-by-email steps (with the Crew choice
// and their confirmations). ?return= (from a campaign's setup) keeps its "‹ Back to setup".

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  role: 'canvasser',
  managedCampaignIds: [],
  campaignId: '',
};

const ROLE_LABEL = { admin: 'Admin', lead: 'Team lead', canvasser: 'Canvasser' };

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'recent-joined', label: 'Recently joined' },
  { value: 'recent-signin', label: 'Recent password login' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'paused', label: 'Paused' },
  { value: 'never-signed-in', label: 'Never signed in' },
  { value: 'deleted', label: 'Deleted' },
];

const PAGE = 25;
const DEFAULTS = { role: 'all', status: 'all', campaign: 'all', q: '', sort: 'name-asc', page: '1', person: '', return: '' };

function compareName(a, b, dir) {
  // Sort by the displayed "First Last" order so the list reads alphabetically.
  const an = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
  const bn = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
  if (an < bn) return dir === 'asc' ? -1 : 1;
  if (an > bn) return dir === 'asc' ? 1 : -1;
  return 0;
}

function compareDate(a, b, key) {
  const av = a[key] ? new Date(a[key]).getTime() : 0;
  const bv = b[key] ? new Date(b[key]).getTime() : 0;
  if (av === 0 && bv === 0) return 0;
  if (av === 0) return 1;
  if (bv === 0) return -1;
  return bv - av;
}

// Sorts lastLoginAt, and says so — it used to be labeled "Recently active", which it never was. It
// can't be repointed at real activity either: lastSeenAt is super-admin-only by design and absent from
// /admin/memberships, which is what feeds this page.
const sortMembers = (list, sortMode) => {
  const out = list.slice();
  if (sortMode === 'name-desc') out.sort((a, b) => compareName(a, b, 'desc'));
  else if (sortMode === 'recent-joined') out.sort((a, b) => compareDate(a, b, 'addedAt'));
  else if (sortMode === 'recent-signin')
    out.sort((a, b) => compareDate({ lastLoginAt: a.user.lastLoginAt }, { lastLoginAt: b.user.lastLoginAt }, 'lastLoginAt'));
  else out.sort((a, b) => compareName(a, b, 'asc'));
  return out;
};

// A small on/off switch for an admin's billing access. Stops row-click so
// flipping the switch doesn't also open the member's profile.
function BillingToggle({ on, pending, onToggle, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Billing access for ${label}`}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 ${
        on ? 'bg-brand-600' : 'bg-border-strong'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const UsersPage = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canViewBilling } = useAuth();
  const orgTz = useOrgTimeZone();
  const [params, setParams] = useListParams(DEFAULTS);
  const returnTo = params.return || null; // set when arriving from a campaign's setup flow
  const personId = params.person || null;

  const { data, isLoading } = useQuery({
    queryKey: ['memberships'],
    queryFn: ({ signal }) => api('/admin/memberships', { signal }),
  });
  // Campaigns: the Campaigns column, the campaign filter, a lead's grants, and Add member's Campaign.
  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: ({ signal }) => api('/admin/campaigns', { signal }) });
  // Automatic pause: who is blocked right now, for the row chip and the Paused filter (docs/PROPOSAL_PACE_PAUSE.md §G.4).
  const pausedQ = useQuery({
    queryKey: ['admin', 'pace-pauses', 'list', 'org-paused'],
    queryFn: ({ signal }) => api('/admin/pace-pauses?status=paused', { signal }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const pausedIds = useMemo(() => pausedUserIds(pausedQ.data), [pausedQ.data]);
  const campaigns = campaignsQ.data?.campaigns || [];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [emailLookup, setEmailLookup] = useState(false);
  const [formError, setFormError] = useState('');
  // Add member with a Campaign hands over to that campaign's add-by-email steps.
  const [handover, setHandover] = useState(null);
  // Set only when adding a member actually moved existing ledger rows onto a team (a returning
  // canvasser whose knocks outlived their old membership).
  const [restampNotice, setRestampNotice] = useState('');
  // Set by the panel after Delete account ("Sam Rivera's account was deleted.").
  const [deleteNotice, setDeleteNotice] = useState('');

  const [search, setSearch] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== search.trim()) setSearch(params.q);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== params.q) setParams({ q: search.trim(), page: 1 });
    }, 150);
    return () => clearTimeout(t);
  }, [search, params.q, setParams]);

  const addMember = useMutation({
    mutationFn: (body) => api('/admin/memberships', { method: 'POST', body }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      // Linking a RETURNING canvasser can bring ledger history back with them: removing someone
      // from the org deletes their Membership but keeps their knocks, so re-adding them re-stamps
      // those rows onto their new coordinator. This flash is the only signal the admin gets that
      // the person they just added arrived with work attached.
      const moved = res?.restamp?.activities || 0;
      if (moved) {
        qc.invalidateQueries({ queryKey: ['team-breakdown'] });
        setRestampNotice(
          `Moved ${moved.toLocaleString()} existing door record${moved === 1 ? '' : 's'} onto their team.`
        );
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEmailLookup(false);
    },
    onError: (err) => {
      // The email already exists globally — nudge the admin toward the link path.
      if (err.data?.code === 'EMAIL_EXISTS_USE_LINK') setEmailLookup(true);
    },
  });

  // Grant/revoke an admin's access to the org's Billing page. Server enforces that
  // the caller is themselves a billing admin (or super); we only surface the control
  // when the current user can view billing.
  const saveBilling = useMutation({
    mutationFn: ({ userId, billingAccess }) =>
      api(`/admin/memberships/${userId}`, { method: 'PATCH', body: { billingAccess } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
  });

  const members = data?.members || [];
  const peopleById = useMemo(() => new Map(members.map((m) => [String(m.user.id), personFromMember(m)])), [members]);

  // Search → filters → sort, then a page of 25.
  const visibleMembers = useMemo(() => {
    const term = params.q.toLowerCase();
    const list = members.filter((m) => {
      if (params.role !== 'all' && m.role !== params.role) return false;
      const p = peopleById.get(String(m.user.id));
      const st = standing(p, pausedIds);
      if (params.status === 'active' && !isAccountOn(p)) return false;
      if (params.status === 'deactivated' && p.status !== 'deactivated') return false;
      if (params.status === 'paused' && !pausedIds.has(p.userId)) return false;
      if (params.status === 'never-signed-in' && st !== 'never-signed-in') return false;
      if (params.status === 'deleted' && p.status !== 'deleted') return false;
      if (params.campaign !== 'all' && !(m.campaignIds || []).map(String).includes(params.campaign)) return false;
      if (term) {
        // A deleted account is found by its label, never by the tombstone address it now holds.
        const hay = (m.user.isDeleted ? DELETED_ACCOUNT : `${m.user.firstName} ${m.user.lastName} ${m.user.email}`).toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return sortMembers(list, params.sort);
  }, [members, peopleById, pausedIds, params.q, params.role, params.status, params.campaign, params.sort]);
  const liveIds = useMemo(() => visibleMembers.map((m) => String(m.user.id)), [visibleMembers]);
  const page = clampPage(params.page, visibleMembers.length, PAGE);
  const pageMembers = pageOf(visibleMembers, page, PAGE);

  const setFilter = (patch) => setParams({ ...patch, page: 1 });

  // The person panel: ?person=; stepping turns the page; closing puts focus back on their row.
  const lastPersonRef = useRef(null);
  const lookup = useCallback((id) => peopleById.get(String(id)) || null, [peopleById]);
  const place = useCallback(
    (id) => {
      const m = members.find((x) => String(x.user.id) === String(id));
      return m ? sortMembers([...visibleMembers, m], params.sort).map((x) => String(x.user.id)) : null;
    },
    [members, visibleMembers, params.sort]
  );
  const openPerson = (id) => setParams({ person: id });
  const closePanel = () => {
    lastPersonRef.current = personId;
    setParams({ person: null });
  };
  useEffect(() => {
    if (personId || !lastPersonRef.current) return;
    const id = lastPersonRef.current;
    lastPersonRef.current = null;
    document.querySelector(`[data-person-row="${id}"]`)?.focus();
  }, [personId]);
  const scope = useMemo(() => ({ kind: 'org', pausedIds, rosterLines: [] }), [pausedIds]);

  function onSubmit(e) {
    e.preventDefault();
    // A canvasser with a campaign: the campaign's add-by-email steps take it from here, and look the
    // address up at once.
    if (form.role === 'canvasser' && form.campaignId) {
      const campaign = campaigns.find((c) => String(c._id) === form.campaignId);
      if (campaign) {
        setFormError('');
        setHandover({
          campaign,
          initial: emailLookup
            ? { email: form.email.trim() }
            : { email: form.email.trim(), firstName: form.firstName, lastName: form.lastName, phone: form.phone, password: form.password },
        });
        return;
      }
    }
    const body = {
      email: form.email.trim(),
      role: form.role,
      linkExisting: emailLookup,
    };
    if (form.role === 'lead') body.managedCampaignIds = form.managedCampaignIds;
    if (!emailLookup) {
      // A new account: the temp password is OPTIONAL. Blank → the server generates a throwaway
      // nobody sees and the invitee's way in is the emailed set-password link. Only a TYPED one
      // gets the min-8 check; the empty case is intentionally allowed here (validators unchanged).
      if (form.password !== '') {
        const problem = tempPasswordProblem(form.password);
        if (problem) {
          setFormError(problem);
          return;
        }
      }
      body.firstName = form.firstName;
      body.lastName = form.lastName;
      body.phone = form.phone;
      body.password = form.password;
    }
    setFormError('');
    addMember.mutate(body);
  }

  function toggleFormCampaign(id, checked) {
    setForm((s) => ({
      ...s,
      managedCampaignIds: checked
        ? [...new Set([...s.managedCampaignIds, id])]
        : s.managedCampaignIds.filter((x) => x !== id),
    }));
  }

  const labelCls = 'block text-xs font-medium text-fg';
  // Table column count — the optional Billing-access column shifts the empty-state colSpans.
  // The Hours column only exists where the org actually has an FbTime connection,
  // which the server signals by sending `fbtime` on a member at all (admin-only).
  const showHours = members.some((m) => m.fbtime);
  const colCount = 5 + (canViewBilling ? 1 : 0) + (showHours ? 1 : 0);
  const activeCampaigns = campaigns.filter((c) => c.isActive !== false);

  return (
    <div>
      {returnTo && (
        <Link to={returnTo} className="mb-3 inline-block text-sm font-medium text-brand-accent hover:underline">
          ‹ Back to setup
        </Link>
      )}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Users</h1>
          <p className="text-sm text-fg-muted">
            Members of this organization — the canvassers you assign books to. (Voter records live under Voters.)
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {!showForm && <span className="text-base leading-none">+</span>}
          {showForm ? 'Cancel' : 'Add member'}
        </Button>
      </div>

      {showForm && (
        <Card as="form" onSubmit={onSubmit} className="mb-6 grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <div className="md:col-span-3 flex items-center gap-2 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={emailLookup}
                onChange={(e) => {
                  setEmailLookup(e.target.checked);
                  setFormError('');
                }}
              />
              <span className="text-fg-muted">Existing user (by email — link them to this org)</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Email</label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              required
              className="mt-1"
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <Select
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              className="mt-1 w-full"
            >
              <option value="canvasser">Canvasser</option>
              <option value="lead">Team lead</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          {form.role === 'lead' && (
            <div className="md:col-span-3 rounded-md border border-border bg-sunken p-3">
              <label className={labelCls}>Campaigns this lead manages</label>
              <p className="mt-0.5 text-xs text-fg-muted">
                A team lead fully runs the campaigns you check here — and only those.
              </p>
              <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded border border-border-strong bg-card p-2">
                {campaigns.length === 0 && (
                  <p className="px-1 py-2 text-xs text-fg-muted">No campaigns yet — create one first.</p>
                )}
                {campaigns.map((c) => {
                  const id = String(c._id);
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={form.managedCampaignIds.includes(id)}
                        onChange={(e) => toggleFormCampaign(id, e.target.checked)}
                      />
                      <span className="truncate">
                        {c.name}
                        {c.isActive === false ? ' · Archived' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {/* A crew only means something inside a campaign, so a canvasser's Campaign hands what was
              typed to that campaign's add steps, which pick the crew and show how many doors it moves.
              An admin or team lead is added to the organization only, as before. */}
          {form.role === 'canvasser' && (
            <div className="md:col-span-3">
              <label className={labelCls}>
                Campaign <span className="text-fg-subtle">(optional)</span>
              </label>
              <Select
                value={form.campaignId}
                onChange={(e) => setForm((s) => ({ ...s, campaignId: e.target.value }))}
                className="mt-1 w-full md:w-80"
              >
                <option value="">Just the organization</option>
                {activeCampaigns.map((c) => (
                  <option key={c._id} value={String(c._id)}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {form.campaignId && (
                <p className="mt-1 text-xs text-fg-muted">
                  Next you’ll confirm who the address belongs to and pick their crew on that campaign.
                </p>
              )}
            </div>
          )}

          {!emailLookup && (
            <>
              <div>
                <label className={labelCls}>First name</label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))}
                  required={!(form.role === 'canvasser' && form.campaignId)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className={labelCls}>Last name</label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))}
                  required={!(form.role === 'canvasser' && form.campaignId)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className={labelCls}>
                  Phone <span className="text-fg-subtle">(optional)</span>
                </label>
                <PhoneInput
                  value={form.phone}
                  onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Temporary password <span className="text-fg-subtle">(optional)</span></label>
                <div className="mt-1">
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                    autoComplete="new-password"
                  />
                </div>
                <p className="mt-1 text-xs text-fg-subtle">
                  Leave blank to let them set their own password via the emailed invite (recommended).
                  Type one only if they can’t receive email.
                </p>
              </div>
            </>
          )}

          <div className="md:col-span-3">
            <Button type="submit" loading={addMember.isPending}>
              {form.role === 'canvasser' && form.campaignId ? 'Continue' : emailLookup ? 'Link existing user' : 'Create + add'}
            </Button>
            {(formError || addMember.error) && (
              <span className="ml-3 text-sm text-danger">{formError || addMember.error.message}</span>
            )}
          </div>
        </Card>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-2.5">
        <div className="min-w-[220px] flex-1">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search name or email"
            leadingIcon={<IconSearch size={16} />}
          />
        </div>
        <Select value={params.role} onChange={(e) => setFilter({ role: e.target.value })} aria-label="Role">
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="lead">Team leads</option>
          <option value="canvasser">Canvassers</option>
        </Select>
        <Select value={params.status} onChange={(e) => setFilter({ status: e.target.value })} aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={params.campaign} onChange={(e) => setFilter({ campaign: e.target.value })} aria-label="Campaign">
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c._id} value={String(c._id)}>
              {c.name}
              {c.isActive === false ? ' · Archived' : ''}
            </option>
          ))}
        </Select>
        <Select value={params.sort} onChange={(e) => setFilter({ sort: e.target.value })} aria-label="Sort">
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted">
          {visibleMembers.length} of {members.length}
        </span>
      </Card>

      {/* Adding a RETURNING canvasser can pull ledger history back onto a team — say so, because
          a team total will have changed for a reason the admin never explicitly asked for. */}
      {restampNotice && (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-md border border-brand-600 bg-brand-tint px-3 py-2 text-sm text-fg"
        >
          <span className="flex-1">{restampNotice}</span>
          <button
            type="button"
            onClick={() => setRestampNotice('')}
            className="shrink-0 font-semibold hover:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* After Delete account in the panel. A used account's row turns into "Deleted account"; an
          unused one's leaves the list, and then this is the only sign the delete landed. */}
      {deleteNotice && (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-md border border-brand-600 bg-brand-tint px-3 py-2 text-sm text-fg"
        >
          <span className="flex-1">{deleteNotice}</span>
          <button
            type="button"
            onClick={() => setDeleteNotice('')}
            className="shrink-0 font-semibold hover:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* A refused billing-access change (notably LAST_BILLING_ADMIN — the org can't be left with
          no billing admin) surfaces here. The toggle itself is server-data-driven, so it snaps
          back on its own; this is the "why". Clears on the next toggle attempt (mutate resets). */}
      {saveBilling.isError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger"
        >
          <span className="flex-1">{saveBilling.error.message}</span>
          <button
            type="button"
            onClick={() => saveBilling.reset()}
            className="shrink-0 font-semibold hover:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {isLoading ? (
        <Card className="overflow-hidden">
          <SkeletonRows />
        </Card>
      ) : (
        <>
          <DataTable
            head={
              <>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Campaigns</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Status</th>
                {showHours && <th className="px-4 py-2.5">Hours</th>}
                {canViewBilling && <th className="px-4 py-2.5">Billing access</th>}
                <th className="w-8 px-4 py-2.5"></th>
              </>
            }
          >
            {pageMembers.map((m) => {
              const u = m.user;
              const id = String(u.id);
              const p = peopleById.get(id);
              const st = standing(p, pausedIds);
              const on = isAccountOn(p);
              return (
                <tr
                  key={m.membershipId}
                  onClick={() => openPerson(id)}
                  className="group cursor-pointer transition-colors hover:bg-sunken/60"
                >
                  <td className="px-4 py-3">
                    {/* The row's keyboard way in: the name is a button that opens the panel. */}
                    <button
                      type="button"
                      data-person-row={id}
                      onClick={(e) => {
                        e.stopPropagation();
                        openPerson(id);
                      }}
                      className="flex w-full items-center gap-3 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* A deleted account's row: "Deleted account", then who deleted it and when. Its
                          email is the tombstone address, never shown. */}
                      {u.isDeleted ? (
                        <>
                          <Avatar name="?" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-fg">{DELETED_ACCOUNT}</span>
                            {m.deletion && <span className="block truncate text-xs text-fg-muted">{deletionLine(m.deletion, orgTz)}</span>}
                          </span>
                        </>
                      ) : (
                        <>
                          <Avatar user={u} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium text-fg">
                              <span className="truncate">
                                {u.firstName} {u.lastName}
                              </span>
                              {u.isSuperAdmin && (
                                <Badge variant="warning" className="uppercase tracking-wide">
                                  super
                                </Badge>
                              )}
                            </span>
                            <span className="block truncate text-xs text-fg-muted">{u.email}</span>
                          </span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {/* Rostered campaigns (CampaignAssignment), active-only chips. The ids ride
                        /admin/memberships already, and this page holds /admin/campaigns for the names. */}
                    <CampaignChips
                      campaigns={(m.campaignIds || [])
                        .map((cid) => campaigns.find((c) => String(c._id) === String(cid)))
                        .filter((c) => c && c.isActive !== false)
                        .map((c) => ({ id: String(c._id), name: c.name }))}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={m.role === 'admin' ? 'brand' : m.role === 'lead' ? 'info' : 'neutral'}>
                      {ROLE_LABEL[m.role] || 'Canvasser'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {u.isDeleted ? (
                      <Badge variant="neutral">Deleted</Badge>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={on ? 'success' : 'neutral'} dot>
                          {on ? 'Active' : 'Deactivated'}
                        </Badge>
                        {pausedIds.has(id) && <Badge variant="danger">Paused for review</Badge>}
                        {st === 'never-signed-in' && <Badge variant="warning">Never signed in</Badge>}
                      </div>
                    )}
                  </td>
                  {showHours && (
                    <td className="px-4 py-3">
                      {m.fbtime?.linked ? (
                        <Badge variant="success" title={m.fbtime.personName || undefined}>
                          Measured
                        </Badge>
                      ) : u.isDeleted ? (
                        // Nobody can link a deleted account, so no "Not linked" nudge.
                        <span className="text-fg-subtle">—</span>
                      ) : (
                        <Link
                          to="/integrations"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
                        >
                          Not linked
                        </Link>
                      )}
                    </td>
                  )}
                  {canViewBilling && (
                    <td className="px-4 py-3">
                      {m.role === 'admin' && !u.isDeleted ? (
                        <BillingToggle
                          on={!!m.billingAccess}
                          pending={saveBilling.isPending && saveBilling.variables?.userId === u.id}
                          onToggle={() => saveBilling.mutate({ userId: u.id, billingAccess: !m.billingAccess })}
                          label={`${u.firstName} ${u.lastName}`}
                        />
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-fg-subtle transition-colors group-hover:text-fg-muted">
                    <IconChevronRight className="ml-auto" />
                  </td>
                </tr>
              );
            })}
            {!members.length && (
              <tr>
                <td colSpan={colCount}>
                  <EmptyState
                    icon={<IconUsers size={22} />}
                    title="No members yet"
                    hint={<>Click <strong>Add member</strong> to start.</>}
                  />
                </td>
              </tr>
            )}
            {members.length > 0 && !visibleMembers.length && (
              <tr>
                <td colSpan={colCount} className="px-4 py-14 text-center text-sm text-fg-muted">
                  No members match your filters.
                </td>
              </tr>
            )}
          </DataTable>
          {visibleMembers.length > PAGE && (
            <Pager
              skip={(page - 1) * PAGE}
              limit={PAGE}
              total={visibleMembers.length}
              onChange={(skip) => setParams({ page: Math.floor(skip / PAGE) + 1 })}
              className="mt-3"
            />
          )}
        </>
      )}

      {handover && (
        <AddPeopleDialog
          campaign={handover.campaign}
          isOrgAdmin
          initial={handover.initial}
          onAdded={() => {
            const cid = String(handover.campaign._id);
            qc.invalidateQueries({ queryKey: ['memberships'] });
            // So "Open them" lands on that campaign's Team page with them in it.
            qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cid] });
            qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cid] });
            qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', cid] });
            setShowForm(false);
            setForm(EMPTY_FORM);
            setEmailLookup(false);
          }}
          onOpenPerson={(id) => navigate(`/campaigns/${handover.campaign._id}/team?person=${id}`)}
          onClose={() => setHandover(null)}
        />
      )}

      {personId && (
        <PersonPanel
          personId={personId}
          ids={liveIds}
          place={place}
          lookup={lookup}
          loaded={!!data && !pausedQ.isLoading}
          scope={scope}
          onStep={(id) => setParams({ person: id, page: pageFor(liveIds, id, PAGE, page) })}
          onClose={closePanel}
          onDeleted={setDeleteNotice}
        />
      )}
    </div>
  );
};

export default UsersPage;
