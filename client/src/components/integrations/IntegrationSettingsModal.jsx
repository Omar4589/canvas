import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui/index.js';

const FIGURES = [
  {
    value: 'adjustedHours',
    label: 'Adjusted hours',
    desc: 'The payroll figure — total time minus break overage. Matches the "Adjusted total" on FbTime timesheets. Recommended.',
  },
  {
    value: 'workedHours',
    label: 'Worked hours',
    desc: 'Total time minus ALL breaks. The strictest knock rate; will not match the timesheet.',
  },
  {
    value: 'grossHours',
    label: 'Total hours',
    desc: 'Clock-in to clock-out, breaks included. Overstates hours on long-break shifts — not recommended as a rate denominator.',
  },
];

// The rarely-touched half of the connection. Disconnect confirms in a Modal
// rather than window.confirm: the consequence has two halves that matter
// separately (the hours cache goes, the links stay) and a system dialog cannot
// render that difference — nor be styled, focus-trapped, or tested.
export default function IntegrationSettingsModal({ data, onChanged, onClose }) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const figureMut = useMutation({
    mutationFn: (hourFigure) =>
      api('/admin/integrations/fbtime/settings', { method: 'PATCH', body: { hourFigure } }),
    onSuccess: onChanged,
  });

  const autoMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/links/auto', { method: 'POST' }),
    onSuccess: onChanged,
  });

  const disconnectMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime', { method: 'DELETE' }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  if (confirmingDisconnect) {
    return (
      <Modal
        size="md"
        title="Disconnect FbTime?"
        onClose={() => setConfirmingDisconnect(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDisconnect(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={disconnectMut.isPending}
              onClick={() => disconnectMut.mutate()}
            >
              {disconnectMut.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-fg">
          Reports go back to <span className="font-medium">estimated</span> hours immediately — the
          cached hours are deleted.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Your canvasser links are <span className="font-medium text-fg">kept</span>, so reconnecting
          later does not mean mapping everybody again.
        </p>
        {disconnectMut.error && (
          <p className="mt-2 text-xs text-danger">{disconnectMut.error.message}</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      size="lg"
      title="FbTime connection"
      subtitle={data.fbtimeOrgName || undefined}
      onClose={onClose}
    >
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">FbTime organization</dt>
          <dd className="font-medium text-fg">{data.fbtimeOrgName || '—'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Key</dt>
          <dd className="font-mono text-fg">{data.keyPrefix}…</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Linked canvassers</dt>
          <dd className="text-fg">{data.linkCount}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Last sync</dt>
          <dd className="text-fg">
            {data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : 'not yet'}
          </dd>
        </div>
      </dl>

      {/* What Doorline actually holds. This sentence used to say "daily totals
          only", which stopped being true when the cache became shift-level, and
          contradicted the published privacy text. */}
      <p className="mt-3 text-xs text-fg-muted">
        Doorline holds each work shift's start time and its hours figures. Clock-out times and
        break detail are never stored here — they stay on the person's timesheet in FbTime.
      </p>

      <fieldset className="mt-5 border-t border-border pt-4">
        <legend className="px-1 text-xs font-medium text-fg-muted">
          Which hours divide doors-per-hour
        </legend>
        <div className="mt-2 space-y-2">
          {FIGURES.map((f) => (
            <label key={f.value} className="flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="radio"
                name="hourFigure"
                className="mt-0.5"
                checked={data.hourFigure === f.value}
                disabled={figureMut.isPending}
                onChange={() => figureMut.mutate(f.value)}
              />
              <span>
                {f.label}
                <span className="mt-0.5 block text-xs text-fg-muted">{f.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {figureMut.error && <p className="mt-2 text-xs text-danger">{figureMut.error.message}</p>}
      </fieldset>

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-xs font-medium text-fg-muted">Mapping</h3>
        {/* The blind path, kept but demoted: it is still the right tool for a
            fresh 200-person connect. Day to day, the review dialog on the page
            is the primary one. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={autoMut.isPending}
            onClick={() => autoMut.mutate()}
          >
            {autoMut.isPending ? 'Matching…' : 'Auto-match everyone by email'}
          </Button>
          <span className="text-xs text-fg-muted">
            Links every exact email match at once, without review.
          </span>
        </div>
        {autoMut.error && <p className="mt-2 text-xs text-danger">{autoMut.error.message}</p>}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <Button variant="danger" size="sm" onClick={() => setConfirmingDisconnect(true)}>
          Disconnect FbTime
        </Button>
      </div>
    </Modal>
  );
}
