import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import OrgBillingPanel from '../components/OrgBillingPanel.jsx';
import Pager from '../components/Pager.jsx';
import { BillingPill, InternalBadge, fmtUsd } from '../lib/billingStatus.jsx';
import { isValidEmail, tempPasswordProblem } from '../lib/validators.js';

const fieldCls =
  'mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

const LIMIT = 25;

// One line per at-risk item — the server (organizations.js /at-risk) owns the definition.
function atRiskLabel(it) {
  switch (it.type) {
    case 'trial_expiring':
      return it.trialDaysLeft === 0 ? 'trial expired' : `trial ends in ${it.trialDaysLeft}d`;
    case 'past_due':
      return `past due since ${new Date(it.since).toLocaleDateString()}`;
    case 'suspended':
      return `suspended since ${new Date(it.since).toLocaleDateString()}`;
    case 'wind_down':
      return `canceled — deletes ${new Date(it.windDownEndsAt).toLocaleDateString()}`;
    case 'idle':
      return `idle ${it.monthsIdle} mo at $0`;
    default:
      return it.type;
  }
}

export default function OrganizationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  // Server-driven table state (q searches name/slug; sort: created | name | trialEnds).
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created');
  const [skip, setSkip] = useState(0);

  // The paged table. Keyed under the ['super-admin','organizations'] prefix so every existing
  // invalidation (create / toggle / delete / billing panel) refreshes it too.
  const tableParams = new URLSearchParams({ limit: String(LIMIT), skip: String(skip) });
  if (q) tableParams.set('q', q);
  if (sort !== 'created') tableParams.set('sort', sort);
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'table', q, sort, skip],
    queryFn: () => api(`/super-admin/organizations?${tableParams.toString()}`),
    placeholderData: keepPreviousData,
  });

  // This month's revenue across all customer orgs (internal excluded) — the header rollup and the
  // per-row "This month" column. One statement walk per org server-side; refreshed with the list.
  const rollupQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'billing-rollup'],
    queryFn: () => api('/super-admin/organizations/billing-rollup'),
  });

  // The lifecycle triage list — one server-side definition (trials expiring, past due, suspended,
  // wind-downs, idle $0 zombies), shared with the Control Room.
  const atRiskQ = useQuery({
    queryKey: ['super-admin', 'organizations', 'at-risk'],
    queryFn: () => api('/super-admin/organizations/at-risk'),
  });

  // Deep link from the Control Room: /organizations?billing=<orgId> opens that org's billing panel,
  // then consumes the param so closing the panel doesn't reopen it. The name resolves from whichever
  // list already has it; the panel falls back to its own fetched org name otherwise.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const target = searchParams.get('billing');
    if (!target) return;
    if (!orgsQ.data && !rollupQ.data) return;
    const o = orgsQ.data?.organizations?.find((x) => x.id === target)
      || rollupQ.data?.organizations?.find((x) => x.organizationId === target);
    setBillingOrg({ id: target, name: o?.name || '' });
    setSearchParams({}, { replace: true });
  }, [orgsQ.data, rollupQ.data, searchParams, setSearchParams]);

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

      {/* This month's revenue across every customer org — the aggregate the per-org panels can't
          answer. "Billable" = statement lines with billable === true (first knock before month end,
          not archived before month start); internal orgs are excluded entirely. */}
      {rollupQ.data && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm text-fg-muted">
              <span className="text-lg font-semibold text-fg">{fmtUsd(rollupQ.data.totalCents)}</span>{' '}
              this month ({rollupQ.data.month}) · {rollupQ.data.billableCampaigns} billable campaign
              {rollupQ.data.billableCampaigns === 1 ? '' : 's'}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(rollupQ.data.byStatus).map(([s, n]) => (
                <span key={s} className="rounded-full bg-sunken px-2 py-0.5 font-medium text-fg-muted">
                  {n} {s.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
          {rollupQ.data.organizations.some((r) => r.totalCents > 0) && (
            <div className="mt-2 text-xs text-fg-muted">
              Top:{' '}
              {rollupQ.data.organizations
                .filter((r) => r.totalCents > 0)
                .slice(0, 3)
                .map((r, i, arr) => (
                  <span key={r.organizationId}>
                    <button
                      onClick={() => setBillingOrg({ id: r.organizationId, name: r.name })}
                      className="font-semibold text-fg underline decoration-dotted underline-offset-2 hover:opacity-80"
                    >
                      {r.name}
                    </button>{' '}
                    ({fmtUsd(r.totalCents)}){i < arr.length - 1 ? ' · ' : ''}
                  </span>
                ))}
            </div>
          )}
          <p className="mt-1 text-xs text-fg-subtle">
            Billable = first knock before the month ended and not archived before it began. Internal orgs excluded.
          </p>
        </div>
      )}

      {(atRiskQ.data?.items?.length || 0) > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span className="font-semibold">Needs attention: </span>
          {atRiskQ.data.items.map((it, i, arr) => (
            <span key={`${it.organizationId}-${it.type}`}>
              <button
                onClick={() => setBillingOrg({ id: it.organizationId, name: it.name })}
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                {it.name}
              </button>
              {' ('}
              {atRiskLabel(it)}
              {')'}
              {i < arr.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSkip(0);
          setQ(searchText.trim());
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search name or slug…"
          className="flex-1 min-w-[220px] rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-sunken text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <tr>
              {[
                { key: 'name', label: 'Name', sortable: true },
                // Members counts ACTIVE memberships; campaigns are split so the bases are labeled.
                { key: 'members', label: 'Active members' },
                { key: 'campaigns', label: 'Campaigns' },
                { key: 'created', label: 'Created', sortable: true },
                { key: 'trialEnds', label: 'Trial ends', sortable: true },
                { key: 'rate', label: 'Rate' },
                { key: 'month', label: 'This month' },
                { key: 'billing', label: 'Billing' },
                { key: 'actions', label: '' },
              ].map((c) => (
                <th key={c.key} className="px-3 py-3">
                  {c.sortable ? (
                    <button
                      onClick={() => { setSkip(0); setSort(c.key); }}
                      className={`uppercase tracking-wide hover:text-fg ${sort === c.key ? 'text-fg' : ''}`}
                    >
                      {c.label}
                      {sort === c.key && ' ▾'}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orgsQ.isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {orgsQ.data?.organizations?.map((o) => {
              const money = rollupQ.data?.organizations?.find((r) => r.organizationId === o.id);
              return (
                <tr key={o.id}>
                  <td className="px-3 py-3">
                    <div className="font-medium text-fg">
                      <button
                        onClick={() => navigate(`/organizations/${o.id}`)}
                        className="underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                        title="Open this organization's detail page (roster, campaigns, access log)"
                      >
                        {o.name}
                      </button>
                      {/* Flag marker (tamper-proof isInternal), distinct from the Billing pill's
                          billing STATE — this row can show both. */}
                      {o.isInternal && <InternalBadge label="Internal" className="ml-2" />}
                      {!o.isActive && (
                        <span className="ml-2 inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-fg-subtle">{o.slug}</div>
                  </td>
                  <td className="px-3 py-3 text-fg-muted">{o.memberCount}</td>
                  <td className="px-3 py-3 text-fg-muted">
                    {o.campaignsActive}
                    {o.campaignsArchived > 0 && (
                      <span className="text-fg-subtle"> · {o.campaignsArchived} archived</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                    {o.billing?.trialEndsAt ? new Date(o.billing.trialEndsAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                    {money ? `${fmtUsd(money.rateCents)}/cmp` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                    {money ? fmtUsd(money.totalCents) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setBillingOrg({ id: o.id, name: o.name })}
                      className="inline-flex items-center gap-1.5"
                      title="Manage billing"
                    >
                      <BillingPill effective={o.billing?.effective} />
                      <span className="text-xs font-semibold text-brand-accent hover:opacity-80">Manage</span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right">
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
              );
            })}
            {orgsQ.data?.organizations?.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-fg-muted">
                  {q ? 'No organizations match.' : 'No organizations yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(orgsQ.data?.total || 0) > LIMIT && (
        <Pager skip={skip} limit={LIMIT} total={orgsQ.data.total} onChange={setSkip} />
      )}

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
