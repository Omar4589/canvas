import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button } from '../ui/index.js';
import {
  clearWho,
  clearsWaiting,
  keyCanFillDoors,
  keyCanWriteDoors,
  replaceKeyFlags,
  withPeriod,
} from '../../lib/fbtimeDoors.js';

// Replace key — the same test-then-confirm guard as the connect card (the name the
// key reads is checked BEFORE it is used), for an organization already connected.
// POST /fbtime/connect is the one route either way: the same FbTime organization keeps
// the links, door counts and any waiting clear (and does NOT auto-match, so an admin's
// unlink stays unlinked); a different one answers 409 ORG_CHANGE_CONFIRM first, and
// 409 DOORS_CLEAR_PENDING while a clear's first pass waits. The confirmed retry may
// carry both flags in one request.

const Strong = ({ children }) => <span className="font-semibold">{children}</span>;

/**
 * What a tested key can do and what using it will change. Presentational, so each
 * case renders in a test: `tested` is the POST /fbtime/test answer, `doors` the card's
 * block, `confirm` the 409s collected so far — { orgChange?: { organization },
 * clearPending?: { all, persons } }.
 */
export const ReplaceKeyResult = ({ tested, doors, currentOrgName, confirm, pending, onUse, onCancel }) => {
  const available = Boolean(doors?.available);
  const canFill = keyCanFillDoors(tested);
  const waiting = clearsWaiting(doors);
  const orgChange = confirm?.orgChange;
  const clearPending = confirm?.clearPending;
  const thisOrg = currentOrgName || 'the connected organization';

  return (
    <div className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2.5">
      <p className="text-sm text-fg">
        This key reads <Strong>{tested.organization?.name || 'an FbTime organization'}</Strong>
        {tested.key?.name ? <span className="text-fg-muted"> (key “{tested.key.name}”)</span> : null}.
      </p>
      {available && canFill && <p className="mt-1 text-sm text-fg">It can also fill in door counts.</p>}

      {!orgChange && available && doors.enabled && !keyCanWriteDoors(tested) && (
        <p className="mt-1 text-xs text-warning-fg">
          Door counts will stop and the card will show Needs attention until a key that can fill
          them in is in place.
        </p>
      )}
      {!orgChange && !clearPending && available && waiting && (
        <p className="mt-1 text-xs text-fg-muted">
          Doorline is waiting to clear numbers it sent —{' '}
          {canFill
            ? 'it will run with this key.'
            : 'it can’t run with this key, which can’t fill in door counts.'}
        </p>
      )}

      {orgChange && (
        <p className="mt-2 text-sm text-fg">
          This key reads <Strong>a different</Strong> FbTime organization (
          <Strong>{orgChange.organization?.name || tested.organization?.name || 'another one'}</Strong>),
          not <Strong>{thisOrg}</Strong>.{' '}
          {doors?.enabled && doors?.everSent
            ? `Door counts will be turned off; numbers already sent stay in ${thisOrg} — locked while its door-count key is live, so clear first if you want them gone, then revoke that key — and your links probably won’t match.`
            : doors?.enabled
              ? 'Door counts will be turned off, and your links probably won’t match.'
              : doors?.everSent
                ? `Numbers Doorline already sent stay in ${thisOrg} — locked while its door-count key is live, so clear first if you want them gone, then revoke that key — and your links probably won’t match.`
                : 'Your links probably won’t match.'}{' '}
          Use it anyway?
        </p>
      )}
      {(clearPending || (orgChange && waiting)) && (
        <p className="mt-2 text-xs text-warning-fg">
          {withPeriod(
            `Doorline is still clearing the numbers it sent${clearPending ? ` for ${clearWho(clearPending)}` : ''}`
          )}{' '}
          Using this key abandons that clear.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => onUse(replaceKeyFlags(confirm, doors))}>
          {pending ? 'Replacing…' : orgChange || clearPending ? 'Use it anyway' : 'Use this key'}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

const ReplaceKey = ({ doors, currentOrgName, onChanged }) => {
  const [apiKey, setApiKey] = useState('');
  const [tested, setTested] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [done, setDone] = useState(null);

  const testMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/test', { method: 'POST', body: { apiKey } }),
    onSuccess: (res) => {
      setConfirm(null);
      setTested(res);
    },
  });

  const connectMut = useMutation({
    mutationFn: (flags) =>
      api('/admin/integrations/fbtime/connect', { method: 'POST', body: { apiKey, ...flags } }),
    onSuccess: (res) => {
      setApiKey('');
      setTested(null);
      setConfirm(null);
      setDone(
        res?.orgChanged
          ? 'Key replaced — it reads a different FbTime organization, so door counts are off and your links may need redoing.'
          : 'Key replaced. Hours keep flowing and your links are kept.'
      );
      onChanged();
    },
    // The two confirmations come back as 409s; each adds its line to the result
    // panel, and the next "Use it anyway" carries every flag confirmed so far.
    onError: (err) => {
      if (err.code === 'ORG_CHANGE_CONFIRM') {
        setConfirm((c) => ({ ...c, orgChange: { organization: err.data?.organization || null } }));
      } else if (err.code === 'DOORS_CLEAR_PENDING') {
        setConfirm((c) => ({
          ...c,
          clearPending: { all: Boolean(err.data?.all), persons: err.data?.persons || [] },
        }));
      }
    },
  });

  const reset = () => {
    setApiKey('');
    setTested(null);
    setConfirm(null);
    testMut.reset();
    connectMut.reset();
  };

  // A confirmation 409 is a question in the panel, not an error under it.
  const confirmCodes = ['ORG_CHANGE_CONFIRM', 'DOORS_CLEAR_PENDING'];
  const error =
    testMut.error || (connectMut.error && !confirmCodes.includes(connectMut.error.code) ? connectMut.error : null);

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-fg-muted">Replace key</h3>
      <p className="mt-1 text-xs text-fg-muted">
        Paste a new key from FbTime’s <span className="font-medium text-fg">Integrations → New key</span>{' '}
        — Doorline checks which organization it reads before using it.
      </p>
      <div className="mt-2 flex max-w-md items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          aria-label="New FbTime API key"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value.trim());
            setTested(null);
            setConfirm(null);
            setDone(null);
            connectMut.reset();
          }}
          placeholder="fbt_live_…"
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm text-fg placeholder:text-fg-subtle"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!apiKey || testMut.isPending || connectMut.isPending}
          onClick={() => testMut.mutate()}
        >
          {testMut.isPending ? 'Checking…' : 'Test'}
        </Button>
      </div>

      {tested && (
        <ReplaceKeyResult
          tested={tested}
          doors={doors}
          currentOrgName={currentOrgName}
          confirm={confirm}
          pending={connectMut.isPending}
          onUse={(flags) => connectMut.mutate(flags)}
          onCancel={reset}
        />
      )}

      {error && <p className="mt-2 text-xs text-danger">{error.message}</p>}
      {done && !tested && <p className="mt-2 text-xs text-success-fg">{done}</p>}
    </div>
  );
};

export default ReplaceKey;
