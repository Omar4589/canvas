import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Section from '../components/Section.jsx';
import LockoutPanel from '../components/LockoutPanel.jsx';
import { formatDate, formatRelative } from '../lib/dates.js';

// The platform user drill-in — pure account METADATA (no grant, no audit row): full identity
// including the fields no list shows (temp-password state, deletion lock), ALL memberships
// including deactivated ones, structural activity counts, staff grant/access history, and the
// deletion-tombstone STATUS (dates only — never the tombstone's name content, which is read
// elsewhere under org-scoped purge-aware guards).
function fmtBytes(n) {
  if (!n) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Badge({ tone = 'muted', children }) {
  const cls = {
    warn: 'bg-warning-tint text-warning-fg',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-info-tint text-info-fg',
    muted: 'bg-sunken text-fg-muted',
    success: 'bg-success-tint text-success',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export default function SuperAdminUserDetailPage() {
  const { userId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const isBreakGlass = me?.platformRole === 'break_glass';
  const [actionError, setActionError] = useState(null);

  const key = ['super-admin', 'user', userId];
  const detailQ = useQuery({ queryKey: key, queryFn: () => api(`/super-admin/users/${userId}`) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['super-admin', 'users'] });
  };

  const promoteMut = useMutation({
    mutationFn: () => api(`/super-admin/users/${userId}/promote`, { method: 'POST' }),
    onSuccess: () => { setActionError(null); invalidate(); },
    onError: (err) => setActionError(err.message),
  });
  // Re-invite into a specific org. Staff can't use the org-scoped button, because entering a
  // customer org gives them a support grant and that router refuses every write — so this is the
  // only console path for "I provisioned a client, they never signed in, and their temp password
  // lapsed". The org is explicit per row: the invite email names one, and a multi-org user must
  // never be sent a link naming another company.
  const [inviteMsg, setInviteMsg] = useState(null);
  const resendMut = useMutation({
    mutationFn: (organizationId) =>
      api(`/super-admin/users/${userId}/resend-invite`, { method: 'POST', body: { organizationId } }),
    onSuccess: (res) => {
      setActionError(null);
      setInviteMsg(
        res?.sent
          ? `Invite sent to ${res.to} — the link works for ${res.expiresInHours} hours.`
          : 'The invite could not be sent. Check the mail configuration.'
      );
    },
    onError: (err) => { setInviteMsg(null); setActionError(err.message); },
  });
  const roleMut = useMutation({
    mutationFn: (platformRole) => api(`/super-admin/users/${userId}/platform-role`, { method: 'PATCH', body: { platformRole } }),
    onSuccess: () => { setActionError(null); invalidate(); },
    onError: (err) => setActionError(err.message),
  });

  // Deletion. The preflight runs only once the danger panel is opened — it is a real query and
  // there is no reason to ask "what would break if I deleted this person" on every page view.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const deletionCheckQ = useQuery({
    queryKey: ['super-admin', 'user', userId, 'deletion-check'],
    queryFn: () => api(`/super-admin/users/${userId}/deletion-check`),
    enabled: false, // fetched explicitly when the panel opens
    retry: false,
  });
  const deleteMut = useMutation({
    mutationFn: (email) =>
      api(`/super-admin/users/${userId}`, { method: 'DELETE', body: { confirmEmail: email } }),
    onSuccess: () => {
      setActionError(null);
      setConfirmDelete(false);
      setConfirmEmail('');
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });

  if (detailQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (detailQ.error) return <div className="p-6 text-sm text-danger">Error: {detailQ.error.message}</div>;

  const d = detailQ.data;
  const u = d.user;
  const isSelf = me?.id === u.id;
  // Recovery is only meaningful for someone who has NEVER signed in: anyone else has a working
  // password and should use Forgot password, and resending would kill whatever link they hold.
  // The server enforces the same rule (409 ALREADY_SIGNED_IN) — this just avoids offering it.
  const canResend = !u.deletedAt && u.isActive && !u.lastLoginAt;

  return (
    <div className="max-w-4xl">
      <Link to="/super-admin/users" className="text-sm font-medium text-brand-accent hover:underline">‹ All users</Link>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{u.firstName} {u.lastName}</h1>
        <span className="font-mono text-xs text-fg-subtle">{u.id}</span>
        {u.isSuperAdmin && <Badge tone="warn">{u.platformRole === 'break_glass' ? 'break-glass' : 'support'}</Badge>}
        {u.deletedAt && <Badge>deleted</Badge>}
        {!u.isActive && !u.deletedAt && <Badge>inactive</Badge>}
        {u.mustChangePassword && !u.deletedAt && <Badge tone="info">temp password</Badge>}
        {u.deletionLocked && <Badge tone="info">deletion-locked</Badge>}
      </div>

      {actionError && (
        <div className="mb-4 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{actionError}</div>
      )}
      {inviteMsg && (
        <div className="mb-4 rounded border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">{inviteMsg}</div>
      )}

      <Section title="Account">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Email</dt>
            <dd className="text-fg">{u.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Phone</dt>
            <dd className="text-fg">{u.phone || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Joined</dt>
            <dd className="text-fg">{formatDate(u.createdAt)}</dd>
          </div>
          <div>
            {/* Three clocks on purpose: typing a password, using the app at all, and canvassing
                (the last one below, per org). */}
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Last login</dt>
            <dd className="text-fg">{formatRelative(u.lastLoginAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Last active</dt>
            <dd className="text-fg">{formatRelative(u.lastSeenAt, { never: '—' })}</dd>
          </div>
          {u.mustChangePassword && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Temp password set</dt>
              <dd className="text-fg">{u.tempPasswordSetAt ? formatDate(u.tempPasswordSetAt) : '—'} <span className="text-fg-subtle">(never finished onboarding)</span></dd>
            </div>
          )}
          {u.deletedAt && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Account deleted</dt>
              <dd className="text-fg">{formatDate(u.deletedAt)}</dd>
            </div>
          )}
        </dl>
        {!u.deletedAt && (
          <div className="mt-4">
            <LockoutPanel user={u} />
          </div>
        )}
        {isBreakGlass && !u.deletedAt && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              onClick={() => promoteMut.mutate()}
              disabled={isSelf || promoteMut.isPending}
              title={isSelf ? "You can't change your own super-admin flag" : ''}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                u.isSuperAdmin
                  ? 'border-warning/30 bg-warning-tint text-warning-fg'
                  : 'border-border bg-card text-fg-muted hover:bg-sunken'
              }`}
            >
              {u.isSuperAdmin ? 'Remove super' : 'Make super'}
            </button>
            {u.isSuperAdmin && (
              <>
                <span className="text-xs text-fg-subtle">Platform role:</span>
                <select
                  value={u.platformRole || 'support'}
                  onChange={(e) => roleMut.mutate(e.target.value)}
                  disabled={roleMut.isPending}
                  className="rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none"
                  title="support = day-to-day operations; break-glass = destructive actions and everyone's sessions"
                >
                  <option value="support">support</option>
                  <option value="break_glass">break-glass</option>
                </select>
              </>
            )}
          </div>
        )}

        {/* Danger zone — the GUI replacement for `npm run delete:account`. Break-glass only, and
            hidden entirely once the account is a tombstone. Modelled on the org-delete panel:
            say what dies and what survives BEFORE offering the control, list the refusals the
            preflight found, and require the email typed back. */}
        {isBreakGlass && !u.deletedAt && (
          <div className="mt-4 border-t border-border pt-4">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => { setConfirmDelete(true); setConfirmEmail(''); deletionCheckQ.refetch(); }}
                className="rounded-md border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-tint"
              >
                Delete account…
              </button>
            ) : (
              <div className="rounded border border-danger/40 bg-danger-tint p-4">
                <h4 className="text-sm font-semibold text-danger">
                  Permanently delete {u.firstName} {u.lastName}?
                </h4>
                <p className="mt-2 text-xs text-fg-muted">
                  Their identity is scrubbed immediately — name, email, phone and password. Their{' '}
                  <strong>field work is not deleted</strong>: knocks, surveys and every campaign
                  total stay exactly as they are, because those are the organization&rsquo;s records
                  and removing them would rewrite invoices. The name is kept for{' '}
                  {d.deletedRecord?.retentionUntil ? 'the disclosed retention window' : '180 days'} so
                  past GPS flags stay attributable, then scrubbed too.{' '}
                  <strong>This cannot be undone</strong> — there is no way to restore an account.
                </p>

                {deletionCheckQ.isFetching && (
                  <p className="mt-3 text-xs text-fg-muted">Checking what would break…</p>
                )}
                {deletionCheckQ.data && !deletionCheckQ.data.canDelete && (
                  <div className="mt-3 rounded border border-danger/30 bg-card p-3">
                    <p className="text-xs font-semibold text-danger">
                      This account cannot be deleted yet:
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
                      {deletionCheckQ.data.blockers.map((b) => (
                        <li key={b.code}>{b.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <label className="mt-3 block text-xs font-medium text-fg-muted">
                  Type <span className="font-mono text-fg">{u.email}</span> to confirm
                </label>
                <input
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={u.email}
                  autoComplete="off"
                  className="mt-1 w-full max-w-md rounded border border-border-strong bg-card px-2 py-1.5 font-mono text-sm text-fg focus:border-danger focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(confirmEmail)}
                    disabled={
                      confirmEmail.trim().toLowerCase() !== String(u.email).toLowerCase() ||
                      deleteMut.isPending ||
                      deletionCheckQ.data?.canDelete === false
                    }
                    className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                  >
                    {deleteMut.isPending ? 'Deleting…' : 'Delete forever'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ALL memberships — including deactivated ones, which no platform list can show (the
          All-users list hard-filters to active). Removed memberships cannot appear anywhere:
          removal hard-deletes the row. */}
      <Section title={`Memberships (${d.memberships.length})`}>
        {d.memberships.length === 0 ? (
          <p className="text-sm text-fg-muted">No org memberships.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Organization</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Joined</th>
                  {/* RAW field records (one row per door action) — the platform lifetime unit,
                      deliberately NOT billable knocks (distinct household×pass). */}
                  <th className="px-3 py-2 text-right" title="Raw field records (one per door action) — not billable knocks">Field records</th>
                  <th className="px-3 py-2 text-right">Surveys</th>
                  {/* "Last canvassed", not "Last active": this is the canvass clock, and the
                      account-level "Last active" above is a different one. */}
                  <th className="px-3 py-2 text-left">Last canvassed</th>
                  {canResend && <th className="px-3 py-2 text-right">Recovery</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.memberships.map((m) => (
                  <tr key={m.organizationId} className={m.isActive ? '' : 'opacity-60'}>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => navigate(`/organizations/${m.organizationId}`)}
                        className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                      >
                        {m.organizationName}
                      </button>
                      {!m.organizationActive && <span className="ml-1 text-xs text-fg-subtle">(org inactive)</span>}
                      {m.billingAccess && <span className="ml-1 rounded-full bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold text-brand-accent">billing</span>}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {m.role}
                      {m.coordinator && <span className="text-fg-subtle"> · coord: {m.coordinator}</span>}
                    </td>
                    <td className="px-3 py-2">{m.isActive ? <Badge tone="success">active</Badge> : <Badge>deactivated</Badge>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDate(m.joinedAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg">{m.fieldRecords.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{m.surveys.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatRelative(m.lastActivityAt)}</td>
                    {canResend && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {m.organizationActive ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Email ${d.user.email} a new set-password link for ${m.organizationName}?\n\nThis replaces any earlier invite or reset link they hold.`
                                )
                              ) {
                                resendMut.mutate(m.organizationId);
                              }
                            }}
                            disabled={resendMut.isPending}
                            className="rounded border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-sunken disabled:opacity-50"
                          >
                            {resendMut.isPending ? 'Sending…' : 'Resend invite'}
                          </button>
                        ) : (
                          <span className="text-xs text-fg-subtle">org inactive</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Staff history — only rendered for super-admin accounts. Grants INCLUDING expired/revoked
          (the live-sessions view can't show history) + their access-log footprint as an actor. */}
      {d.staff && (
        <Section title="Staff access history">
          {d.staff.grants.length === 0 ? (
            <p className="text-sm text-fg-muted">Never held a support-access grant.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.staff.grants.map((g) => {
                const live = !g.revokedAt && new Date(g.expiresAt) > new Date();
                return (
                  <li key={g.id} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">{g.organizationName}</span>
                      <Badge tone={live ? 'success' : 'muted'}>{live ? 'live' : g.revokedAt ? 'revoked' : 'expired'}</Badge>
                      {g.kind && <Badge>{g.kind}</Badge>}
                    </div>
                    <div className="mt-0.5 text-fg-muted">{g.reason}</div>
                    <div className="mt-1 text-xs text-fg-subtle">
                      granted {formatDate(g.grantedAt)} · {g.revokedAt ? `revoked ${formatDate(g.revokedAt)}` : `expires ${formatDate(g.expiresAt)}`}
                      {' · '}{g.accessCount} request{g.accessCount === 1 ? '' : 's'}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {d.staff.accessByOrg.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-fg-subtle">Reads under grants, by organization</div>
              <ul className="space-y-1 text-sm text-fg-muted">
                {d.staff.accessByOrg.map((a) => (
                  <li key={a.organizationName}>
                    <span className="font-medium text-fg">{a.organizationName}</span>
                    {' — '}{a.requests.toLocaleString()} request{a.requests === 1 ? '' : 's'}
                    {a.rows > 0 && ` · ${a.rows.toLocaleString()} rows`}
                    {fmtBytes(a.bytes) && ` · ${fmtBytes(a.bytes)}`}
                    {' · last '}{formatRelative(a.lastAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Tombstone STATUS only — dates + reach, never the snapshot's name content (that is read
          elsewhere under org-scoped, purge-aware guards for report attribution). */}
      {d.deletedRecord && (
        <Section title="Deletion record">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Deleted</dt>
              <dd className="text-fg">{formatDate(d.deletedRecord.deletedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Name retained for attribution until</dt>
              <dd className="text-fg">{formatDate(d.deletedRecord.retentionUntil)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Purged</dt>
              <dd className="text-fg">{d.deletedRecord.purgedAt ? formatDate(d.deletedRecord.purgedAt) : 'not yet'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-fg-subtle">
            Attribution snapshot serving {d.deletedRecord.organizationCount} organization{d.deletedRecord.organizationCount === 1 ? '' : 's'}.
            Its name content is only ever shown org-scoped on reports, never here.
          </p>
        </Section>
      )}
    </div>
  );
}
