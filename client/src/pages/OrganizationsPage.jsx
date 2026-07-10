import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import OrgBillingPanel from '../components/OrgBillingPanel.jsx';
import { BillingPill } from '../lib/billingStatus.jsx';

// Which orgs the account manager should look at first: paused/past-due states
// and trials inside their last 2 days.
function needsAttention(o) {
  const b = o.billing || {};
  if (['past_due', 'suspended'].includes(b.effective)) return true;
  return b.effective === 'trial' && b.trialDaysLeft != null && b.trialDaysLeft <= 2;
}

export default function OrganizationsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState(null);
  const [billingOrg, setBillingOrg] = useState(null); // { id, name } — panel target

  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
  });

  const createMut = useMutation({
    mutationFn: (data) => api('/super-admin/organizations', { method: 'POST', body: data }),
    onSuccess: () => {
      setName('');
      setSlug('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
    },
    onError: (err) => setError(err.message),
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }) =>
      api(`/super-admin/organizations/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] }),
  });

  function onCreate(e) {
    e.preventDefault();
    setError(null);
    createMut.mutate({ name: name.trim(), slug: slug.trim() || undefined });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Organizations</h1>
        <p className="text-sm text-fg-muted">Platform-wide. Visible to super admins only.</p>
      </div>

      <form
        onSubmit={onCreate}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-3"
      >
        <div>
          <label className="block text-xs font-semibold text-fg-muted">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Campaigns LLC"
            required
            className="mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-muted">
            Slug (optional)
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-campaigns"
            className="mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createMut.isPending || !name.trim()}
            className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {createMut.isPending ? 'Creating…' : 'Create org'}
          </button>
        </div>
        {error && (
          <div className="md:col-span-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
      </form>

      {(orgsQ.data?.organizations || []).some(needsAttention) && (
        <div className="rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span className="font-semibold">Needs attention: </span>
          {(orgsQ.data?.organizations || []).filter(needsAttention).map((o, i, arr) => (
            <span key={o.id}>
              <button
                onClick={() => setBillingOrg({ id: o.id, name: o.name })}
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                {o.name}
              </button>
              {' ('}
              {o.billing.effective === 'trial' ? `trial ends in ${o.billing.trialDaysLeft}d` : o.billing.effective.replace('_', ' ')}
              {')'}
              {i < arr.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-sunken text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Campaigns</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Billing</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orgsQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {orgsQ.data?.organizations?.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3 font-medium text-fg">{o.name}</td>
                <td className="px-4 py-3 text-fg-muted">{o.slug}</td>
                <td className="px-4 py-3 text-fg-muted">{o.memberCount}</td>
                <td className="px-4 py-3 text-fg-muted">{o.campaignCount}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      o.isActive
                        ? 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                        : 'inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted'
                    }
                  >
                    {o.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setBillingOrg({ id: o.id, name: o.name })}
                    className="inline-flex items-center gap-1.5"
                    title="Manage billing"
                  >
                    <BillingPill effective={o.billing?.effective} />
                    <span className="text-xs font-semibold text-brand-accent hover:opacity-80">Manage</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() =>
                      toggleActiveMut.mutate({ id: o.id, isActive: !o.isActive })
                    }
                    className="text-xs font-semibold text-brand-accent hover:text-brand-accent"
                  >
                    {o.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
            {orgsQ.data?.organizations?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-fg-muted">
                  No organizations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {billingOrg && (
        <OrgBillingPanel orgId={billingOrg.id} orgName={billingOrg.name} onClose={() => setBillingOrg(null)} />
      )}
    </div>
  );
}
