import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, Tooltip } from '../components/ui/index.js';
import Skeleton from '../components/ui/Skeleton.jsx';
import RowMenu from '../components/RowMenu.jsx';
import StatCard from '../components/StatCard.jsx';
import Pager from '../components/Pager.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { AccountStateBadge, InternalBadge, fmtUsd } from '../lib/billingStatus.jsx';
import { formatDate } from '../lib/dates.js';
import { monthLabel, shortMonthLabel } from '../lib/months.js';
import { nextActionLabel } from '../lib/invoicing.js';
import {
  CHIPS,
  buildDeskRows,
  rowMoney,
  deskCounts,
  filterDeskRows,
  sortDeskRows,
  parseDeskParams,
  deskParams,
  pageSlice,
  atRiskLabel,
  atRiskTab,
} from '../lib/orgDesk.js';
import { orgPagePath } from '../lib/orgPageTabs.js';
import { DeactivateOrgModal, DeleteOrgModal } from '../components/org/modals/OrgModals.jsx';
import { isValidEmail, tempPasswordProblem } from '../lib/validators.js';

// THE ORGANIZATIONS DESK — every customer account, its billing state, and what still needs doing.
//
// It replaces a 1024px-wide column whose first ~120 lines were a permanently expanded create form,
// with the daily-use table below the fold and a billing panel that appended itself off-screen
// underneath. The shell never capped the width; the page capped itself.
//
// Every filter, sort and count lives in lib/orgDesk.js so the rules that decide what an operator
// SEES are testable. This file is rendering.
const PAGE_SIZE = 25;
const LOCAL_PREFS = 'doorline.orgDesk.prefs';

const readPrefs = () => {
  // Per-viewer conveniences only. Wrapped because storage throws in a private window, and the desk
  // has to render correctly without it.
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFS) || '{}');
  } catch {
    return {};
  }
};
const writePrefs = (p) => {
  try {
    localStorage.setItem(LOCAL_PREFS, JSON.stringify(p));
  } catch {
    /* not worth telling anyone about */
  }
};

const FilterChip = ({ chip, active, count, disabled, onClick }) => {
  const btn = (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? 'border-brand-accent bg-brand-tint text-brand-tint-fg'
          : 'border-border bg-card text-fg-muted hover:bg-sunken'
      }`}
    >
      {chip.label}
      {count != null && <span className="ml-1.5 tabular-nums text-fg-subtle">{count}</span>}
    </button>
  );
  return disabled ? <Tooltip label="Computing live totals…">{btn}</Tooltip> : btn;
};

const fieldLabel = 'block text-xs font-semibold text-fg-muted';

export default function OrganizationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const canDelete = me?.platformRole === 'break_glass';

  const [searchParams, setSearchParams] = useSearchParams();
  const { chip, q, sort, dir } = parseDeskParams(searchParams);
  const [searchText, setSearchText] = useState(q);
  const [skip, setSkip] = useState(0);
  const [prefs, setPrefs] = useState(readPrefs);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);
  // One page-level notice with a tone, rather than one blue box that also carried failures.
  const [notice, setNotice] = useState(null); // { tone: 'info' | 'danger', text }

  // ?billing=<orgId> used to open the inline panel; six surfaces still link that way. Redirect
  // rather than break them — and land on the tab that panel was opened for.
  const legacyBilling = searchParams.get('billing');

  // ---- queries ----------------------------------------------------------------
  // The FULL list, unpaged. The desk's default order and three of its chips key on money that
  // lives in the rollup, which the server cannot sort by without moving the whole walk into the
  // list route — and the route loads every org for any request anyway. `invoicing=1` opts into the
  // one extra Statement read that makes the overdue column paint before the rollup lands.
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'desk'],
    queryFn: () => api('/super-admin/organizations?invoicing=1'),
    refetchInterval: (query) => (query.state.data?.deletingOrganizations?.length ? 5000 : false),
  });

  const rollupQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'billing-rollup'],
    queryFn: () => api('/super-admin/organizations/billing-rollup'),
    staleTime: 60_000,
  });

  const atRiskQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'at-risk'],
    queryFn: () => api('/super-admin/organizations/at-risk'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }) => api(`/super-admin/organizations/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => { setDeactivating(null); setNotice(null); invalidate(); },
    // Reactivate fires straight from the row menu with no dialog, so a failure had nowhere to
    // surface — the row stayed Inactive and the operator concluded the button was broken.
    onError: (err) => setNotice({ tone: 'danger', text: err.message }),
  });
  const deleteMut = useMutation({
    mutationFn: ({ id, confirmSlug }) => api(`/super-admin/organizations/${id}`, { method: 'DELETE', body: { confirmSlug } }),
    onSuccess: (r, vars) => {
      setNotice({
        tone: 'info',
        text: `Deleting ‘${vars.name}’… this runs in the background; the row disappears when it finishes.`,
      });
      setDeletingRow(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] });
    },
    // The modal shows the refusal; this page-level notice must NOT repeat it in the informational
    // tint, where "Organization not found" reads as part of a deletion that is running.
  });

  // ---- derived ----------------------------------------------------------------
  const { rows, deleting } = useMemo(
    () =>
      buildDeskRows({
        organizations: orgsQ.data?.organizations || [],
        deletingOrganizations: orgsQ.data?.deletingOrganizations || [],
        rollup: rollupQ.data,
        atRisk: atRiskQ.data,
      }),
    [orgsQ.data, rollupQ.data, atRiskQ.data]
  );

  const counts = useMemo(
    () => deskCounts(rows, { showInternal: prefs.showInternal, showInactive: prefs.showInactive }),
    [rows, prefs.showInternal, prefs.showInactive]
  );
  const filtered = useMemo(
    () => sortDeskRows(filterDeskRows(rows, { chip, q, showInternal: prefs.showInternal, showInactive: prefs.showInactive }), sort, dir),
    [rows, chip, q, sort, dir, prefs.showInternal, prefs.showInactive]
  );
  const shown = pageSlice(filtered, skip, PAGE_SIZE);

  const setParam = (patch) => {
    const next = deskParams({ chip, q, sort, dir, ...patch });
    // REPLACE, not push: a filter is a view of this page, not a place you navigated to. Pushing
    // meant Back walked through every keystroke's debounce before it left the desk — and the
    // restored URL had no `q` while the box still showed one, so an unfiltered table claimed to be
    // filtered. The no-op guard stops the mount-time debounce writing a duplicate entry at all.
    const current = Object.fromEntries(searchParams.entries());
    const same =
      Object.keys(next).length === Object.keys(current).length &&
      Object.entries(next).every(([k, v]) => current[k] === v);
    if (!same) setSearchParams(next, { replace: true });
    setSkip(0);
  };
  const setPref = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
    setSkip(0);
  };
  const toggleSort = (key) => {
    if (sort === key) setParam({ sort: key, dir: dir === 'desc' ? 'asc' : 'desc' });
    else setParam({ sort: key, dir: 'desc' });
  };

  // Debounced search: typing filters a client-side list, so there is no request to throttle — only
  // the render. The timer is cleared on every change and on unmount.
  useEffect(() => {
    const t = setTimeout(() => setParam({ q: searchText.trim() }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // …and the other direction: if the URL's `q` changes from outside this input (Back, or a link
  // someone sent), the box has to follow, or it describes a filter that is no longer applied.
  useEffect(() => {
    setSearchText((cur) => (cur.trim() === q ? cur : q));
  }, [q]);

  if (legacyBilling) {
    return <Navigate to={orgPagePath(legacyBilling, { tab: 'statements' })} replace />;
  }

  const rollup = rollupQ.data;
  const rollupFailed = Boolean(rollupQ.error);
  const SortHead = ({ label, sortKey, className = '', title }) => (
    <th className={`px-3 py-2.5 ${className}`} title={title}>
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className={`uppercase tracking-wider hover:text-fg ${sort === sortKey ? 'text-fg' : ''}`}
      >
        {label}
        {sort === sortKey && (dir === 'desc' ? ' ▾' : ' ▴')}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Organizations</h1>
          <p className="text-sm text-fg-muted">
            Every customer account, its billing state, and what still needs invoicing
            {rollup?.asOf ? ` · as of ${formatDate(rollup.asOf)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/super-admin/billing"
            className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-card px-3.5 py-2 text-sm font-semibold text-fg hover:bg-sunken"
          >
            Month close
          </Link>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>New organization</Button>
        </div>
      </div>

      {/* The platform's money, four ways. Each card applies its own chip — the numbers are the
          filters, rather than decoration above a table you then have to search by hand. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          compact
          label="Running month"
          value={rollup ? fmtUsd(rollup.totalCents) : <Skeleton className="h-6 w-24" />}
          hint={rollup ? `${rollup.billableCampaigns} billable campaigns · ${monthLabel(rollup.currentMonth || rollup.month)}` : ' '}
        />
        <StatCard
          compact
          label="Awaiting invoice"
          accent={rollup?.awaitingTotalCents ? 'amber' : undefined}
          value={rollup ? fmtUsd(rollup.awaitingTotalCents) : <Skeleton className="h-6 w-24" />}
          hint={rollup ? `${rollup.awaitingMonths} months across ${rollup.awaitingOrgs} orgs` : ' '}
        />
        <StatCard
          compact
          label="Outstanding"
          value={rollup ? fmtUsd(rollup.outstandingTotalCents) : <Skeleton className="h-6 w-24" />}
          hint={rollup ? `${rollup.outstandingCount} statement${rollup.outstandingCount === 1 ? '' : 's'} sent` : ' '}
        />
        <StatCard
          compact
          label="Overdue"
          accent={rollup?.overdueTotalCents ? 'red' : undefined}
          value={rollup ? fmtUsd(rollup.overdueTotalCents) : <Skeleton className="h-6 w-24" />}
          hint={rollup ? `${rollup.overdueCount} across ${rollup.overdueOrgs} org${rollup.overdueOrgs === 1 ? '' : 's'}` : ' '}
        />
      </div>

      {rollupFailed && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-warning/30 bg-warning-tint px-4 py-2.5 text-sm text-warning-fg">
          <span>Live totals are unavailable. Overdue and outstanding still show; the awaiting backlog does not.</span>
          <Button variant="secondary" size="sm" onClick={() => rollupQ.refetch()}>Retry</Button>
        </Card>
      )}

      {(atRiskQ.data?.items?.length || 0) > 0 && (
        <Card className="border-warning/30 bg-warning-tint px-4 py-2.5 text-sm text-warning-fg">
          <span className="font-semibold">Needs attention: </span>
          {atRiskQ.data.items.map((it, i, arr) => (
            <span key={`${it.organizationId}-${it.type}`}>
              <Link
                to={orgPagePath(it.organizationId, { tab: atRiskTab(it) })}
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                {it.name}
              </Link>
              {` (${atRiskLabel(it)})`}
              {i < arr.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search name or slug…"
          className="max-w-xs"
          aria-label="Search organizations"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((c) => (
            <FilterChip
              key={c.key}
              chip={c}
              active={chip === c.key}
              count={counts[c.key]}
              disabled={c.needsRollup && !rollup}
              onClick={() => setParam({ chip: chip === c.key ? 'all' : c.key })}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={Boolean(prefs.showInternal)} onChange={(e) => setPref({ showInternal: e.target.checked })} />
            Show internal
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={Boolean(prefs.showInactive)} onChange={(e) => setPref({ showInactive: e.target.checked })} />
            Show inactive
          </label>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-md px-4 py-2 text-sm ${
            notice.tone === 'danger'
              ? 'border border-danger/30 bg-danger-tint text-danger-fg'
              : 'border border-info/30 bg-info-tint text-info-fg'
          }`}
        >
          {notice.text}
        </div>
      )}

      <DataTable
        head={
          <>
            <SortHead label="Organization" sortKey="name" />
            <SortHead label="Status" sortKey="trialEnds" title="Sorted by trial end date" />
            <SortHead label="Billing since" sortKey="billingSince" className="hidden xl:table-cell" title="The first month that actually carried a billable campaign" />
            <SortHead label="Running month" sortKey="running" className="text-right" />
            <SortHead label="Awaiting" sortKey="awaiting" className="text-right" />
            <SortHead label="Outstanding" sortKey="outstanding" className="text-right" />
            <th className="px-3 py-2.5 hidden xl:table-cell">Members · campaigns</th>
            <th className="px-3 py-2.5 hidden 2xl:table-cell">Rate</th>
            <th className="px-3 py-2.5">Next action</th>
            <th className="px-3 py-2.5 text-right" />
          </>
        }
      >
        {orgsQ.isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <tr key={`sk-${i}`}>
              <td className="px-3 py-3"><Skeleton className="h-3 w-40" /><Skeleton className="mt-1.5 h-2.5 w-24" /></td>
              <td className="px-3 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
              <td className="px-3 py-3 hidden xl:table-cell"><Skeleton className="h-3 w-16" /></td>
              <td className="px-3 py-3"><Skeleton className="h-3 w-12" /></td>
              <td className="px-3 py-3"><Skeleton className="h-3 w-12" /></td>
              <td className="px-3 py-3"><Skeleton className="h-3 w-12" /></td>
              <td className="px-3 py-3 hidden xl:table-cell"><Skeleton className="h-3 w-16" /></td>
              <td className="px-3 py-3 hidden 2xl:table-cell"><Skeleton className="h-3 w-12" /></td>
              <td className="px-3 py-3"><Skeleton className="h-3 w-20" /></td>
              <td className="px-3 py-3" />
            </tr>
          ))}

        {/* Mid-delete tenants: inert, with Retry as the only action. */}
        {deleting.map((o) => (
          <tr key={o.id} className="bg-sunken/40">
            <td className="px-3 py-3">
              <div className="font-medium text-fg">{o.name}</div>
              <div className="text-xs text-fg-subtle">{o.slug}</div>
            </td>
            <td className="px-3 py-3">
              <Badge variant={o.deleting.status === 'failed' ? 'danger' : 'warning'}>
                {o.deleting.status === 'failed' ? 'Delete failed' : 'Deleting…'}
              </Badge>
            </td>
            <td className="px-3 py-3 text-fg-subtle" colSpan={7}>
              {o.deleting.status === 'failed'
                ? o.deleting.error || 'Removal stopped partway — the organization stays locked until a retry finishes it.'
                : `Removing all data in the background${o.deleting.source && o.deleting.source !== 'break_glass' ? ` (${o.deleting.source.replace('_', '-')})` : ''}…`}
            </td>
            <td className="px-3 py-3 text-right">
              {o.deleting.status === 'failed' && canDelete && (
                <RowMenu items={[{ label: 'Retry delete…', onClick: () => setDeletingRow({ ...o, retry: true }), danger: true }]} />
              )}
            </td>
          </tr>
        ))}

        {shown.map((r) => {
          const m = rowMoney(r);
          const next = nextActionLabel({ nextAction: r.nextAction, invoicing: r.invoicing });
          return (
            <tr key={r.id}>
              <td className="px-3 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    to={orgPagePath(r.id)}
                    className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                  >
                    {r.name}
                  </Link>
                  {r.isInternal && <InternalBadge label="Internal" compact />}
                  {!r.isActive && <Badge variant="neutral">Inactive</Badge>}
                </div>
                <div className="text-xs text-fg-subtle">
                  {r.slug} · created {formatDate(r.createdAt)}
                </div>
              </td>

              <td className="px-3 py-3">
                <AccountStateBadge
                  effective={r.billing.effective}
                  banner={r.billing.banner}
                  status={r.billing.status}
                  trialDaysLeft={r.billing.trialDaysLeft}
                  windDownEndsAt={r.invoicing?.windDownEndsAt}
                />
                {r.billing.status === 'trial' && r.billing.trialEndsAt && (
                  <div className="mt-0.5 text-xs text-fg-subtle">
                    {r.billing.banner === 'trial_expired' ? 'expired' : 'ends'} {formatDate(r.billing.trialEndsAt)}
                  </div>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-3 hidden xl:table-cell">
                {r.pending ? (
                  <Skeleton className="inline-block h-3 w-14" />
                ) : m.billingSince ? (
                  shortMonthLabel(m.billingSince)
                ) : (
                  <span className="text-fg-subtle" title="No campaign has been to the field yet">Not started</span>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {r.isInternal ? (
                  <span className="text-fg-subtle">Not billed</span>
                ) : r.pending ? (
                  <Skeleton className="inline-block h-3 w-12" />
                ) : (
                  <>
                    <div className="text-fg">{fmtUsd(m.runningCents)}</div>
                    {r.invoicing?.running && (
                      <div className="text-xs text-fg-subtle">{r.invoicing.running.billableCampaigns} billing</div>
                    )}
                  </>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-3 text-right">
                {r.isInternal ? (
                  <span className="text-fg-subtle">—</span>
                ) : !m.complete ? (
                  <Skeleton className="inline-block h-3 w-12" />
                ) : m.awaitingMonths === 0 ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <Tooltip label={m.awaitingList.map((x) => shortMonthLabel(x.month)).join(', ')}>
                    <Link to={orgPagePath(r.id, { tab: 'statements' })}>
                      <Badge variant="warning">{fmtUsd(m.awaitingCents)} · {m.awaitingMonths} mo</Badge>
                    </Link>
                  </Tooltip>
                )}
              </td>

              {/* Straight from the list route — this one paints before the rollup and survives it
                  failing, because chasing money is the thing you cannot afford to lose. */}
              <td className="whitespace-nowrap px-3 py-3 text-right">
                {r.isInternal ? (
                  <span className="text-fg-subtle">—</span>
                ) : m.overdueCount > 0 ? (
                  <>
                    <Badge variant="danger">{fmtUsd(m.overdueCents)} overdue</Badge>
                    <div className="text-xs text-fg-subtle">
                      {m.maxDaysOverdue}d · due {formatDate(m.oldestDueAt)}
                    </div>
                  </>
                ) : m.outstandingCount > 0 ? (
                  <>
                    <Badge variant="info">{fmtUsd(m.outstandingCents)}</Badge>
                    <div className="text-xs text-fg-subtle">{m.outstandingCount} sent</div>
                  </>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-3 hidden xl:table-cell text-fg-muted">
                {r.memberCount} · {r.campaignsActive}
                {r.campaignsArchived > 0 && <span className="text-fg-subtle"> (+{r.campaignsArchived})</span>}
              </td>

              <td className="whitespace-nowrap px-3 py-3 hidden 2xl:table-cell text-fg-muted">
                {r.isInternal ? '—' : r.rateCents != null ? (
                  <Tooltip label="Org default — a campaign can carry a negotiated rate">
                    <span>{fmtUsd(r.rateCents)}{r.paymentTermsDays != null ? ` · net ${r.paymentTermsDays}` : ''}</span>
                  </Tooltip>
                ) : (
                  <Skeleton className="inline-block h-3 w-12" />
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-3">
                {next.label === '—' ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <Link
                    to={orgPagePath(r.id, { tab: next.tab })}
                    className={`font-semibold underline decoration-dotted underline-offset-2 ${
                      next.tone === 'danger' ? 'text-danger-fg' : next.tone === 'warning' ? 'text-warning-fg' : 'text-fg-muted'
                    }`}
                  >
                    {next.label} →
                  </Link>
                )}
              </td>

              <td className="px-3 py-3 text-right">
                <RowMenu
                  items={[
                    { label: 'Open', onClick: () => navigate(orgPagePath(r.id)) },
                    { label: 'Statements', onClick: () => navigate(orgPagePath(r.id, { tab: 'statements' })) },
                    { label: 'Account & billing', onClick: () => navigate(orgPagePath(r.id, { tab: 'account' })) },
                    { label: 'Access log', onClick: () => navigate(`/super-admin/access?organizationId=${r.id}`) },
                    r.isActive
                      ? { label: 'Deactivate…', onClick: () => setDeactivating(r) }
                      : { label: 'Reactivate', onClick: () => toggleActiveMut.mutate({ id: r.id, isActive: true }) },
                    ...(canDelete ? [{ label: 'Delete…', onClick: () => setDeletingRow(r), danger: true }] : []),
                  ]}
                />
              </td>
            </tr>
          );
        })}

        {!orgsQ.isLoading && shown.length === 0 && (
          <tr>
            <td colSpan={10}>
              {rows.length === 0 ? (
                <EmptyState
                  title="No organizations yet"
                  hint="Create the first customer account to start a trial."
                  action={<Button variant="primary" onClick={() => setCreateOpen(true)}>New organization</Button>}
                />
              ) : chip === 'needsInvoice' ? (
                <EmptyState title="Every closed month is invoiced" hint="Nothing is waiting to be billed." />
              ) : (
                <EmptyState
                  title="No organizations match"
                  hint={`Filtered by ${CHIPS.find((c) => c.key === chip)?.label || 'a filter'}${q ? ` and “${q}”` : ''}.`}
                  action={
                    <Button variant="secondary" onClick={() => { setSearchText(''); setSearchParams({}); }}>
                      Clear filters
                    </Button>
                  }
                />
              )}
            </td>
          </tr>
        )}
      </DataTable>

      {filtered.length > PAGE_SIZE && (
        <Pager skip={skip} limit={PAGE_SIZE} total={filtered.length} onChange={setSkip} />
      )}

      {orgsQ.error && (
        <Card className="border-danger/30 bg-danger-tint px-4 py-2.5 text-sm text-danger-fg">
          Could not load organizations: {orgsQ.error.message}
          <Button variant="secondary" size="sm" className="ml-3" onClick={() => orgsQ.refetch()}>Retry</Button>
        </Card>
      )}

      {createOpen && <CreateOrgModal onClose={() => setCreateOpen(false)} onCreated={invalidate} />}

      {deactivating && (
        <DeactivateOrgModal
          org={deactivating}
          onClose={() => { setDeactivating(null); toggleActiveMut.reset(); }}
          onConfirm={() => toggleActiveMut.mutate({ id: deactivating.id, isActive: false })}
          pending={toggleActiveMut.isPending}
          error={toggleActiveMut.error}
        />
      )}

      {deletingRow && (
        <DeleteOrgModal
          org={deletingRow}
          retry={Boolean(deletingRow.retry)}
          outstanding={
            rowMoney(deletingRow).outstandingCount > 0
              ? { count: rowMoney(deletingRow).outstandingCount, totalCents: rowMoney(deletingRow).outstandingCents }
              : null
          }
          onClose={() => { setDeletingRow(null); deleteMut.reset(); }}
          onConfirm={({ confirmSlug }) => deleteMut.mutate({ id: deletingRow.id, confirmSlug, name: deletingRow.name })}
          pending={deleteMut.isPending}
          error={deleteMut.error}
        />
      )}
    </div>
  );
}

// ---- create ------------------------------------------------------------------

// The create flow, behind a button. It used to be the first ~120 lines of the page, permanently
// expanded, pushing the daily-use table below the fold — the rarest action in the most prominent
// place. The one-time credentials hand-off stays INSIDE the modal so a temp password cannot be
// lost behind a dialog that closed itself.
function CreateOrgModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [trialDays, setTrialDays] = useState('7');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const createMut = useMutation({
    mutationFn: (body) => api('/super-admin/organizations', { method: 'POST', body }),
    onSuccess: (res) => {
      setError(null);
      onCreated();
      if (res?.admin) {
        setCreated({
          orgName: res.organization?.name || '',
          email: res.admin.email,
          tempPassword: res.tempPassword || null,
        });
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.message),
  });

  const submit = () => {
    setError(null);
    const wantsAdmin = adminEmail.trim() !== '';
    if (wantsAdmin) {
      if (!firstName.trim() || !lastName.trim()) {
        setError('Enter the admin’s first and last name (or clear the email to skip the admin).');
        return;
      }
      if (!isValidEmail(adminEmail)) {
        setError('Enter a valid admin email.');
        return;
      }
      if (adminPassword !== '') {
        const problem = tempPasswordProblem(adminPassword);
        if (problem) { setError(problem); return; }
      }
    }
    const days = Math.max(1, Math.min(90, parseInt(trialDays, 10) || 7));
    const body = { name: name.trim(), slug: slug.trim() || undefined, trialDays: days };
    if (wantsAdmin) {
      body.admin = { firstName: firstName.trim(), lastName: lastName.trim(), email: adminEmail.trim() };
      if (adminPassword !== '') body.admin.password = adminPassword;
    }
    createMut.mutate(body);
  };

  const copyCreds = async () => {
    if (!created?.tempPassword) return;
    try {
      await navigator.clipboard.writeText(
        `Email: ${created.email}\nTemporary password: ${created.tempPassword}\nYou'll be asked to reset it on first login.`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the credentials manually.');
    }
  };

  if (created) {
    return (
      <Modal
        size="lg"
        onClose={onClose}
        title={`Admin created${created.orgName ? ` — ${created.orgName}` : ''}`}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {created.tempPassword
              ? 'Hand these to the client — they’ll reset the password on first login. This is the only time the temporary password is shown.'
              : 'A set-password invite was emailed to them — they follow the link to choose their own password (valid 72 hours). No credential to hand over.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Email</div>
              <div className="mt-0.5 select-all break-all font-mono text-sm text-fg">{created.email}</div>
            </div>
            {created.tempPassword && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Temporary password</div>
                <div className="mt-0.5 select-all break-all font-mono text-sm text-fg">{created.tempPassword}</div>
              </div>
            )}
          </div>
          {created.tempPassword && (
            <Button variant="secondary" onClick={copyCreds}>{copied ? 'Copied ✓' : 'Copy credentials'}</Button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      size="2xl"
      onClose={onClose}
      title="New organization"
      subtitle="Creates the org, starts its trial clock, and optionally seats the first admin."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} disabled={!name.trim()} onClick={submit}>
            {adminEmail.trim() ? 'Create client & admin' : 'Create org'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={fieldLabel} htmlFor="new-name">Name</label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Campaigns LLC" autoFocus />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="new-slug">Slug (optional)</label>
            <Input id="new-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-campaigns" />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="new-trial">Trial length (days)</label>
            <Input id="new-trial" type="number" min="1" max="90" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg bg-sunken p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">First admin (optional)</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Leave blank to add admins later. When filled, they get a set-password invite by email and choose their own
            password — leave the temporary password blank for that (recommended). They get billing access either way.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <label className={fieldLabel} htmlFor="new-first">First name</label>
              <Input id="new-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ada" />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="new-last">Last name</label>
              <Input id="new-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Lovelace" />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="new-email">Email</label>
              <Input id="new-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="ada@acme-campaigns.com" />
            </div>
          </div>
          <div className="mt-3">
            <label className={fieldLabel} htmlFor="new-temp">
              Temporary password <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <Input
              id="new-temp"
              type="text"
              autoComplete="off"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Leave blank to email a set-password invite"
            />
            <p className="mt-1 text-xs text-fg-subtle">
              Type one only to hand over out-of-band if they can&apos;t receive email — a simple one is fine, they
              choose a strong password on first login.
            </p>
          </div>
        </div>

        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{error}</div>}
      </div>
    </Modal>
  );
}
