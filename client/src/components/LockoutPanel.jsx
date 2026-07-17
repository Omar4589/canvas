import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// The lockout pill + clear button (All-users drawer + the user drill-in page). The counter lives in
// the web process's memory, so it's labeled "this server" — the env allowlist is the durable fix.
export default function LockoutPanel({ user }) {
  const qc = useQueryClient();
  const [cleared, setCleared] = useState(false);
  const lockoutQ = useQuery({
    queryKey: ['super-admin', 'users', user.id, 'lockout'],
    queryFn: () => api(`/super-admin/users/${user.id}/lockout`),
  });
  const clearMut = useMutation({
    mutationFn: () => api(`/super-admin/users/${user.id}/clear-lockout`, { method: 'POST' }),
    onSuccess: () => {
      setCleared(true);
      setTimeout(() => setCleared(false), 2500);
      qc.invalidateQueries({ queryKey: ['super-admin', 'users', user.id, 'lockout'] });
    },
  });

  const s = lockoutQ.data;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lockoutQ.isLoading ? (
        <span className="text-xs text-fg-subtle">Checking lockout…</span>
      ) : s?.locked ? (
        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
          Locked — {s.failedAttempts} failed attempts
          {s.resetAt && ` · retries ${new Date(s.resetAt).toLocaleTimeString()}`}
        </span>
      ) : (
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          {s?.failedAttempts
            ? `${s.failedAttempts} of ${s.maxFailures} failed attempts`
            : 'Not locked out'}
          {s?.allowlisted && ' · allowlisted (never locks)'}
        </span>
      )}
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">on this server</span>
      <button
        onClick={() => clearMut.mutate()}
        disabled={clearMut.isPending}
        className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-fg-muted transition-colors hover:bg-sunken disabled:opacity-50"
        title="Clear this user's login lockout (failed-password limit) so they can retry now"
      >
        {cleared ? 'Cleared ✓' : 'Clear lockout'}
      </button>
      {clearMut.error && <span className="text-xs text-danger">{clearMut.error.message}</span>}
    </div>
  );
}
