import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Card, Select, Skeleton } from '../ui/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ACTION_LABELS } from '../../lib/statusColors.js';
import { formatInTz } from '../../lib/datetime.js';

// Folding a retired outcome's HISTORY into another one. The toggles above decide what canvassers
// can record from now on; this decides what the entries they already recorded read as.
//
// Only offered for outcomes this campaign has switched OFF, and only among the three that carry
// no rate or billing meaning of their own (not home / wrong address / no soliciting) — so nothing
// here can move a knock count, a contact rate, or an invoice. The server is the authority on both
// rules (services/canvass/reclassifyOutcomes.js); this component just never offers what the
// server would refuse.
//
// ORG ADMINS ONLY, one step stricter than the toggles a lead owns: rewriting recorded history is
// an org-admin act. Leads get nothing here, not a disabled control — a button that exists only to
// refuse them is worse than its absence.

const label = (k) => ACTION_LABELS[k] || k;

function RunRow({ run, tz, onRevert, reverting }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 first:border-t-0">
      <div className="min-w-0 text-sm text-fg">
        <span className="font-medium">{label(run.from)}</span>
        <span className="text-fg-muted"> → </span>
        <span className="font-medium">{label(run.to)}</span>
        <div className="mt-0.5 text-xs text-fg-muted">
          {run.count.toLocaleString()} {run.count === 1 ? 'entry' : 'entries'} ·{' '}
          {run.doorCount.toLocaleString()} {run.doorCount === 1 ? 'door' : 'doors'}
          {run.by ? ` · ${run.by}` : ''} · {formatInTz(run.createdAt, tz)}
        </div>
      </div>
      {run.revertedAt ? (
        <Badge variant="neutral">Reverted</Badge>
      ) : (
        <Button variant="secondary" size="sm" disabled={reverting} onClick={() => onRevert(run.id)}>
          {reverting ? 'Reverting…' : 'Revert'}
        </Button>
      )}
    </li>
  );
}

export default function ReclassifyCard({ campaignId, disabledOutcomes = [] }) {
  const { isOrgAdmin, orgTimeZone } = useAuth();
  const qc = useQueryClient();
  const [source, setSource] = useState(null); // the outcome being folded, once confirmed into
  const [target, setTarget] = useState('not_home');
  const [error, setError] = useState(null);

  // disabledOutcomes rides in as a prop so the card re-fetches the moment a toggle above flips —
  // the eligible set is derived from it server-side, and a stale list would offer a source the
  // server now refuses.
  const key = useMemo(
    () => ['admin', 'campaigns', campaignId, 'reclassify', [...disabledOutcomes].sort().join(',')],
    [campaignId, disabledOutcomes]
  );
  const q = useQuery({
    queryKey: key,
    queryFn: () => api(`/admin/campaigns/${campaignId}/reclassify-outcomes`),
    enabled: !!campaignId && isOrgAdmin,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns', campaignId, 'reclassify'] });

  const dryRun = useMutation({
    mutationFn: ({ from, to }) =>
      api(`/admin/campaigns/${campaignId}/reclassify-outcomes`, {
        method: 'POST',
        body: { from, to, dryRun: true },
      }),
    onSuccess: (data) => setSource(data),
    onError: (e) => setError(e.message),
  });

  const run = useMutation({
    mutationFn: ({ from, to }) =>
      api(`/admin/campaigns/${campaignId}/reclassify-outcomes`, { method: 'POST', body: { from, to } }),
    onSuccess: () => {
      setSource(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const revert = useMutation({
    mutationFn: (runId) =>
      api(`/admin/campaigns/${campaignId}/reclassify-outcomes/revert`, { method: 'POST', body: { runId } }),
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  if (!isOrgAdmin) return null;

  const counts = q.data?.counts || {};
  const targets = (q.data?.targets || []).filter((t) => t !== source?.from);
  const runs = q.data?.runs || [];
  const sources = Object.keys(counts);

  return (
    <Card>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Door Outcomes</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Fold a switched-off outcome&rsquo;s past entries into one canvassers still use. Only
          outcomes that carry no rate or billing meaning can be folded, so your door counts,
          contact rate and invoices never move — and every change can be undone.
        </p>
      </div>

      {q.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : q.error ? (
        <p className="px-4 py-3 text-sm text-danger-fg">{q.error.message}</p>
      ) : (
        <>
          {error && (
            <p className="border-b border-border bg-danger-tint/40 px-4 py-2 text-sm text-danger-fg">{error}</p>
          )}

          {sources.length === 0 ? (
            <p className="px-4 py-3 text-sm text-fg-muted">
              Nothing to reclassify. This appears once you switch an outcome off and it has entries
              already recorded.
            </p>
          ) : source ? (
            // Confirm step — the dry-run numbers, straight from the server.
            <div className="px-4 py-3">
              <p className="text-sm text-fg">
                Change <span className="font-medium">{source.entries.toLocaleString()}</span>{' '}
                {source.entries === 1 ? 'entry' : 'entries'} across{' '}
                <span className="font-medium">{source.doors.toLocaleString()}</span>{' '}
                {source.doors === 1 ? 'door' : 'doors'} from{' '}
                <span className="font-medium">{label(source.from)}</span> to{' '}
                <span className="font-medium">{label(source.to)}</span>?
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                Times, locations and who knocked are all kept. This shows in the campaign&rsquo;s
                history, and you can revert it below.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={run.isPending}
                  onClick={() => {
                    setError(null);
                    run.mutate({ from: source.from, to: source.to });
                  }}
                >
                  {run.isPending ? 'Reclassifying…' : 'Reclassify'}
                </Button>
                <Button variant="secondary" disabled={run.isPending} onClick={() => setSource(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <ul>
              {sources.map((from) => {
                const options = targets.length ? targets : [];
                return (
                  <li key={from} className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0 flex-1 text-sm text-fg">
                      <span className="font-medium">{label(from)}</span>
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {counts[from].entries.toLocaleString()}{' '}
                        {counts[from].entries === 1 ? 'entry' : 'entries'} ·{' '}
                        {counts[from].doors.toLocaleString()}{' '}
                        {counts[from].doors === 1 ? 'door' : 'doors'}
                      </div>
                    </div>
                    <label className="text-xs text-fg-muted">
                      <span className="mb-1 block">Change to</span>
                      <Select
                        value={options.includes(target) ? target : options[0] || ''}
                        onChange={(e) => setTarget(e.target.value)}
                        disabled={!options.length}
                      >
                        {options
                          .filter((t) => t !== from)
                          .map((t) => (
                            <option key={t} value={t}>
                              {label(t)}
                            </option>
                          ))}
                      </Select>
                    </label>
                    <Button
                      variant="secondary"
                      disabled={dryRun.isPending || !options.filter((t) => t !== from).length}
                      onClick={() => {
                        setError(null);
                        const opts = options.filter((t) => t !== from);
                        dryRun.mutate({ from, to: opts.includes(target) ? target : opts[0] });
                      }}
                    >
                      Review
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {runs.length > 0 && (
            <div>
              <h3 className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Past reclassifications
              </h3>
              <ul>
                {runs.map((r) => (
                  <RunRow
                    key={r.id}
                    run={r}
                    tz={orgTimeZone}
                    reverting={revert.isPending && revert.variables === r.id}
                    onRevert={(id) => {
                      setError(null);
                      revert.mutate(id);
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
