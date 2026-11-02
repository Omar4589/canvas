import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import Pager from '../components/Pager.jsx';
import { Tabs } from '../components/ui/index.js';
import TrafficTab, { TRAFFIC_POLL_MS } from '../components/website/TrafficTab.jsx';
import { livePollOptions } from '../lib/livePoll.js';

// The public website, seen from the inside: /super-admin/website. Two tabs, for the two things the
// marketing site produces and nothing else in the product does —
//   · Traffic (the default; components/website/TrafficTab.jsx): today's visits against yesterday and
//     last week, then the last 7, 30 or 90 days — per day and by the hour, how people got here, where
//     they landed, on what, and the demo requests it turned into. Counted on our server with no cookie
//     and no stored IP; the printed AAPC ad's QR code carries no tag, so its scans count as "QR code &
//     direct" (and show in the demo form's "How did you hear about us?");
//   · Demo requests (?tab=requests): every submission of the site's one form, saved before its notice
//     email so a failed send can't lose it (routes/public/demoRequest.js). Mark one handled once
//     someone has replied; delete it when the person asks (Privacy Policy, "Demo requests" — it also
//     expires on its own 24 months after it came in). The tab shows how many are open.
// Platform-scoped, super-admin only.
const LIMIT = 50;

const STATUS_TABS = [
  ['open', 'Open'],
  ['handled', 'Handled'],
  ['all', 'All'],
];

const EMAIL_LABELS = { sent: 'emailed', failed: 'email failed', dormant: 'not emailed (mail off)' };

const EmailBadge = ({ outcome }) => {
  if (!outcome) return null;
  const cls = outcome === 'sent' ? 'bg-success/10 text-success' : outcome === 'failed' ? 'bg-danger/10 text-danger' : 'bg-sunken text-fg-muted';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{EMAIL_LABELS[outcome] || outcome}</span>;
};

const Detail = ({ label, value }) =>
  value ? (
    <div>
      <span className="text-fg-subtle">{label}:</span> <span className="text-fg">{value}</span>
    </div>
  ) : null;

const DemoRequests = () => {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const [skip, setSkip] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const listQ = useQuery({
    queryKey: ['super-admin-website', 'demo-requests', status, skip],
    queryFn: () => api(`/super-admin/website/demo-requests?status=${status}&limit=${LIMIT}&skip=${skip}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['super-admin-website', 'demo-requests'] });
  const handleM = useMutation({
    mutationFn: ({ id, handled }) => api(`/super-admin/website/demo-requests/${id}`, { method: 'PATCH', body: { handled } }),
    onSuccess: refresh,
  });
  const deleteM = useMutation({
    mutationFn: (id) => api(`/super-admin/website/demo-requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDelete(null);
      refresh();
    },
  });

  const requests = listQ.data?.requests || [];
  const total = listQ.data?.total || 0;
  const open = listQ.data?.open ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Demo requests</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {open === 1 ? '1 open request.' : `${open.toLocaleString()} open requests.`} Each one is also emailed to hello@doorline.app — reply there.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 text-sm">
          {STATUS_TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setSkip(0); setStatus(key); }}
              className={`rounded-md px-3 py-1 ${status === key ? 'bg-brand-accent text-white' : 'text-fg-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {listQ.isLoading && <p className="text-sm text-fg-subtle">Loading…</p>}
      {!listQ.isLoading && requests.length === 0 && (
        <p className="text-sm text-fg-subtle">{status === 'open' ? 'No open demo requests.' : 'No demo requests here.'}</p>
      )}

      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-fg">{r.name}</span>
                  <span className="text-fg-muted">·</span>
                  <span className="text-fg">{r.organization}</span>
                  <EmailBadge outcome={r.emailOutcome} />
                  {r.handledAt && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">handled</span>}
                </div>
                <a href={`mailto:${r.email}`} className="text-sm text-brand-accent hover:underline">{r.email}</a>
                <div className="mt-2 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
                  <Detail label="They are" value={r.role} />
                  <Detail label="Team size" value={r.teamSize && (r.teamSize === 'Just me' ? r.teamSize : `${r.teamSize} canvassers`)} />
                  <Detail label="Heard about us" value={r.heardAbout} />
                  <Detail label="When" value={r.when} />
                  <Detail label="Mobile" value={r.phone} />
                  <Detail label="Sent from" value={[r.page, r.source && `src=${r.source}`].filter(Boolean).join(' ')} />
                </div>
                {r.message && <p className="mt-2 whitespace-pre-line text-sm text-fg">{r.message}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
                <span className="whitespace-nowrap text-fg-muted">{new Date(r.createdAt).toLocaleString()}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={handleM.isPending}
                    onClick={() => handleM.mutate({ id: r.id, handled: !r.handledAt })}
                    className="rounded border border-border-strong bg-card px-2.5 py-1 text-fg hover:bg-muted disabled:opacity-60"
                  >
                    {r.handledAt ? 'Reopen' : 'Mark handled'}
                  </button>
                  {confirmDelete === r.id ? (
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={deleteM.isPending}
                        onClick={() => deleteM.mutate(r.id)}
                        className="rounded bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-60"
                      >
                        Delete for good
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-fg-muted hover:text-fg">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(r.id)}
                      title="When the person asks us to delete what they sent"
                      className="text-fg-muted underline decoration-dotted underline-offset-2 hover:text-danger"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {(handleM.isError || deleteM.isError) && (
        <p className="text-sm text-danger">That didn&apos;t save — try again.</p>
      )}
      {total > LIMIT && <Pager skip={skip} limit={LIMIT} total={total} onChange={setSkip} />}
    </section>
  );
};

const SuperAdminWebsitePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'requests' ? 'requests' : 'traffic';
  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'traffic') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params);
  };
  const [live, setLive] = useState(true);
  // The open count on the Demo requests tab, and in the Traffic tab's tile — one read, refreshed with the
  // traffic while Live, and by every Mark handled or Delete (they refresh the whole demo-requests key).
  const openQ = useQuery({
    queryKey: ['super-admin-website', 'demo-requests', 'open-count'],
    queryFn: ({ signal }) => api('/super-admin/website/demo-requests?status=open&limit=1', { signal }),
    select: (d) => d.open,
    ...livePollOptions(live && tab === 'traffic', true, TRAFFIC_POLL_MS),
  });
  const open = openQ.data;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Website</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          How doorline.app is doing: how many visits it gets, how people got there, and the demo requests it brings in.
        </p>
      </div>
      <Tabs
        tabs={[
          { key: 'traffic', label: 'Traffic' },
          { key: 'requests', label: 'Demo requests', count: open ?? null, tone: open > 0 ? 'brand' : undefined },
        ]}
        value={tab}
        onChange={setTab}
        label="Website sections"
      />
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'traffic' ? (
          <TrafficTab live={live} onToggleLive={() => setLive((v) => !v)} openQ={openQ} onShowRequests={() => setTab('requests')} />
        ) : (
          <DemoRequests />
        )}
      </section>
    </div>
  );
};

export default SuperAdminWebsitePage;
