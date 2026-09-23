import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button, Card, EmptyState, SkeletonRows, Tabs } from '../components/ui/index.js';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import OrgHeader from '../components/org/OrgHeader.jsx';
import OverviewTab from '../components/org/OverviewTab.jsx';
import CampaignsTab from '../components/org/CampaignsTab.jsx';
import StatementsTab from '../components/org/StatementsTab.jsx';
import MembersTab from '../components/org/MembersTab.jsx';
import AccountTab from '../components/org/AccountTab.jsx';
import {
  IssueStatementModal,
  VoidStatementModal,
  MarkPaidModal,
  UnmarkPaidModal,
  SetCampaignRateModal,
} from '../components/org/modals/StatementModals.jsx';
import {
  RenameOrgModal,
  DeactivateOrgModal,
  DeleteOrgModal,
} from '../components/org/modals/OrgModals.jsx';
import { ORG_TABS, parseOrgPage, orgPagePath } from '../lib/orgPageTabs.js';

// THE ORGANIZATION — one page for everything about one customer.
//
// It replaces two half-pages that linked to each other: a slim detail page with the roster and
// campaigns but no billing facts, and a 1,099-line billing panel that rendered INLINE at the
// bottom of the Organizations list, below the table and the pager, from four entry points and with
// no scroll-into-view. Clicking Manage on a top row appeared to do nothing.
//
// The tab and the month live in the URL. That was previously a deliberate NO — the panel was
// opened against a selection on another page, and a URL param would have fought it — but once the
// page IS the org, "which tab, which month" is part of the address: reloading, sharing a link and
// pressing Back all have to work.
const EVENTS_LIMIT = 25;

export default function OrgDetailPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  // Deleting an organization is break-glass authority (the route enforces it); don't advertise a
  // button that can only 403.
  const canDelete = me?.platformRole === 'break_glass';

  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, month: openMonth } = parseOrgPage(searchParams);
  const [eventsSkip, setEventsSkip] = useState(0);

  // Modal state. One object per kind rather than a pile of booleans, so only one can be open and
  // each carries the row it is about.
  const [issuing, setIssuing] = useState(null); // string[] of months
  const [voiding, setVoiding] = useState(null);
  const [payingRow, setPayingRow] = useState(null);
  const [unpayingRow, setUnpayingRow] = useState(null);
  const [rateRow, setRateRow] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const [trailOpen, setTrailOpen] = useState(false);

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    params.delete('month');
    setSearchParams(params);
  };
  const setMonth = (m) => {
    const params = new URLSearchParams(searchParams);
    if (m) params.set('month', m);
    else params.delete('month');
    setSearchParams(params, { replace: true });
  };
  const go = (href) => navigate(href);

  // ---- queries ----------------------------------------------------------------
  const detailKey = ['super-admin', 'org', orgId];
  const billingKey = ['super-admin', 'billing', orgId];

  const detailQ = useQuery({
    queryKey: detailKey,
    queryFn: () => api(`/super-admin/organizations/${orgId}`),
  });

  // The CANONICAL window — back to the org's creation month. One request answers every tab: the
  // invoicing verdict, the month rows with their lines, and the per-campaign facts.
  const historyQ = useQuery({
    queryKey: [...billingKey, 'history', 'origin'],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/history?from=origin`),
  });

  const billingQ = useQuery({
    queryKey: [...billingKey, 'events', eventsSkip],
    queryFn: () =>
      api(`/super-admin/organizations/${orgId}/billing?eventsSkip=${eventsSkip}&eventsLimit=${EVENTS_LIMIT}`),
    // The pager is in the key, so without this the whole Account tab — status, trial, rate, terms,
    // contact, danger zone — is replaced by "Loading…" every time someone clicks Next on the audit
    // list, discarding focus with it.
    placeholderData: keepPreviousData,
  });

  const campaignRatesQ = useQuery({
    queryKey: [...billingKey, 'campaigns'],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/campaigns`),
    enabled: tab === 'campaigns',
  });

  const paperTrailQ = useQuery({
    queryKey: [...billingKey, 'statements'],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/statements`),
    enabled: trailOpen,
  });

  // Exact keys. This org's billing, this org's detail, and the desk (list + rollup + at-risk),
  // whose signals move with every one of these writes. Never another org's range.
  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: billingKey });
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
    qc.invalidateQueries({ queryKey: ['super-admin', 'month-close'] });
  };

  // ---- mutations --------------------------------------------------------------
  const billingPath = (suffix = '') => `/super-admin/organizations/${orgId}/billing${suffix}`;

  const statusMut = useMutation({
    mutationFn: (body) => api(billingPath('/status'), { method: 'POST', body }),
    onSuccess: refetchAll,
  });
  const extendMut = useMutation({
    mutationFn: (body) => api(billingPath('/extend-trial'), { method: 'POST', body }),
    onSuccess: refetchAll,
  });
  const patchMut = useMutation({
    mutationFn: (body) => api(billingPath(), { method: 'PATCH', body }),
    onSuccess: refetchAll,
  });
  const renameMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}`, { method: 'PATCH', body }),
    onSuccess: () => { setRenaming(false); refetchAll(); },
  });
  const toggleActiveMut = useMutation({
    mutationFn: (isActive) => api(`/super-admin/organizations/${orgId}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => { setDeactivating(false); refetchAll(); },
  });
  const deleteMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}`, { method: 'DELETE', body }),
    onSuccess: () => {
      setDeleting(false);
      setDeleteMsg('Deleting… this runs in the background and can take several minutes.');
      refetchAll();
    },
  });
  const campaignRateMut = useMutation({
    mutationFn: ({ campaignId, ...body }) => api(billingPath(`/campaigns/${campaignId}`), { method: 'PATCH', body }),
    onSuccess: () => { setRateRow(null); refetchAll(); },
  });

  const issueMut = useMutation({
    mutationFn: ({ months, externalRef, force }) =>
      months.length === 1
        ? api(billingPath(`/statement/${months[0]}/issue`), { method: 'POST', body: { externalRef, force } })
            .then((r) => ({ results: [{ month: months[0], ok: true, totalCents: r.statement.totalCents }] }))
        : api(billingPath('/statements/issue'), { method: 'POST', body: { months, externalRef, force } }),
    onSuccess: (res) => {
      refetchAll();
      // A partial batch leaves the modal open with its per-month results; a clean run closes it AND
      // clears them, or the next month's dialog opens already showing the last one's green
      // "issued" line — which reads as confirmation for a month nobody has issued yet.
      if ((res.results || []).every((r) => r.ok)) {
        setIssuing(null);
        issueMut.reset();
      }
    },
  });
  const voidMut = useMutation({
    mutationFn: ({ statementId, reason }) => api(billingPath(`/statement/${statementId}/void`), { method: 'POST', body: { reason } }),
    onSuccess: () => { setVoiding(null); refetchAll(); },
  });
  const paidMut = useMutation({
    mutationFn: ({ statementId, ...body }) => api(billingPath(`/statement/${statementId}/paid`), { method: 'POST', body }),
    onSuccess: () => { setPayingRow(null); refetchAll(); },
  });
  const unpaidMut = useMutation({
    mutationFn: ({ statementId, reason }) => api(billingPath(`/statement/${statementId}/unpaid`), { method: 'POST', body: { reason } }),
    onSuccess: () => { setUnpayingRow(null); refetchAll(); },
  });

  // Scroll an expanded month into view when it was opened from a deep link. It must re-run once
  // the ledger has DATA: on a fresh page load this fired against a skeleton, found nothing, and
  // the operator landed at the top of a 36-month table wondering what the link had done.
  useEffect(() => {
    if (!openMonth || tab !== 'statements' || !historyQ.data) return;
    const el = document.getElementById(`month-${openMonth}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [openMonth, tab, historyQ.data]);

  // ---- render -----------------------------------------------------------------
  if (detailQ.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
        <Card className="p-4"><SkeletonRows rows={6} /></Card>
      </div>
    );
  }
  if (detailQ.error) {
    return (
      <Card>
        <EmptyState
          title="Could not load this organization"
          hint={detailQ.error.message}
          action={<button type="button" className="text-sm font-semibold text-brand-accent" onClick={() => detailQ.refetch()}>Retry</button>}
        />
      </Card>
    );
  }

  const d = detailQ.data;
  const org = d.organization;
  const billing = d.billing;
  const history = historyQ.data;
  const invoicing = history?.invoicing || null;
  const sub = billingQ.data?.subscription || null;
  const entitlement = billingQ.data?.entitlement || null;
  const currentMonth = history?.currentMonth || billingQ.data?.currentMonth || null;
  const internal = Boolean(org.isInternal || billing?.internal);
  // Every write 409s against a tenant being destroyed; disable rather than let someone try.
  const actionsDisabled = Boolean(org.deletion);

  const monthRow = (m) => (history?.months || []).find((x) => x.month === m) || null;

  const tabs = ORG_TABS.map((t) => {
    if (t.key === 'campaigns') return { ...t, count: d.campaigns?.length || 0 };
    if (t.key === 'members') return { ...t, count: d.members?.length || 0 };
    if (t.key === 'statements' && invoicing?.awaiting?.months?.length) {
      return { ...t, count: invoicing.awaiting.months.length, tone: 'warning' };
    }
    if (t.key === 'statements' && invoicing?.overdue?.count) {
      return { ...t, count: invoicing.overdue.count, tone: 'danger' };
    }
    return t;
  });

  return (
    <div className="space-y-5">
      <OrgHeader
        org={org}
        billing={billing}
        invoicing={invoicing}
        entitlement={entitlement}
        // "Nothing overdue" and "Every closed month is invoiced" are ASSERTIONS. Until the walk
        // lands they are unknown, and if it fails they are unknowable — either way the header must
        // not state them. It shows skeletons while pending and em-dashes on failure.
        moneyPending={historyQ.isLoading}
        moneyFailed={Boolean(historyQ.error)}
        lastActivityAt={d.lastActivityAt}
        onTab={setTab}
        onRename={() => setRenaming(true)}
        onToggleActive={() => (org.isActive ? setDeactivating(true) : toggleActiveMut.mutate(true))}
        onDelete={() => setDeleting(true)}
        canDelete={canDelete}
        actionsDisabled={actionsDisabled}
      />

      {deleteMsg && (
        <div className="rounded-md border border-info/30 bg-info-tint px-4 py-2 text-sm text-info-fg">{deleteMsg}</div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Organization sections" />

      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {historyQ.error && tab !== 'members' && tab !== 'account' ? (
          // Without this the Statements tab said "Nothing to invoice yet", Campaigns said "No
          // campaigns" and Overview said "Nothing to do" — three confident negatives for an org
          // that might be $300 overdue. A failed read is not an empty answer.
          <Card>
            <EmptyState
              title="Could not load this organization's billing"
              hint={historyQ.error.message}
              action={
                <Button variant="secondary" onClick={() => historyQ.refetch()}>
                  Retry
                </Button>
              }
            />
          </Card>
        ) : historyQ.isLoading && tab !== 'members' && tab !== 'account' ? (
          <Card className="p-4"><SkeletonRows rows={6} /></Card>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab
                orgId={orgId}
                invoicing={invoicing}
                entitlement={entitlement}
                subscription={sub}
                months={history?.months}
                currentMonth={currentMonth}
                members={d.members}
                campaigns={d.campaigns}
                lastActivityAt={d.lastActivityAt}
                events={billingQ.data?.events}
                asOf={history?.asOf}
                onGo={go}
                onMarkPaid={(row) => setPayingRow(row)}
                onIssue={(months) => { issueMut.reset(); setIssuing(months); }}
              />
            )}
            {tab === 'campaigns' && (
              <CampaignsTab
                campaigns={history?.campaigns || []}
                months={history?.months || []}
                detailCampaigns={d.campaigns}
                currentMonth={currentMonth}
                window={history?.window}
                orgRateCents={sub?.pricePerCampaignCents}
                internal={internal}
                onSetRate={(row) => setRateRow(row)}
              />
            )}
            {tab === 'statements' && (
              <StatementsTab
                orgName={org.name}
                months={history?.months || []}
                invoicing={invoicing}
                currentMonth={currentMonth}
                asOf={history?.asOf}
                window={history?.window}
                internal={internal}
                openMonth={openMonth}
                onOpenMonth={setMonth}
                onIssue={(months) => { issueMut.reset(); setIssuing(months); }}
                onVoid={(row) => setVoiding(row)}
                onMarkPaid={(row) => setPayingRow(row)}
                onUnmarkPaid={(row) => setUnpayingRow(row)}
                onSetRate={(line) => setRateRow({ campaignId: line.campaignId, name: line.name, pricePerCampaignCents: line.pricePerCampaignCents })}
                paperTrail={paperTrailQ.data?.statements}
                paperTrailLoading={paperTrailQ.isLoading && trailOpen}
                paperTrailError={paperTrailQ.error}
                onLoadPaperTrail={() => setTrailOpen(true)}
              />
            )}
            {tab === 'members' && <MembersTab members={d.members} />}
            {tab === 'account' && (
              <AccountTab
                org={org}
                subscription={sub}
                entitlement={entitlement}
                events={billingQ.data?.events}
                eventsTotal={billingQ.data?.eventsTotal}
                eventsSkip={eventsSkip}
                onEventsSkip={setEventsSkip}
                loading={billingQ.isLoading}
                loadError={billingQ.error}
                onRetry={() => billingQ.refetch()}
                isInternal={org.isInternal}
                onStatus={(body) => statusMut.mutate(body)}
                onExtendTrial={(body) => extendMut.mutate(body)}
                onPatch={(body) => patchMut.mutate(body)}
                onRename={() => setRenaming(true)}
                onToggleActive={() => (org.isActive ? setDeactivating(true) : toggleActiveMut.mutate(true))}
                onDelete={() => setDeleting(true)}
                canDelete={canDelete}
                pending={statusMut.isPending || patchMut.isPending || extendMut.isPending}
                error={statusMut.error || patchMut.error || extendMut.error}
                actionsDisabled={actionsDisabled}
              />
            )}
          </>
        )}
      </section>

      {/* ---- modals ---- */}
      {issuing && (
        <IssueStatementModal
          months={issuing.map((m) => monthRow(m) || { month: m, totalCents: 0, billableCampaigns: 0 })}
          orgName={org.name}
          termsDays={history?.paymentTermsDays ?? 30}
          currentMonth={currentMonth}
          onClose={() => { setIssuing(null); issueMut.reset(); }}
          onIssue={(body) => issueMut.mutate({ months: issuing, ...body })}
          pending={issueMut.isPending}
          error={issueMut.error}
          results={issueMut.data?.results}
        />
      )}
      {voiding && (
        <VoidStatementModal
          month={voiding.month}
          totalCents={voiding.totalCents}
          paidAt={voiding.paidAt}
          onClose={() => { setVoiding(null); voidMut.reset(); }}
          onVoid={({ reason }) => voidMut.mutate({ statementId: voiding.statementId, reason })}
          pending={voidMut.isPending}
          error={voidMut.error}
        />
      )}
      {payingRow && (
        <MarkPaidModal
          month={payingRow.month}
          totalCents={payingRow.totalCents}
          issuedAt={payingRow.issuedAt}
          externalRef={payingRow.externalRef}
          asOf={history?.asOf}
          onClose={() => { setPayingRow(null); paidMut.reset(); }}
          onPaid={(body) => paidMut.mutate({ statementId: payingRow.statementId, ...body })}
          pending={paidMut.isPending}
          error={paidMut.error}
        />
      )}
      {unpayingRow && (
        <UnmarkPaidModal
          month={unpayingRow.month}
          paidAt={unpayingRow.paidAt}
          paymentRef={unpayingRow.paymentRef}
          onClose={() => { setUnpayingRow(null); unpaidMut.reset(); }}
          onUnmark={({ reason }) => unpaidMut.mutate({ statementId: unpayingRow.statementId, reason })}
          pending={unpaidMut.isPending}
          error={unpaidMut.error}
        />
      )}
      {rateRow && (
        <SetCampaignRateModal
          campaign={rateRow}
          orgRateCents={sub?.pricePerCampaignCents ?? campaignRatesQ.data?.orgRateCents}
          onClose={() => { setRateRow(null); campaignRateMut.reset(); }}
          onSave={(body) => campaignRateMut.mutate({ campaignId: rateRow.campaignId, ...body })}
          pending={campaignRateMut.isPending}
          error={campaignRateMut.error}
        />
      )}
      {renaming && (
        <RenameOrgModal
          org={org}
          onClose={() => { setRenaming(false); renameMut.reset(); }}
          onSave={(body) => renameMut.mutate(body)}
          pending={renameMut.isPending}
          error={renameMut.error}
        />
      )}
      {deactivating && (
        <DeactivateOrgModal
          org={org}
          onClose={() => { setDeactivating(false); toggleActiveMut.reset(); }}
          onConfirm={() => toggleActiveMut.mutate(false)}
          pending={toggleActiveMut.isPending}
          error={toggleActiveMut.error}
        />
      )}
      {deleting && (
        <DeleteOrgModal
          org={org}
          retry={org.deletion?.status === 'failed'}
          outstanding={invoicing?.outstanding}
          onClose={() => { setDeleting(false); deleteMut.reset(); }}
          onConfirm={(body) => deleteMut.mutate(body)}
          pending={deleteMut.isPending}
          error={deleteMut.error}
        />
      )}
    </div>
  );
}
