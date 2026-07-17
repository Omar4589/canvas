import { useState } from 'react';
import { api } from '../api/client.js';

// The grant form itself — shared between the 403-triggered gate modal (SupportAccessGate.jsx) and
// the "Start a session" affordance on the Support access page, so access can begin deliberately
// instead of only by tripping over a Forbidden somewhere.
//
// It is deliberately not a rubber stamp. The reason is required, it is free text, and the operator
// is told plainly — before they type it — that what they are about to open is logged against their
// name. A dropdown of canned reasons would become a formality nobody reads; a sentence you had to
// write is something you can be asked about later.
const KINDS = [
  { value: 'support', label: 'Support — a customer asked for help' },
  { value: 'incident', label: 'Incident — investigating a problem' },
  { value: 'migration', label: 'Migration — moving or fixing data' },
  { value: 'audit', label: 'Audit — reviewing, not changing' },
  { value: 'other', label: 'Other' },
];

export default function StartSupportSessionForm({
  organizationId,
  organizationName,
  onStarted,
  onCancel,
  cancelLabel = 'Cancel',
}) {
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState('support');
  const [hours, setHours] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tooShort = reason.trim().length < 10;

  async function start() {
    setError(null);
    setSaving(true);
    try {
      const res = await api('/super-admin/access/grants', {
        method: 'POST',
        body: { organizationId, reason: reason.trim(), kind, hours: Number(hours) },
      });
      setReason('');
      onStarted?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      // Must reset on success too — callers keep this mounted (see SupportAccessGate's history).
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mt-2 text-sm text-fg-muted">
        You are not a member of {organizationName ? <strong className="text-fg">{organizationName}</strong> : 'this organization'},
        so opening it counts as support access. It lasts{' '}
        <strong className="text-fg">{hours} hours</strong> and ends on its own.
      </p>

      <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
        Every request you make here that touches voter data is recorded against your name, with the
        reason below. This is what lets us tell a customer, truthfully, who looked at their data and why.
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

      <div className="mt-4 flex flex-wrap gap-4">
        <div>
          <label className="block text-sm font-medium text-fg" htmlFor="sa-kind">
            Kind
          </label>
          <select
            id="sa-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-fg" htmlFor="sa-hours">
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
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-border-strong px-4 py-2 text-sm font-medium text-fg hover:bg-muted disabled:opacity-50"
        >
          {cancelLabel}
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
  );
}
