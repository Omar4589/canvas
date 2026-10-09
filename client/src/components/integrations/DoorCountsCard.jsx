import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../../api/client.js';
import { Badge, Button, Card, IconAlert } from '../ui/index.js';
import { ymdToLocal } from '../../lib/datePresets.js';
import {
  clearHow,
  clearWho,
  clearsWaiting,
  doorsCompact,
  nameList,
  sendSummary,
  transitionNote,
} from '../../lib/fbtimeDoors.js';
import { ClearSentModal, TurnOffModal, TurnOnModal } from './DoorCountModals.jsx';

// Door counts to FbTime — the card for the one thing the connection SENDS.
//
// It renders the server's `doors` block and never re-derives it: doorsStatus
// (server/src/services/fbtime/doorCounts.js) is the one owner of the state, its reason
// and what may be asked for now. One STATE, then any NOTICES under it; off with nothing
// waiting is a single compact line, so an organization that never uses door counts
// doesn't grow a panel about them. Design and copy: docs/PROPOSAL_FBTIME_DOOR_COUNTS.md
// §H (the states) and §J (the screen).

const STATE_BADGE = {
  off: { variant: 'neutral', label: 'Off', dot: false },
  starting: { variant: 'info', label: 'Starting', dot: true },
  sending: { variant: 'success', label: 'Sending', dot: true },
  clearing: { variant: 'info', label: 'Clearing', dot: true },
  attention: { variant: 'danger', label: 'Needs attention', dot: true },
  paused: { variant: 'warning', label: 'Paused', dot: true },
};

const StateBadge = ({ state }) => {
  const b = STATE_BADGE[state] || STATE_BADGE.off;
  return (
    <Badge variant={b.variant} dot={b.dot}>
      {b.label}
    </Badge>
  );
};

// "2:34 PM" today, "Oct 8, 2:34 PM" before that.
const whenText = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// A civil 'YYYY-MM-DD' as "Oct 3" — parsed as a LOCAL date, never through UTC midnight.
const dayText = (ymd) => ymdToLocal(ymd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const people = (n) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`;

const Strong = ({ children }) => <span className="font-medium text-fg">{children}</span>;

const OffHint = ({ reason }) => {
  if (reason === 'conflict') {
    return (
      <>
        This FbTime organization already gets door counts from another Doorline organization. Only
        one can send them — contact Doorline support if that’s unexpected.
      </>
    );
  }
  if (reason === 'hours-only-key') {
    return (
      <>
        When you’re ready, create a key in FbTime with{' '}
        <span className="italic">Also let it fill in door counts</span> ticked, then{' '}
        <Strong>Replace key</Strong> in Settings.
      </>
    );
  }
  if (reason === 'revoke-door-key') {
    return (
      <>
        Doorline’s days stay locked on FbTime while your door-count key exists — to stop for good,
        clear first if you want, then replace it with an hours-only key and revoke it in FbTime.
      </>
    );
  }
  return <>Fill in FbTime’s doors-per-hour page from Doorline.</>;
};

// Doorline sent numbers but can't be asked to clear them now — how to get there.
const ClearHow = ({ how }) => {
  if (how === 'hours-only-key') {
    return (
      <>
        To clear the numbers Doorline sent, it needs a door-count key again: create one in FbTime
        with <span className="italic">Also let it fill in door counts</span> ticked,{' '}
        <Strong>Replace key</Strong> in Settings, then <Strong>Clear the numbers Doorline sent…</Strong>{' '}
        here — and afterwards go back to an hours-only key and revoke the door-count key in FbTime.
      </>
    );
  }
  if (how === 'fbtime-outdated') return <>Doorline can clear the numbers it sent once FbTime is updated.</>;
  if (how === 'connection') {
    return (
      <>
        Doorline can clear the numbers it sent once the FbTime connection is working again — the
        status bar says why.
      </>
    );
  }
  return null;
};

const TurnedOnBy = ({ doors }) => {
  if (!doors.enabledAt) return null;
  const on = new Date(doors.enabledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <p className="text-xs text-fg-muted">
      {doors.enabledBy?.name ? `Turned on by ${doors.enabledBy.name}, ${on}.` : `Turned on ${on}.`}
    </p>
  );
};

const LastSent = ({ doors }) => {
  if (!doors.lastSentAt) return null;
  const { people: total, groups } = sendSummary(doors.lastResult);
  const what =
    total === 0
      ? 'nobody is linked yet'
      : groups.map((g) => `the last ${g.windowDays} days, ${people(g.people)}`).join('; ');
  return (
    <p className="text-sm text-fg">
      Last sent {whenText(doors.lastSentAt)} — {what}.
    </p>
  );
};

const ReasonLine = ({ tone, children }) => (
  <p className={`flex items-start gap-2 text-sm ${tone === 'danger' ? 'text-danger-fg' : 'text-warning-fg'}`}>
    <IconAlert size={14} className="mt-0.5 shrink-0" />
    <span className="min-w-0">{children}</span>
  </p>
);

// One sentence per reason the server gave (§H). Never computed here.
const Attention = ({ doors, onOpenSettings }) => {
  const d = doors.failDetail || {};
  if (doors.reason === 'conflict') {
    return (
      <ReasonLine tone="danger">
        This FbTime organization already gets door counts from another Doorline organization. Only
        one can send them — contact Doorline support if that’s unexpected.
      </ReasonLine>
    );
  }
  if (doors.reason === 'needs-permission') {
    return (
      <>
        <ReasonLine tone="danger">
          This key can’t fill in door counts any more. In FbTime, create a key with{' '}
          <span className="italic">Also let it fill in door counts</span> ticked, then{' '}
          <span className="font-medium">Replace key</span> in Settings.
        </ReasonLine>
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          Open Settings
        </Button>
      </>
    );
  }
  if (doors.reason === 'timezone') {
    if (d.organization) {
      return (
        <ReasonLine tone="danger">
          Your organization’s time zone{d.timeZone ? ` (${d.timeZone})` : ''} isn’t one Doorline can
          use for door counts. Contact Doorline support to change it.
        </ReasonLine>
      );
    }
    return (
      <ReasonLine tone="danger">
        {d.campaignName ? (
          <>
            Campaign <span className="italic">{d.campaignName}</span> has a time zone Doorline can’t
            use for door counts{d.timeZone ? ` (${d.timeZone})` : ''}.
          </>
        ) : (
          'A campaign has a time zone Doorline can’t use for door counts.'
        )}{' '}
        Edit it on{' '}
        <Link to="/campaigns" className="font-medium underline underline-offset-2">
          Campaigns
        </Link>{' '}
        and choose one of the listed US time zones — door counts pick up again at the next send.
      </ReasonLine>
    );
  }
  if (doors.reason === 'refused') {
    return (
      <>
        <ReasonLine tone="danger">
          FbTime refused the last {doors.failPhase === 'clear' ? 'clear' : 'send'}
          {doors.failCode ? ` (${doors.failCode})` : ''}. Doorline tries again at the next send — if
          it keeps happening, contact Doorline support.
        </ReasonLine>
        {doors.lastError && <p className="text-xs text-fg-muted">FbTime said: {doors.lastError}</p>}
      </>
    );
  }
  if (doors.reason === 'stuck') {
    return (
      <>
        <ReasonLine tone="danger">
          Sends to FbTime have kept failing for about two hours. Doorline keeps trying every 15
          minutes — if it doesn’t clear up, contact Doorline support.
        </ReasonLine>
        {doors.lastError && <p className="text-xs text-fg-muted">Last error: {doors.lastError}</p>}
      </>
    );
  }
  return <ReasonLine tone="danger">Door counts need attention.</ReasonLine>;
};

const PAUSED = {
  connection: 'Waiting on the FbTime connection — the status bar above says what needs attention.',
  doorline: 'Doorline has paused door counts for everyone for now. Nothing is sent until they resume.',
  'fbtime-outdated': 'FbTime needs an update before Doorline can send door counts. Nothing is sent until then.',
};

// Why a waiting clear can't run — the server's `blockedBy`, first that applies.
const blockedText = (doors) => {
  switch (doors.pendingClears?.blockedBy) {
    case 'paused':
      return 'the FbTime connection needs attention first (the status bar says why)';
    case 'unavailable':
      return 'Doorline has paused door counts for everyone';
    case 'fbtime-outdated':
      return 'FbTime needs an update first';
    case 'conflict':
      return 'another Doorline organization sends door counts to this FbTime organization';
    case 'needs-permission':
      return 'the key can’t fill in door counts — use Replace key in Settings with one that can';
    case 'refused':
      return `FbTime refused the last clear${doors.failCode ? ` (${doors.failCode})` : ''}`;
    case 'stuck':
      return 'clears have kept failing for about two hours';
    default:
      return null;
  }
};

const Notice = ({ children }) => (
  <li className="flex items-start gap-2 text-sm text-fg">
    <IconAlert size={14} className="mt-0.5 shrink-0 text-warning-fg" />
    <span className="min-w-0">{children}</span>
  </li>
);

const DoorCountsCard = ({ data, onOpenSettings }) => {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();
  const doors = data.doors;
  const [dialog, setDialog] = useState(null); // 'on' | 'off' | 'clear'
  const [announce, setAnnounce] = useState('');

  // Completion is announced (aria-live) when a refetch shows the first send done or a
  // clear finished. A change this card's own button caused is announced by the button,
  // so the state its response carried is skipped once.
  const prevState = useRef(doors.state);
  const expectedState = useRef(null);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = doors.state;
    if (prev === doors.state) return;
    if (expectedState.current === doors.state) {
      expectedState.current = null;
      return;
    }
    const note = transitionNote(prev, doors.state, doors);
    if (note) setAnnounce(note);
  }, [doors]);

  const doorsMut = useMutation({
    mutationFn: ({ body }) => api('/admin/integrations/fbtime/doors', { method: 'PATCH', body }),
    onSuccess: (res, { note }) => {
      if (res && 'doors' in res) {
        expectedState.current = res.doors && res.doors.state !== doors.state ? res.doors.state : null;
        qc.setQueryData(['admin', 'integrations', 'fbtime', orgId], (old) =>
          old ? { ...old, doors: res.doors } : old
        );
      }
      // The audit row, and the roster's "Clear waiting" / per-person clear markers.
      qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', 'events', orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', 'people', orgId] });
      setDialog(null);
      setAnnounce(note);
    },
  });

  const open = (which) => {
    doorsMut.reset();
    setDialog(which);
  };
  const close = () => {
    doorsMut.reset();
    setDialog(null);
  };
  const send = (body, note) => doorsMut.mutate({ body, note });

  const waiting = clearsWaiting(doors);
  const how = clearHow(doors, data.status);
  const isOff = doors.state === 'off';
  const pending = doorsMut.isPending;
  const offerTurnOn =
    !doors.enabled && doors.available && !['conflict', 'hours-only-key'].includes(doors.reason);

  const cancelButton = (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      aria-label="Cancel the waiting clears"
      onClick={() => send({ cancelClears: true }, 'Waiting clears cancelled.')}
    >
      Cancel
    </Button>
  );

  const actions = (
    <>
      {isOff && doors.canClearAll && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => open('clear')}>
          Clear the numbers Doorline sent…
        </Button>
      )}
      {isOff && doors.reason === 'hours-only-key' && (
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          Open Settings
        </Button>
      )}
      {doors.state === 'clearing' && cancelButton}
      {doors.enabled ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => open('off')}>
          Turn off…
        </Button>
      ) : (
        offerTurnOn && (
          <Button size="sm" disabled={pending} onClick={() => open('on')}>
            Turn on…
          </Button>
        )
      )}
    </>
  );

  const dialogs = (
    <>
      {dialog === 'on' && (
        <TurnOnModal
          doors={doors}
          linkCount={data.linkCount || 0}
          pending={pending}
          error={doorsMut.error}
          onConfirm={() =>
            send({ enabled: true }, 'Door counts turned on. The first send usually goes within a few minutes.')
          }
          onClose={close}
        />
      )}
      {dialog === 'off' && (
        <TurnOffModal
          doors={doors}
          pending={pending}
          error={doorsMut.error}
          onConfirm={(clear) =>
            send(
              clear ? { enabled: false, clear: true } : { enabled: false },
              clear ? 'Door counts turned off. Doorline will clear the numbers it sent.' : 'Door counts turned off.'
            )
          }
          onClose={close}
        />
      )}
      {dialog === 'clear' && (
        <ClearSentModal
          pending={pending}
          error={doorsMut.error}
          onConfirm={() => send({ clear: true }, 'Doorline will clear the numbers it sent.')}
          onClose={close}
        />
      )}
    </>
  );

  // A Cancel has no dialog to hold its error.
  const inlineError =
    !dialog && doorsMut.error ? <p className="basis-full text-xs text-danger">{doorsMut.error.message}</p> : null;

  // The notices. Those about SENDING describe the current turn-on only (the server
  // hides older results), so they show while door counts are on; a waiting clear that
  // can't run shows on or off.
  const notices = [];
  if (doors.enabled && doors.replacedTyped > 0) {
    notices.push(
      <li key="typed" className="text-sm text-fg-muted">
        Since door counts were turned on, Doorline’s numbers have replaced about{' '}
        {doors.replacedTyped.toLocaleString()} {doors.replacedTyped === 1 ? 'number' : 'numbers'} typed
        on FbTime.
      </li>
    );
  }
  if (doors.enabled && doors.unknownPeople?.length > 0) {
    const n = doors.unknownPeople.length;
    const named = doors.unknownPeople.filter((p) => p.name).map((p) => p.name);
    notices.push(
      <Notice key="unknown">
        {n} linked {n === 1 ? 'person isn’t' : 'people aren’t'} in your FbTime organization
        {named.length ? ` (${nameList(named)})` : ''} — shown as <Strong>Broken link</Strong> below.
      </Notice>
    );
  }
  if (doors.enabled && doors.overCapCount > 0) {
    const shown = (doors.overCap || []).map(
      (o) => `${o.name || 'an FbTime person'}, ${dayText(o.date)} — ${Number(o.knocks || 0).toLocaleString()} doors`
    );
    const more = doors.overCapCount - shown.length;
    notices.push(
      <Notice key="overcap">
        Not sent: {shown.join('; ')}
        {more > 0 ? `, and ${more} more` : ''} (FbTime’s limit is 2,000 a day).
      </Notice>
    );
  }
  const blocked = waiting ? blockedText(doors) : null;
  if (blocked) {
    notices.push(
      <li key="clears" className="flex flex-wrap items-start gap-2 text-sm text-fg">
        <IconAlert size={14} className="mt-0.5 shrink-0 text-warning-fg" />
        <span className="min-w-0 flex-1">
          Waiting to clear the numbers Doorline sent for {clearWho(doors.pendingClears)} — {blocked}.
        </span>
        {cancelButton}
      </li>
    );
  }

  const compact = doorsCompact(doors);

  // ONE Card for both layouts, with the live region as its first child: a region
  // re-inserted along with its message (compact → expanded on Turn on) is often not
  // announced at all.
  return (
    <Card className={compact ? 'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5' : 'px-4 py-3'}>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {compact ? (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-sm font-medium text-fg">Door counts to FbTime</h2>
            <StateBadge state={doors.state} />
          </div>
          <p className="min-w-0 flex-1 text-xs text-fg-muted">
            <OffHint reason={doors.reason} />
          </p>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          {how && (
            <p className="basis-full text-xs text-fg-muted">
              <ClearHow how={how} />
            </p>
          )}
          {inlineError}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-fg">Door counts to FbTime</h2>
            <StateBadge state={doors.state} />
          </div>

          <div className="mt-2 space-y-1.5">
            {doors.state === 'off' && (
              <>
                <p className="text-sm text-fg-muted">
                  <OffHint reason={doors.reason} />
                </p>
                {how && (
                  <p className="text-xs text-fg-muted">
                    <ClearHow how={how} />
                  </p>
                )}
              </>
            )}
            {doors.state === 'starting' && (
              <>
                <p className="text-sm text-fg">
                  The first send — the last 120 days — usually goes within a few minutes.
                </p>
                <TurnedOnBy doors={doors} />
              </>
            )}
            {doors.state === 'sending' && (
              <>
                <LastSent doors={doors} />
                <TurnedOnBy doors={doors} />
              </>
            )}
            {doors.state === 'clearing' && (
              <>
                <p className="text-sm text-fg">
                  Removing the numbers Doorline sent for {clearWho(doors.pendingClears)}, and bringing
                  back numbers typed there.
                </p>
                {doors.pendingClears?.confirmPending && (
                  <p className="text-xs text-fg-muted">
                    Doorline repeats the clear once about 15 minutes after the first pass, to catch a
                    send that landed late.
                  </p>
                )}
              </>
            )}
            {doors.state === 'attention' && (
              <>
                <Attention doors={doors} onOpenSettings={onOpenSettings} />
                {doors.lastSentAt && (
                  <p className="text-xs text-fg-muted">Last sent {whenText(doors.lastSentAt)}.</p>
                )}
              </>
            )}
            {doors.state === 'paused' && (
              <>
                <ReasonLine tone="warning">{PAUSED[doors.reason] || 'Door counts are paused.'}</ReasonLine>
                {doors.lastSentAt && (
                  <p className="text-xs text-fg-muted">Last sent {whenText(doors.lastSentAt)}.</p>
                )}
              </>
            )}
          </div>

          {notices.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">{notices}</ul>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {inlineError}
            {actions}
          </div>
        </>
      )}

      {dialogs}
    </Card>
  );
};

export default DoorCountsCard;
