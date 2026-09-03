import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Card } from '../ui/index.js';

// The not-connected state. Moved out of the page unchanged in behaviour — the
// test-then-confirm flow is the wrong-customer-key guard and its copy is already
// right. Note it stays NARROW while the rest of the page went full width: the
// mapping TABLE wanted the screen, a key-entry form does not.
export default function ConnectCard({ configured, onDone }) {
  const [apiKey, setApiKey] = useState('');
  // The Test result the admin must confirm — pasting another customer's key is
  // caught HERE as a name that reads wrong, not weeks later as a report full of
  // strangers' hours.
  const [tested, setTested] = useState(null);

  const testMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/test', { method: 'POST', body: { apiKey } }),
    onSuccess: (res) => setTested(res),
  });

  const connectMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/connect', { method: 'POST', body: { apiKey } }),
    onSuccess: () => {
      setApiKey('');
      setTested(null);
      onDone();
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">FbTime — measured hours</h2>
        <p className="mt-1 max-w-prose text-sm text-fg-muted">
          If your canvassers clock in and out with FbTime, connect it and doors-per-hour will divide
          by the hours they were actually on the clock instead of estimating from knock times. Your
          reports label every number as <span className="font-medium text-fg">measured</span> or{' '}
          <span className="font-medium text-fg">estimated</span>, so the two are never mixed.
        </p>

        {!configured && (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            This server is not configured to store integration keys yet (CREDENTIAL_SEAL_KEY).
            Contact Doorline before connecting.
          </p>
        )}

        <div className="mt-4 max-w-md space-y-2">
          <label className="block text-xs font-medium text-fg-muted" htmlFor="fbtime-key">
            FbTime API key
          </label>
          <input
            id="fbtime-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value.trim());
              setTested(null);
            }}
            placeholder="fbt_live_…"
            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle"
          />
          <p className="text-xs text-fg-muted">
            An admin of your FbTime organization creates this under{' '}
            <span className="font-medium text-fg">Integrations → New key</span> there. It is shown
            once; paste it straight in. Doorline stores it encrypted and never displays it again.
          </p>
        </div>

        {!tested ? (
          <Button
            className="mt-4"
            disabled={!apiKey || testMut.isPending}
            onClick={() => testMut.mutate()}
          >
            {testMut.isPending ? 'Checking…' : 'Test connection'}
          </Button>
        ) : (
          <div className="mt-4 max-w-md rounded-lg border border-border bg-sunken px-3 py-2.5">
            <p className="text-sm text-fg">
              This key reads{' '}
              <span className="font-semibold">
                {tested.organization?.name || 'an FbTime organization'}
              </span>
              {tested.key?.name ? (
                <span className="text-fg-muted"> (key “{tested.key.name}”)</span>
              ) : null}
              . Is that your organization?
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={connectMut.isPending}
                onClick={() => connectMut.mutate()}
              >
                {connectMut.isPending ? 'Connecting…' : 'Yes — connect'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setTested(null)}>
                No, cancel
              </Button>
            </div>
          </div>
        )}

        {(testMut.error || connectMut.error) && (
          <p className="mt-2 text-xs text-danger">
            {(testMut.error || connectMut.error).message}
          </p>
        )}
      </Card>

      <Card className="bg-sunken p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          What connecting changes
        </h3>
        <ul className="mt-3 space-y-2.5 text-sm text-fg-muted">
          <li>
            Doors-per-hour divides by <span className="font-medium text-fg">clocked hours</span>,
            not an estimate from knock times.
          </li>
          <li>
            You map each FbTime person to a Doorline canvasser once. Matching emails link
            themselves; the rest you confirm by hand.
          </li>
          <li>
            Anyone unmapped keeps their old estimated figure, clearly labelled — never a zero, and
            never mixed into a measured rate.
          </li>
        </ul>
      </Card>
    </div>
  );
}
