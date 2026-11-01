import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import Pager from '../components/Pager.jsx';

// The public website, seen from the inside: /super-admin/website. Two things the marketing site
// produces and nothing else in the product does —
//   · demo requests: every submission of the site's one form, saved before its notice email so a
//     failed send can't lose it (routes/public/demoRequest.js). Mark one handled once someone has
//     replied; delete it when the person asks (Privacy Policy, "Demo requests" — it also expires on
//     its own 24 months after it came in);
//   · visits: page loads of the public pages per day, by source — counted on the server with no
//     cookie and no stored IP. The printed AAPC ad's QR code carries no tag, so its scans show up as
//     "direct" (and in the demo form's "How did you hear about us?").
// Platform-scoped, super-admin only.
const LIMIT = 50;
const VISIT_DAYS = 60;

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

// "Nov 17" from "2026-11-17", read as a calendar date (never shifted by the viewer's time zone).
const dayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
};

const Visits = () => {
  const visitsQ = useQuery({
    queryKey: ['super-admin-website', 'visits', VISIT_DAYS],
    queryFn: () => api(`/super-admin/website/visits?days=${VISIT_DAYS}`),
  });
  const days = visitsQ.data?.days || [];
  const sources = (visitsQ.data?.sources || []).slice(0, 5);
  const peak = Math.max(1, ...days.map((d) => d.total));
  const total = days.reduce((n, d) => n + d.total, 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-fg">Homepage visits</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Page loads per day for the last {VISIT_DAYS} days, Central time ({total.toLocaleString()} in all). Counted on our
          server — no cookies, no stored IP addresses; crawlers and previews are left out. A scan of the printed AAPC ad&apos;s
          QR code counts as &ldquo;direct&rdquo;.
        </p>
      </div>
      {visitsQ.isLoading && <p className="text-sm text-fg-subtle">Loading…</p>}
      {days.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2 text-right">Visits</th>
                <th className="w-1/3 px-3 py-2" aria-label="Bar" />
                {sources.map((s) => (
                  <th key={s.source} className="px-3 py-2 text-right normal-case">{s.source}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{dayLabel(d.day)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-fg">{d.total.toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    <div className="h-2 rounded-full bg-brand-accent/70" style={{ width: `${(d.total / peak) * 100}%` }} />
                  </td>
                  {sources.map((s) => (
                    <td key={s.source} className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                      {(d.bySource[s.source] || 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default function SuperAdminWebsitePage() {
  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Website</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          What doorline.app brings in: demo requests from the site&apos;s form, and daily visits to the homepage.
        </p>
      </div>
      <DemoRequests />
      <Visits />
    </div>
  );
}
