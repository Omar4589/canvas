import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CampaignAssignmentsModal from '../components/CampaignAssignmentsModal.jsx';
import StatCard from '../components/StatCard.jsx';
import CampaignFormDrawer from '../components/campaigns/CampaignFormDrawer.jsx';
import CampaignCard from '../components/campaigns/CampaignCard.jsx';
import CampaignsTable from '../components/campaigns/CampaignsTable.jsx';
import ArchiveNudge from '../components/ArchiveNudge.jsx';
import {
  Modal,
  Button,
  Input,
  Select,
  Segmented,
  Card,
  Skeleton,
  EmptyState,
  IconSearch,
} from '../components/ui/index.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-4 w-4 text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'households', label: 'Households' },
  { value: 'knockedPct', label: 'Knocked %' },
  { value: 'setup', label: 'Setup progress' },
];

function knockedRatio(c) {
  const households = c.counts?.households || 0;
  return households ? (c.counts?.knocked || 0) / households : 0;
}

function sortCampaigns(list, sort) {
  const arr = [...list];
  const byRecent = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  if (sort === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (sort === 'households')
    arr.sort((a, b) => (b.counts?.households || 0) - (a.counts?.households || 0));
  else if (sort === 'knockedPct') arr.sort((a, b) => knockedRatio(b) - knockedRatio(a));
  else if (sort === 'setup') {
    // Incomplete setups first, newest first within each group.
    const rank = (c) => (c.stepsTotal != null && !c.setupComplete ? 0 : 1);
    arr.sort((a, b) => rank(a) - rank(b) || byRecent(a, b));
  } else arr.sort(byRecent);
  return arr;
}

function SkeletonCards() {
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24 opacity-60" />
            <Skeleton className="h-3 w-full opacity-60" />
            <Skeleton className="h-3 w-full opacity-60" />
            <Skeleton className="h-8 w-full opacity-60" />
          </Card>
        ))}
      </div>
    </>
  );
}

export default function CampaignsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Team leads see only the campaigns granted to them (server-scoped) and manage them,
  // but creating / editing / archiving / deleting a campaign stays with org admins.
  const { isOrgAdmin } = useAuth();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [assigningCampaign, setAssigningCampaign] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [reactivating, setReactivating] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('campaignsView') === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  function changeView(v) {
    setView(v);
    try {
      localStorage.setItem('campaignsView', v);
    } catch {
      /* ignore */
    }
  }

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    // Poll only while a delete runs in the background (the ImportPage predicate pattern):
    // the row vanishing — or flipping to failed — is the only completion signal.
    refetchInterval: (q) => (q.state.data?.deletingCampaigns?.length ? 2000 : false),
  });

  const surveysQ = useQuery({
    queryKey: ['surveys'],
    queryFn: () => api('/admin/surveys'),
  });

  const create = useMutation({
    mutationFn: (body) => api('/admin/campaigns', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
      setCreating(false);
      const c = data?.campaign;
      if (c) {
        const id = c.id || c._id;
        navigate(`/campaigns/${id}`, { state: { justCreated: true } }); // land on the campaign home — SetupProgress shows what's next
      }
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) =>
      api(`/admin/campaigns/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
      // The billable-door policy changes the door totals every report surface shows
      // (overview, knocks-by-pass, timeline), and none of them are covered by the two keys
      // above — a stale invoice after saving the drawer reads as "the toggle didn't work".
      // They all share the ['reports', …] prefix, so one invalidation catches the lot.
      qc.invalidateQueries({ queryKey: ['reports'] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${id}`, { method: 'DELETE' }),
    // The 202 lands in under a second — the campaign is now "Deleting…" in the list, not
    // gone, so only the list key refreshes here; the rollup/report keys refresh when the
    // row actually vanishes (the effect below).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      setDeleting(null);
    },
  });

  const campaigns = campaignsQ.data?.campaigns || [];
  // Mid-delete campaigns ship in their own array — every other consumer of this query key
  // (pickers, drill-in resolvers) reads `campaigns` and treats them as gone; only this page
  // merges them back in, to render the Deleting… / failed-Retry cards in place.
  const deletingCampaigns = campaignsQ.data?.deletingCampaigns || [];
  const allCampaigns = [...campaigns, ...deletingCampaigns];
  const surveys = surveysQ.data?.surveys || [];

  // When a previously-deleting campaign disappears between polls the delete finished —
  // refresh the cross-campaign surfaces (the TurfsPage completed-cut precedent).
  const prevDeletingIds = useRef(new Set());
  useEffect(() => {
    if (!campaignsQ.data) return;
    const current = new Set(deletingCampaigns.map((c) => String(c._id)));
    const present = new Set(allCampaigns.map((c) => String(c._id)));
    const vanished = [...prevDeletingIds.current].some((id) => !present.has(id));
    prevDeletingIds.current = current;
    if (vanished) {
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignsQ.data]);

  // KPIs — exact sums over ACTIVE campaigns; only the percent hint is rounded.
  // Deleting campaigns are excluded (they read from `campaigns`' sibling array).
  const activeCampaigns = campaigns.filter((c) => c.isActive);
  const activeHouseholds = activeCampaigns.reduce((s, c) => s + (c.counts?.households || 0), 0);
  const activeKnocked = activeCampaigns.reduce((s, c) => s + (c.counts?.knocked || 0), 0);
  const activeKnockedPct = activeHouseholds
    ? Math.round((100 * activeKnocked) / activeHouseholds)
    : 0;

  const q = search.trim().toLowerCase();
  const matches = (c) =>
    !q ||
    (c.name || '').toLowerCase().includes(q) ||
    (c.state || '').toLowerCase().includes(q);
  // Deleting rows render IN PLACE in their section (a separate section would shuffle rows
  // under the admin's eyes on every poll tick) — the badge carries the state.
  const filteredActive = sortCampaigns(
    allCampaigns.filter((c) => c.isActive && matches(c)),
    sort
  );
  const filteredArchived = sortCampaigns(
    allCampaigns.filter((c) => !c.isActive && matches(c)),
    sort
  );
  const noMatches = !!q && !filteredActive.length && !filteredArchived.length;

  // Same actions for both card and table renderings.
  const menuItems = (c) => {
    // A mid-delete row is inert: its only action is retrying a failed delete (org admins,
    // same confirm modal — re-confirming an irreversible act is never wrong).
    if (c.deletionStatus) {
      return c.deletionStatus === 'failed' && isOrgAdmin
        ? [{ label: 'Retry delete', danger: true, onClick: () => { del.reset(); setDeleting(c); } }]
        : [];
    }
    return [
      { label: 'View dashboard', onClick: () => navigate(`/campaigns/${c._id}`) },
      { label: 'Assignments', onClick: () => setAssigningCampaign(c) },
      // Edit / Archive / Delete are org-admin acts — a lead runs the
      // campaign but doesn't reshape or remove it.
      ...(isOrgAdmin
        ? [
            { label: 'Edit', onClick: () => { setCreating(false); setEditing(c); } },
            // Archiving stays one-click — it only ever stops billing. Reactivating is the one
            // campaign action with a bill attached (the archived months become billable again),
            // so it routes through a confirm modal. update.reset(): same reason as del.reset().
            c.isActive
              ? {
                  label: 'Archive',
                  onClick: () => update.mutate({ id: c._id, body: { isActive: false } }),
                }
              : { label: 'Reactivate', onClick: () => { update.reset(); setReactivating(c); } },
            c.deletable === true
              // del.reset(): without it, an error from a previous campaign's failed attempt
              // renders inside a freshly opened modal.
              ? { label: 'Delete', danger: true, onClick: () => { del.reset(); setDeleting(c); } }
              : { label: 'Delete', disabled: true, title: 'Archive instead — this campaign has canvassing data' },
          ]
        : []),
    ];
  };

  function renderList(list) {
    if (view === 'table') return <CampaignsTable campaigns={list} menuItems={menuItems} />;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => (
          <CampaignCard
            key={c._id}
            campaign={c}
            menuItems={menuItems}
            onAssign={setAssigningCampaign}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        {isOrgAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            + New campaign
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <CampaignFormDrawer
          initial={editing}
          surveys={surveys}
          orgBillRestrictedDoors={campaignsQ.data?.orgBillRestrictedDoors ?? false}
          onSave={(body) =>
            editing ? update.mutate({ id: editing._id, body }) : create.mutate(body)
          }
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          saving={editing ? update.isPending : create.isPending}
          error={editing ? update.error : create.error}
        />
      )}

      {campaignsQ.isLoading ? (
        <SkeletonCards />
      ) : campaignsQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error loading campaigns: {campaignsQ.error.message}
        </div>
      ) : allCampaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken">
          {isOrgAdmin ? (
            <EmptyState
              title="No campaigns yet"
              hint="Create a campaign, import voters, cut books, and go live — its dashboard walks you through every step."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setCreating(true);
                  }}
                >
                  New campaign
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No campaigns assigned to you yet"
              hint="Ask an org admin to grant you one."
            />
          )}
        </div>
      ) : (
        <>
          {/* Past their election day and still live — still billing. Org admins only: they're the
              only ones who can act on it (the Archive menu item below is behind the same gate). */}
          {isOrgAdmin && (
            <ArchiveNudge
              campaigns={campaigns}
              onArchive={(c) => update.mutate({ id: c._id, body: { isActive: false } })}
            />
          )}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Campaigns"
              value={campaigns.length.toLocaleString()}
              hint={`${activeCampaigns.length} active`}
            />
            <StatCard label="Active campaigns" value={activeCampaigns.length.toLocaleString()} />
            <StatCard
              label="Households"
              value={activeHouseholds.toLocaleString()}
              hint="across active campaigns"
            />
            <StatCard
              label="Houses knocked"
              value={activeKnocked.toLocaleString()}
              hint={`${activeKnockedPct}% of active households`}
              accent="brand"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or state…"
                aria-label="Search campaigns"
                leadingIcon={<IconSearch size={16} />}
              />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort campaigns">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <Segmented
              className="ml-auto"
              value={view}
              onChange={changeView}
              options={[
                { value: 'cards', label: 'Cards' },
                { value: 'table', label: 'Table' },
              ]}
            />
          </div>

          {noMatches ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
              No campaigns match your search.
            </div>
          ) : (
            <>
              <section className="mb-8">
                {filteredActive.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
                    {q ? 'No active campaigns match your search.' : 'No active campaigns.'}
                  </div>
                ) : (
                  renderList(filteredActive)
                )}
              </section>

              {filteredArchived.length > 0 && (
                <section className="mb-8">
                  <button
                    type="button"
                    onClick={() => setArchivedExpanded((v) => !v)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-semibold text-fg shadow-sm transition-colors hover:bg-sunken"
                    aria-expanded={archivedExpanded}
                  >
                    <ChevronIcon open={archivedExpanded} />
                    Archived campaigns ({filteredArchived.length})
                  </button>
                  {archivedExpanded && <div className="mt-3">{renderList(filteredArchived)}</div>}
                </section>
              )}
            </>
          )}
        </>
      )}

      {assigningCampaign && (
        <CampaignAssignmentsModal
          campaign={assigningCampaign}
          onClose={() => setAssigningCampaign(null)}
        />
      )}

      {deleting && (
        <Modal
          size="md"
          onClose={() => setDeleting(null)}
          title={`Delete "${deleting.name}"?`}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" size="sm" loading={del.isPending} onClick={() => del.mutate(deleting._id)}>
                {deleting.deletionStatus === 'failed' ? 'Retry delete' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            This permanently removes the campaign along with its {fmt(deleting.counts?.households)} doors and their
            voters, plus any walk lists and draft passes. This can't be undone. Campaigns with canvassing activity
            can't be deleted — archive them instead.
          </p>
          <p className="mt-2 text-sm text-fg-muted">
            Removal runs in the background — the campaign shows as “Deleting…” and disappears from this list when
            it finishes, usually within a minute (a few minutes for very large campaigns).
          </p>
          {del.error && <p className="mt-2 text-sm text-danger">{del.error.message}</p>}
        </Modal>
      )}

      {reactivating && (
        <Modal
          size="md"
          onClose={() => setReactivating(null)}
          title={`Reactivate "${reactivating.name}"?`}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setReactivating(null)}>Cancel</Button>
              <Button
                size="sm"
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: reactivating._id, body: { isActive: true } },
                    { onSuccess: () => setReactivating(null) }
                  )
                }
              >
                Reactivate
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            Reactivating starts this campaign's monthly billing again — including the months it
            spent archived. It then bills every month until you archive it again.
          </p>
          <p className="mt-2 text-sm text-fg-muted">
            Just need the data? An archived campaign stays fully readable and exports keep
            working — no need to reactivate.
          </p>
          {update.error && <p className="mt-2 text-sm text-danger">{update.error.message}</p>}
        </Modal>
      )}
    </div>
  );
}
