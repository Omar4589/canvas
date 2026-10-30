import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import Pager from '../components/Pager.jsx';
import PersonPanel from '../components/people/PersonPanel.jsx';
import AddPersonDialog from '../components/people/AddPersonDialog.jsx';
import CampaignChips from '../components/integrations/CampaignChips.jsx';
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
  Select,
  IconSearch,
  IconChevronRight,
  IconUsers,
} from '../components/ui';

// The organization's members (/users; docs/PROPOSAL_PEOPLE_PAGES.md §F). 25 to a page, filtered by role,
// status and campaign, with the filters, sort, page and the open person in the address (replace, so Back
// leaves the page; lib/listParams.js). Clicking a person opens the person panel — the same one every
// campaign's Team page uses. Add member asks for the email first, then a role and, for a canvasser, the
// campaigns to put them on with a crew for each — or none (components/people/AddPersonDialog.jsx,
// docs/PROPOSAL_ADD_TO_CAMPAIGNS.md). ?return= (from a campaign's setup) keeps its "‹ Back to setup".

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
  const { canViewBilling } = useAuth();
  const orgTz = useOrgTimeZone();
  const [params, setParams] = useListParams(DEFAULTS);
  const returnTo = params.return || null; // set when arriving from a campaign's setup flow
  const personId = params.person || null;

  const { data, isLoading, isFetching } = useQuery({
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

  // Add member: the email-first window (components/people/AddPersonDialog.jsx).
  const [showAdd, setShowAdd] = useState(false);
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

  // Table column count — the optional Billing-access column shifts the empty-state colSpans.
  // The Hours column only exists where the org actually has an FbTime connection,
  // which the server signals by sending `fbtime` on a member at all (admin-only).
  const showHours = members.some((m) => m.fbtime);
  const colCount = 5 + (canViewBilling ? 1 : 0) + (showHours ? 1 : 0);

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
        <Button onClick={() => setShowAdd(true)}>
          <span className="text-base leading-none">+</span>
          Add member
        </Button>
      </div>

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

      {showAdd && (
        <AddPersonDialog
          campaigns={campaigns.filter((c) => c.isActive !== false)}
          onAdded={(result) => {
            qc.invalidateQueries({ queryKey: ['memberships'] });
            // So each campaign it put them on shows them on its Team page straight away.
            for (const c of result?.campaigns || []) {
              if (c.result !== 'joined') continue;
              qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', c.campaignId] });
              qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', c.campaignId] });
              qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', c.campaignId] });
            }
          }}
          onOpenPerson={(id) => {
            setShowAdd(false);
            openPerson(id);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {personId && (
        <PersonPanel
          personId={personId}
          ids={liveIds}
          place={place}
          lookup={lookup}
          // Someone just added (Add member → Open them) can be opened a moment before the refreshed list lands:
          // not loaded yet, rather than "Not in your organization" for a person who is.
          loaded={!!data && !pausedQ.isLoading && !(isFetching && personId && !peopleById.has(String(personId)))}
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
