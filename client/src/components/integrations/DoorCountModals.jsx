import { useState } from 'react';
import { Button, Modal } from '../ui/index.js';

// The door-count confirmations. Presentational on purpose: the card and the page own
// the requests and hand down `pending` and `error`, so a 409 or 403 lands INSIDE the
// dialog that asked (DOORS_STAFF_FORBIDDEN, DOORS_SCOPE_MISSING, …) — and so a render
// test can draw each dialog in each state without a click. Copy: the proposal's §J.

const ModalError = ({ error }) =>
  error ? <p className="mt-3 text-xs text-danger">{error.message}</p> : null;

const confirmFooter = ({ pending, onClose, confirm }) => (
  <div className="flex justify-end gap-2">
    <Button variant="secondary" disabled={pending} onClick={onClose}>
      Cancel
    </Button>
    {confirm}
  </div>
);

// "42 people now, and anyone you link later" — linkCount is the number of linked
// FbTime people, which is exactly who a send lists.
const peopleNow = (n) =>
  n > 0
    ? `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'} now, and anyone you link later`
    : 'nobody is linked yet, so anyone you link later';

export const TurnOnModal = ({ doors, linkCount = 0, pending, error, onConfirm, onClose }) => (
  <Modal
    size="md"
    title="Turn on door counts?"
    onClose={pending ? undefined : onClose}
    footer={confirmFooter({
      pending,
      onClose,
      confirm: (
        <Button disabled={pending} onClick={onConfirm}>
          {pending ? 'Turning on…' : 'Turn on'}
        </Button>
      ),
    })}
  >
    <p className="text-sm text-fg">
      Every 15 minutes Doorline will send FbTime the doors each linked canvasser recorded each
      day — {peopleNow(linkCount)} — for the last 7 days, and every night the last 120 days.
    </p>
    <p className="mt-2 text-sm text-fg-muted">
      FbTime receives its own person id, the date and the number; nothing about voters.
    </p>
    <p className="mt-2 text-sm text-fg">
      On days Doorline reports, FbTime shows Doorline’s number, locked; numbers typed there are
      filed away by FbTime —{' '}
      <span className="font-medium">tell whoever types doors on FbTime.</span> Clearing later in
      Doorline brings typed numbers back.
    </p>
    {/* Turning on cancels a waiting clear-all (the first send restates the last 120
        days); per-person clears stay, so only the clear-all is mentioned. */}
    {doors?.pendingClears?.all && (
      <p className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
        This cancels the clear that’s waiting for everything Doorline sent: the last 120 days are
        sent again, and older days keep the numbers Doorline sent before.
      </p>
    )}
    <ModalError error={error} />
  </Modal>
);

export const TurnOffModal = ({ doors, pending, error, onConfirm, onClose }) => {
  const [clear, setClear] = useState(false);
  // Nothing sent, nothing to clear; and a clear-all already waiting is never lowered
  // by asking again, so the box would promise nothing new.
  const canAskClear = Boolean(doors?.everSent) && !doors?.pendingClears?.all;

  return (
    <Modal
      size="md"
      title="Turn off door counts?"
      onClose={pending ? undefined : onClose}
      footer={confirmFooter({
        pending,
        onClose,
        confirm: (
          <Button variant="danger" disabled={pending} onClick={() => onConfirm(canAskClear && clear)}>
            {pending ? 'Turning off…' : 'Turn off'}
          </Button>
        ),
      })}
    >
      <p className="text-sm text-fg">
        Days Doorline sent keep its numbers — locked while your door-count key is live — unless you
        clear them. Clearing brings back numbers typed there and blanks the rest.
      </p>
      {canAskClear && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
            checked={clear}
            disabled={pending}
            onChange={(e) => setClear(e.target.checked)}
          />
          Also clear the numbers Doorline sent
        </label>
      )}
      {doors?.pendingClears?.all && (
        <p className="mt-3 text-sm text-fg-muted">
          A clear of everything Doorline sent is already waiting — turning off doesn’t cancel it.
        </p>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        To stop for good: clear first if you want, then in FbTime create a key without door counts,
        use <span className="font-medium text-fg">Replace key</span> in Settings, and revoke the
        door-count key — Doorline’s days then unlock on FbTime.
      </p>
      <ModalError error={error} />
    </Modal>
  );
};

/**
 * "Clear the numbers Doorline sent…" — everyone (the Off card) or one FbTime person
 * who is not linked now (a roster row). Either way FbTime brings back typed numbers.
 */
export const ClearSentModal = ({ name, pending, error, onConfirm, onClose }) => (
  <Modal
    size="md"
    title={name ? `Clear the numbers Doorline sent for ${name}?` : 'Clear the numbers Doorline sent?'}
    onClose={pending ? undefined : onClose}
    footer={confirmFooter({
      pending,
      onClose,
      confirm: (
        <Button variant="danger" disabled={pending} onClick={onConfirm}>
          {pending ? 'Clearing…' : 'Clear'}
        </Button>
      ),
    })}
  >
    <p className="text-sm text-fg">
      Doorline removes every number it sent {name ? `for ${name}` : 'to FbTime'} — back to the
      first day it sent — and FbTime brings back any number someone had typed on those days. Days
      with nothing typed go blank.
    </p>
    <p className="mt-2 text-xs text-fg-muted">
      It usually runs within a few minutes. Until it finishes, you can cancel it from the Door
      counts card.
    </p>
    <ModalError error={error} />
  </Modal>
);

/**
 * Stop counting a kept earlier account for an FbTime person (§G). Its shifts go back
 * through the one owner rule: to the current link if there is one, else to nobody.
 */
export const StopCountingModal = ({ row, kept, doorsOn, pending, error, onConfirm, onClose }) => {
  const person = row?.fbtimeName || 'this FbTime person';
  const linked = ['linked', 'orphan'].includes(row?.kind);
  return (
    <Modal
      size="md"
      title="Stop counting this earlier account?"
      subtitle={kept?.name ? `${kept.name} (earlier account)` : undefined}
      onClose={pending ? undefined : onClose}
      footer={confirmFooter({
        pending,
        onClose,
        confirm: (
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? 'Stopping…' : 'Stop counting'}
          </Button>
        ),
      })}
    >
      <p className="text-sm text-fg">
        Doorline will stop counting this earlier account for{' '}
        <span className="italic">{person}</span> — its hours{' '}
        {linked ? 'return to the current link' : `go unassigned until ${person} is linked`}, so the
        earlier account’s past rates become estimated
        {linked && doorsOn ? ', and door counts re-send' : ''}.
      </p>
      {kept?.deleted && (
        <p className="mt-2 text-sm font-medium text-fg">This can’t be undone.</p>
      )}
      <ModalError error={error} />
    </Modal>
  );
};
