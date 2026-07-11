import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import OrgBillingPanel from '../components/OrgBillingPanel.jsx';
import { BillingPill } from '../lib/billingStatus.jsx';
import { isValidEmail, tempPasswordProblem } from '../lib/validators.js';

const fieldCls =
  'mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

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
  const [trialDays, setTrialDays] = useState('7');
  // Optional first-admin fields — filled together (all-or-nothing per createSchema).
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  // Optional typed temp password for the first admin; blank = auto-generate one server-side.
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState(null);
  // One-time credentials to hand over, set from the create response's tempPassword.
  const [createdCreds, setCreatedCreds] = useState(null); // { orgName, email, tempPassword }
  const [copied, setCopied] = useState(false);
  const [billingOrg, setBillingOrg] = useState(null); // { id, name } — panel target
  const [deleteOrg, setDeleteOrg] = useState(null); // { id, name, slug } — confirm target
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleteMsg, setDeleteMsg] = useState(null);

  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
  });

  const createMut = useMutation({
    mutationFn: (data) => api('/super-admin/organizations', { method: 'POST', body: data }),
    onSuccess: (res) => {
      setName('');
      setSlug('');
      setTrialDays('7');
      setFirstName('');
      setLastName('');
      setAdminEmail('');
      setAdminPassword('');
      setError(null);
      // Surface the temp password ONCE — the only time it's ever shown.
      if (res?.tempPassword && res?.admin) {
        setCopied(false);
        setCreatedCreds({
          orgName: res.organization?.name || '',
          email: res.admin.email,
          tempPassword: res.tempPassword,
        });
      }
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

  const deleteMut = useMutation({
    mutationFn: ({ id, slug }) =>
      api(`/super-admin/organizations/${id}`, { method: 'DELETE', body: { confirmSlug: slug } }),
    onSuccess: (r) => {
      setDeleteMsg(
        `Deleted '${r.organization.name}' — ${Object.entries(r.counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ') || 'no content'}${r.personsPurged ? ` · ${r.personsPurged} orphaned people purged` : ''}.`
      );
      setDeleteOrg(null);
      setConfirmSlug('');
      qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] });
    },
    onError: (err) => setDeleteMsg(err.message),
  });

  function onCreate(e) {
    e.preventDefault();
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
        if (problem) {
          setError(problem);
          return;
        }
      }
    }
    const days = Math.max(1, Math.min(90, parseInt(trialDays, 10) || 7));
    const body = { name: name.trim(), slug: slug.trim() || undefined, trialDays: days };
    if (wantsAdmin) {
      body.admin = { firstName: firstName.trim(), lastName: lastName.trim(), email: adminEmail.trim() };
      // Only send a password when the super admin typed one; otherwise the server auto-generates.
      if (adminPassword !== '') body.admin.password = adminPassword;
    }
    createMut.mutate(body);
  }

  async function copyCreds() {
    if (!createdCreds) return;
    const text = `Email: ${createdCreds.email}\nTemporary password: ${createdCreds.tempPassword}\nYou'll be asked to reset it on first login.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the credentials manually.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Organizations</h1>
        <p className="text-sm text-fg-muted">Platform-wide. Visible to super admins only.</p>
      </div>

      <form
        onSubmit={onCreate}
        className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm"
      >
        <div>
          <h2 className="text-sm font-semibold text-fg">New client</h2>
          <p className="text-xs text-fg-muted">
            Create the org, start its trial clock, and optionally seat the first admin in one step.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-fg-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Campaigns LLC"
              required
              className={fieldCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-muted">Slug (optional)</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-campaigns"
              className={fieldCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-muted">Trial length (days)</label>
            <input
              type="number"
              min="1"
              max="90"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="7"
              className={fieldCls}
            />
          </div>
        </div>

        {/* Optional first admin — filled all-or-nothing; email presence triggers seating. */}
        <div className="rounded-lg border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            First admin (optional)
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Leave blank to add admins later from the Users page. When filled, set a temp password to
            hand over (or leave it blank to auto-generate one) — either way it’s shown once, they reset
            it on first login, and they get billing access.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-fg-muted">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ada"
                className={fieldCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Lovelace"
                className={fieldCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted">Email</label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="ada@acme-campaigns.com"
                className={fieldCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold text-fg-muted">
              Temporary password{' '}
              <span className="font-normal text-fg-subtle">(optional — leave blank to auto-generate)</span>
            </label>
            <input
              type="text"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Leave blank to auto-generate a secure one"
              autoComplete="off"
              className={fieldCls}
            />
            <p className="mt-1 text-xs text-fg-subtle">
              A simple one is fine — they choose a strong password on first login.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={createMut.isPending || !name.trim()}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {createMut.isPending ? 'Creating…' : adminEmail.trim() ? 'Create client & admin' : 'Create org'}
          </button>
          {error && (
            <div className="flex-1 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>
      </form>

      {createdCreds && (
        <div className="rounded-xl border border-success/30 bg-success-tint p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-success-fg">
                Admin created{createdCreds.orgName ? ` — ${createdCreds.orgName}` : ''}
              </h2>
              <p className="mt-1 text-xs text-success-fg/90">
                Hand these to the client — they’ll reset the password on first login. This is the only
                time the temp password is shown.
              </p>
            </div>
            <button
              onClick={() => setCreatedCreds(null)}
              className="text-xs font-semibold text-fg-muted hover:text-fg"
            >
              Dismiss ✕
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Email</div>
              <div className="mt-0.5 select-all break-all font-mono text-sm text-fg">{createdCreds.email}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Temp password</div>
              <div className="mt-0.5 select-all break-all font-mono text-sm text-fg">{createdCreds.tempPassword}</div>
            </div>
          </div>
          <button
            onClick={copyCreds}
            className="mt-3 rounded-md border border-success/40 bg-card px-3 py-2 text-sm font-semibold text-success-fg shadow-sm hover:bg-success-tint"
          >
            {copied ? 'Copied ✓' : 'Copy credentials'}
          </button>
        </div>
      )}

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
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() =>
                        toggleActiveMut.mutate({ id: o.id, isActive: !o.isActive })
                      }
                      className="text-xs font-semibold text-brand-accent hover:text-brand-accent"
                    >
                      {o.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      onClick={() => {
                        setDeleteMsg(null);
                        setConfirmSlug('');
                        setDeleteOrg({ id: o.id, name: o.name, slug: o.slug });
                      }}
                      className="text-xs font-semibold text-danger hover:opacity-80"
                    >
                      Delete…
                    </button>
                  </div>
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

      {deleteMsg && (
        <div className="rounded-md border border-info/30 bg-info-tint px-4 py-2 text-sm text-info-fg">{deleteMsg}</div>
      )}

      {deleteOrg && (
        <div className="rounded-xl border border-danger/30 bg-danger-tint p-4">
          <h2 className="text-sm font-semibold text-danger">Permanently delete {deleteOrg.name}?</h2>
          <p className="mt-1 text-sm text-danger">
            This hard-deletes the org and <strong>everything in it</strong> — campaigns, doors, voters,
            canvass history, surveys, books, imports, reports, and share links. It cannot be undone.
            User accounts survive (people in other orgs keep that access; this org&apos;s memberships are
            removed). Type the slug <span className="font-mono font-semibold">{deleteOrg.slug}</span> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={deleteOrg.slug}
              className="rounded-md border border-danger/40 bg-card px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <button
              onClick={() => deleteMut.mutate({ id: deleteOrg.id, slug: confirmSlug.trim().toLowerCase() })}
              disabled={confirmSlug.trim().toLowerCase() !== deleteOrg.slug || deleteMut.isPending}
              className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete forever'}
            </button>
            <button
              onClick={() => {
                setDeleteOrg(null);
                setConfirmSlug('');
              }}
              className="text-sm font-semibold text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
