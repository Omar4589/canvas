import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Section from '../components/Section.jsx';
import { BillingPill } from '../lib/billingStatus.jsx';
import { formatDate, formatRelative } from '../lib/dates.js';

// The SLIM org detail page: header + the member roster (the one thing that used to require a
// support grant just to look at) + campaigns, then DEEP-LINKS to the existing surfaces (billing
// panel, the access log's org filter, the deletions list) instead of duplicating them. All
// metadata — no grant, no audit row; switching IN stays the (correctly grant-gated) path to voter
// content.
export default function OrgDetailPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();

  const key = ['super-admin', 'org', orgId];
  const detailQ = useQuery({ queryKey: key, queryFn: () => api(`/super-admin/organizations/${orgId}`) });

  if (detailQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (detailQ.error) return <div className="p-6 text-sm text-danger">Error: {detailQ.error.message}</div>;

  const d = detailQ.data;
  const o = d.organization;
  const b = d.billing;

  return (
    <div className="max-w-4xl">
      <Link to="/organizations" className="text-sm font-medium text-brand-accent hover:underline">‹ Organizations</Link>
      <div className="mb-2 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{o.name}</h1>
        <span className="font-mono text-xs text-fg-subtle">{o.slug}</span>
        {!o.isActive && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">Inactive</span>}
        <BillingPill effective={b.effective} />
      </div>
      <div className="mb-4 text-sm text-fg-muted">
        Created {formatDate(o.createdAt)} · last field activity {formatRelative(d.lastActivityAt)}
        {b.trialEndsAt && ` · trial ends ${formatDate(b.trialEndsAt)}`}
        {b.windDownEndsAt && (
          <span className="font-semibold text-danger"> · deletes {formatDate(b.windDownEndsAt)}</span>
        )}
      </div>

      {/* The consequence of `internal`, stated where the status is seen — choosing it silently
          exempts the org from BOTH retention sweeps (wind-down and dormancy). */}
      {b.internal && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span className="font-semibold">Internal organization:</span> exempt from automatic retention —
          the dormancy sweep and the wind-down will never delete it. Only a manual delete can.
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => navigate(`/organizations?billing=${o.id}`)}
          className="rounded-md border border-border-strong px-3 py-1.5 font-medium text-fg hover:bg-sunken"
        >
          Manage billing →
        </button>
        <button
          onClick={() => navigate(`/super-admin/access?organizationId=${o.id}`)}
          className="rounded-md border border-border-strong px-3 py-1.5 font-medium text-fg hover:bg-sunken"
          title="Who at Doorline has read this organization's data — the access log pre-filtered to this org"
        >
          Access log for this org →
        </button>
        <button
          onClick={() => navigate('/super-admin/access')}
          className="rounded-md border border-border-strong px-3 py-1.5 font-medium text-fg hover:bg-sunken"
        >
          Deletion requests →
        </button>
      </div>

      {/* The roster — account metadata (same tier as the All Users list), shown WITHOUT a grant.
          Deactivated memberships included; removed ones are hard-deleted and cannot appear. */}
      <Section title={`Members (${d.members.length})`}>
        {d.members.length === 0 ? (
          <p className="text-sm text-fg-muted">No members.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Membership</th>
                  <th className="px-3 py-2 text-left">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.members.map((m) => (
                  <tr key={m.userId} className={m.isActive ? '' : 'opacity-60'}>
                    <td className="px-3 py-2">
                      <Link
                        to={`/super-admin/users/${m.userId}`}
                        className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                      >
                        {m.name || '—'}
                      </Link>
                      {m.accountDeleted && <span className="ml-1 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">deleted</span>}
                      {!m.accountActive && !m.accountDeleted && <span className="ml-1 text-xs text-fg-subtle">(account inactive)</span>}
                      {m.billingAccess && <span className="ml-1 rounded-full bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold text-brand-accent">billing</span>}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{m.email}</td>
                    <td className="px-3 py-2 text-fg-muted">
                      {m.role}
                      {m.coordinator && <span className="text-fg-subtle"> · coord: {m.coordinator}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {m.isActive ? (
                        <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs font-medium text-success">active</span>
                      ) : (
                        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">deactivated</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDate(m.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Campaigns (${d.campaigns.length})`}>
        {d.campaigns.length === 0 ? (
          <p className="text-sm text-fg-muted">No campaigns.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Campaign</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Last field activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.campaigns.map((c) => (
                  <tr key={c.id} className={c.isActive ? '' : 'opacity-60'}>
                    <td className="px-3 py-2 font-medium text-fg">{c.name}</td>
                    <td className="px-3 py-2 text-fg-muted">
                      {c.isActive ? 'active' : `archived${c.archivedAt ? ` ${formatDate(c.archivedAt)}` : ''}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDate(c.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatRelative(c.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
