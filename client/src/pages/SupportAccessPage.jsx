import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Support access: who is currently inside a customer's data, and who has been.
//
// Doorline staff cannot enter an organization they are not a member of without a grant — a typed
// reason, a clock, and an audit row for every voter record they open. This page is where that becomes
// visible instead of theoretical: the sessions open right now (revocable on the spot), and the log of
// what was actually read.
//
// The log is the answer to a question we previously could not answer at all: "did anyone at Doorline
// look at my data, and why?" There was no audit model in the codebase, and morgan could not record the
// actor (its `remote-user` field is HTTP-Basic-only and we use a bearer JWT, so it is always `-`).
//
// Note what is NOT here: a member's own work. A super-admin who is genuinely the admin of an
// organization is a member, not a vendor, and their ordinary work is not logged. An audit trail that
// recorded normal work as snooping would tell you nothing about actual snooping.
export default function SupportAccessPage() {
  const qc = useQueryClient();

  const grants = useQuery({
    queryKey: ['support-grants'],
    queryFn: () => api('/super-admin/access/grants?all=1'),
    refetchInterval: 30_000,
  });

  const log = useQuery({
    queryKey: ['access-log'],
    queryFn: () => api('/super-admin/access/log?limit=200'),
  });

  const health = useQuery({
    queryKey: ['retention-health'],
    queryFn: () => api('/super-admin/access/health/retention'),
  });

  const revoke = useMutation({
    mutationFn: (id) => api(`/super-admin/access/grants/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      // Ending the session must take the customer's data OFF THE SCREEN, not just off the server.
      //
      // React Query keeps whatever you loaded during the grant. Without this, navigating back to
      // Voters after "End now" rendered the cached voter list for a beat before the refetch 403'd and
      // the banner replaced it. No new request, no new audit row — but a revoked session should not
      // still be painting a customer's voter file. Drop the org-scoped cache; keep the platform org
      // list so the switcher does not blank.
      qc.removeQueries({
        predicate: (q) =>
          !(q.queryKey?.[0] === 'super-admin' && q.queryKey?.[1] === 'organizations') &&
          q.queryKey?.[0] !== 'support-grants' &&
          q.queryKey?.[0] !== 'access-log' &&
          q.queryKey?.[0] !== 'retention-health',
      });
      qc.invalidateQueries({ queryKey: ['support-grants'] });
      qc.invalidateQueries({ queryKey: ['access-log'] });
    },
  });

  const h = health.data;

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Support access</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Entering a customer organization you are not a member of requires a session: a reason, a time
          limit, and a record of every voter record you open. Your own organizations are unaffected.
        </p>
      </div>

      {/* Retention health lives here because it answers the same class of question — is the thing we
          promised actually happening? It goes red when the purge stops, which is what a silently-dead
          scheduled job looks like from the outside. */}
      {h && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            h.healthy
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          <span className="font-semibold">Retention: {h.healthy ? 'enforced' : 'NOT ENFORCED'}</span>
          <span className="ml-2">{h.message}</span>
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Open sessions
        </h2>
        {grants.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
        {grants.data?.grants?.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">
            Nobody is inside a customer organization right now.
          </p>
        )}
        <div className="mt-2 space-y-2">
          {grants.data?.grants?.map((g) => (
            <div
              key={g.id}
              className="flex items-start justify-between gap-4 rounded border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg">
                  {g.actor} → {g.organization?.name}
                </div>
                <div className="mt-0.5 text-sm text-fg-muted">{g.reason}</div>
                <div className="mt-1 text-xs text-fg-subtle">
                  expires {new Date(g.expiresAt).toLocaleString()} ·{' '}
                  {g.accessCount} record{g.accessCount === 1 ? '' : 's'} opened
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke.mutate(g.id)}
                disabled={revoke.isPending}
                className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-muted disabled:opacity-50"
              >
                End now
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Access log</h2>
        <p className="mt-1 text-sm text-fg-subtle">
          Every customer record opened by staff, with the reason it was opened.
        </p>
        {log.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
        {log.data?.entries?.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">
            Nothing yet. No Doorline staff has opened a customer&apos;s records.
          </p>
        )}
        {log.data?.entries?.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Opened</th>
                  <th className="px-3 py-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {log.data.entries.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-fg">{e.actor}</td>
                    <td className="px-3 py-2 text-fg">{e.organization}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                      {e.method} {e.resource}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{e.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
