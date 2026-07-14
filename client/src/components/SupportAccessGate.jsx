import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// The handle on the lock.
//
// Platform staff can no longer enter a customer organization they hold no membership in without a
// support access grant: time-boxed, carrying a typed reason, and with every voter record they open
// written to the audit log. That gate is correct — but the first cut of it shipped with NO WAY TO
// OBTAIN A GRANT from the product. The org switcher still listed every customer, and each one dead-ended
// in a 403 whose message told the operator to start a session with a reason, while the app offered no
// means to do so. A Retry button that can never succeed.
//
// This is that means. It listens for the `doorline:support-access-required` event that api/client.js
// broadcasts on the 403 — from ANY query on ANY screen, which is why it lives once at the layout level
// rather than as a hook each page has to remember to add.
//
// It is deliberately not a rubber stamp. The reason is required, it is free text, and the operator is
// told plainly — before they type it — that what they are about to open is logged against their name.
// A dropdown of canned reasons would become a formality nobody reads; a sentence you had to write is
// something you can be asked about later.
export default function SupportAccessGate() {
  const qc = useQueryClient();
  const [org, setOrg] = useState(null); // { organizationId, organizationName } | null
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onRequired(e) {
      // Don't stack modals if several queries 403 at once — the first one wins.
      setOrg((cur) => cur || e.detail);
    }
    window.addEventListener('doorline:support-access-required', onRequired);
    return () => window.removeEventListener('doorline:support-access-required', onRequired);
  }, []);

  useEffect(() => {
    if (!org) return;
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [org]);

  function close() {
    setOrg(null);
    setReason('');
    setError(null);
  }

  async function start() {
    setError(null);
    setSaving(true);
    try {
      await api('/super-admin/access/grants', {
        method: 'POST',
        body: { organizationId: org.organizationId, reason: reason.trim(), hours: Number(hours) },
      });
      close();
      // Every panel on screen 403'd. Refetch them all now that the door is open.
      qc.invalidateQueries();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (!org) return null;

  const tooShort = reason.trim().length < 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-fg">
          Start a support session in {org.organizationName}
        </h2>

        <p className="mt-2 text-sm text-fg-muted">
          You are not a member of this organization, so opening it counts as support access. It lasts{' '}
          <strong className="text-fg">{hours} hours</strong> and ends on its own.
        </p>

        <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Every voter record you open here is recorded against your name, with the reason below. This is
          what lets us tell a customer, truthfully, who looked at their data and why.
        </div>

        <label className="mt-4 block text-sm font-medium text-fg" htmlFor="sa-reason">
          Why are you going in?
        </label>
        <textarea
          id="sa-reason"
          rows={3}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Customer reported missing doors on the Fall campaign map (ticket 412)."
          className="mt-1 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          {tooShort
            ? 'A sentence, not a word — this is the record of why you looked.'
            : `${reason.trim().length} characters`}
        </p>

        <label className="mt-4 block text-sm font-medium text-fg" htmlFor="sa-hours">
          Session length
        </label>
        <select
          id="sa-hours"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="mt-1 rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value={1}>1 hour</option>
          <option value={4}>4 hours (default)</option>
          <option value={8}>8 hours</option>
          <option value={24}>24 hours (max)</option>
        </select>

        {error && (
          <div className="mt-4 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded border border-border-strong px-4 py-2 text-sm font-medium text-fg hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={saving || tooShort}
            className="rounded bg-brand-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Starting…' : 'Start session'}
          </button>
        </div>
      </div>
    </div>
  );
}
