import { useEffect, useState } from 'react';
import IconButton from './ui/IconButton.jsx';
import { IconX } from './ui/icons.jsx';
import InfoHint from './InfoHint.jsx';
import { SELECTION_CAP } from '../lib/lassoSelect.js';

// The "Select doors" action bar — bottom-center INSIDE the map section (absolute, never fixed:
// both pages' fullscreen is a z-50 box around the map, and a fixed bar would be painted under it).
// Reuses BulkReviewBar's shell and its inline-confirm choreography, with one deliberate change:
// this action ALWAYS confirms. BulkReviewBar applies small selections straight from the bar;
// desk-restricting doors has no honest undo (unmark deletes every desk row on those doors,
// including marks that predate the action), so even 2 doors get a second tap — the same rule
// BuildingPopup already applies to a two-unit building.
//
// Presentational: the page owns the selection, the mutations and the result toast. Everything
// printed here comes from planDoorSelection(), which is where the honesty rules live.

// Anything bigger than a screenful gets the modal with the typed gate, mirroring BulkReviewBar.
const CONFIRM_OVER = 25;

const n = (v) => (v || 0).toLocaleString();
const s = (count, word, plural) => (count === 1 ? word : plural || `${word}s`);

// The "N will be marked · N already restricted · …" line. Only ever prints what the page's scope
// can answer exactly: without a pass scope the per-round buckets come back null from
// planDoorSelection and are simply absent here rather than guessed.
const breakdownParts = (plan) => {
  const parts = [];
  parts.push(`${n(plan.markable)} will be marked`);
  if (plan.alreadyRestricted > 0) parts.push(`${n(plan.alreadyRestricted)} already restricted`);
  if (plan.completedThisRound > 0) parts.push(`${n(plan.completedThisRound)} completed this round`);
  if (plan.cannotMark > 0) parts.push(`${n(plan.cannotMark)} can't be marked`);
  return parts;
};

// Why a door can't be marked, in the order the payload drops them.
const cannotMarkLines = (plan) => {
  const r = plan.cannotMarkReasons || {};
  const lines = [];
  if (r.intake > 0) lines.push(`${n(r.intake)} ${s(r.intake, 'is', 'are')} not in a walk list yet`);
  if (r.excluded > 0) lines.push(`${n(r.excluded)} ${s(r.excluded, 'is', 'are')} excluded from books`);
  if (r.doNotKnock > 0) lines.push(`${n(r.doNotKnock)} ${s(r.doNotKnock, 'is', 'are')} marked do-not-knock`);
  return lines;
};

export default function DoorSelectionBar({
  plan, // planDoorSelection() over the CURRENT drawn selection
  // What the statuses on screen ACTUALLY answer, which decides how the ⓘ explains the numbers.
  // 'round' = this round's status (plan.perRound is true); 'canvasser' = one canvasser's own
  // status (the Map page's canvasser filter — getUserStatusMap, not the round and not the
  // campaign); 'campaign' = the stored latest-across-all-rounds status.
  statusBasis = 'campaign',
  passLabel = null, // "Pass 2 · North" — named in the confirm so the round is never implicit
  scopeNote = null, // page-specific disclosure (e.g. global-mode unmark's per-walk-list limit)
  canUnmark = true, // the selection holds doors that could carry a desk mark
  busy = null, // 'mark' | 'unmark' | null
  error = null,
  readOnly = false,
  readOnlyReason = 'This campaign is read-only — marking doors is disabled.',
  reloading = false, // the door array is refetching: the ids under the selection are in motion
  housesHidden = false, // the Houses layer is off, so nothing on screen is selectable
  overCap = null, // { wouldBe } from the last REFUSED lasso, or null
  onDismissOverCap = null,
  onMark, // ({ ids, scope }) => void — scope 'unknocked' | 'incomplete'
  onUnmark, // ({ ids }) => void
  onClear,
  onClose = null, // the ✕: leave select mode entirely (falls back to onClear)
}) {
  // The confirm freezes the plan it opened on. Live polling replaces the door array every 20 s and
  // must not move the number under a typed gate — so the snapshot is taken synchronously in the
  // click handler, never read back out of a ref during a later render.
  const [pending, setPending] = useState(null); // { mode, plan } awaiting confirmation

  const total = plan?.total || 0;
  const markCount = plan?.markable || 0;
  const unmarkCount = plan?.unmarkIds?.length || 0;
  const blocked = readOnly || reloading || !!busy;

  const request = (mode) => {
    if (blocked || !plan) return;
    setPending({ mode, plan });
  };

  const confirm = (scope) => {
    if (!pending) return;
    const frozen = pending.plan;
    if (pending.mode === 'mark') onMark({ ids: frozen.markIds, scope: scope || 'incomplete' });
    else onUnmark({ ids: frozen.unmarkIds });
    setPending(null);
  };

  // The inline (≤ 25) path lives in the bar; the bigger one opens the modal below. A mark that
  // holds doors the crew already reached ALWAYS takes the modal whatever its size — the scope
  // choice lives there, and a lasso must never silently relabel a not-home or a refusal. Outside a
  // pass scope `reached` is null, which is the case where that choice can't be offered honestly.
  const owesScope = !!pending && pending.mode === 'mark' && (pending.plan.reached || 0) > 0;
  const pendingCount = pending ? (pending.mode === 'mark' ? pending.plan.markable : pending.plan.unmarkIds.length) : 0;
  const inline = !!pending && !owesScope && pendingCount <= CONFIRM_OVER;
  const inlineCount = inline ? pendingCount : 0;

  const disabledReason = readOnly
    ? readOnlyReason
    : reloading
    ? 'Reloading doors…'
    : housesHidden
    ? 'Houses are hidden — turn the Houses layer back on to pick doors.'
    : markCount === 0 && total > 0
    ? "None of these doors can be marked — they're already done, already restricted, or not in a walk list."
    : null;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-3xl rounded-lg border border-border bg-card p-3 shadow-lg">
          {inline ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg">
                {pending.mode === 'mark'
                  ? `Mark ${n(inlineCount)} ${s(inlineCount, 'door')} restricted?`
                  : `Remove desk marks on ${n(inlineCount)} ${s(inlineCount, 'door')}?`}
                {passLabel && <span className="ml-1 text-fg-muted">In {passLabel}.</span>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => confirm('incomplete')}
                  disabled={!!busy}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy
                    ? 'Working…'
                    : pending.mode === 'mark'
                    ? `Mark ${n(inlineCount)} ${s(inlineCount, 'door')}`
                    : `Unmark ${n(inlineCount)} ${s(inlineCount, 'door')}`}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={!!busy}
                  className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-sunken disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-fg">
                    <span className="tabular-nums">
                      {n(total)} {s(total, 'door')} selected
                    </span>
                    {reloading && <span className="text-xs font-normal text-fg-subtle">Reloading doors…</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                    <span className="tabular-nums">{breakdownParts(plan || {}).join(' · ')}</span>
                    <InfoHint label="What do these numbers count?" width="w-80">
                      <ul className="space-y-1.5">
                        <li>
                          <strong className="text-fg">{n(total)} selected</strong> — every door you lassoed or
                          clicked that the map is drawing right now. A door hidden by a filter or a Layers toggle
                          can't be picked and isn't in here.
                        </li>
                        <li>
                          <strong className="text-fg">{n(markCount)} will be marked</strong> — the doors this
                          action writes a <strong>Restricted Access</strong> mark on. Canvassers see them slate,
                          they stay out of every rate and knock count, and the next cut can exclude them.
                        </li>
                        {plan?.perRound ? (
                          <li>
                            Doors already <strong>completed this round</strong> keep their result and doors
                            already restricted are skipped — the server counts both and the result says how many.
                          </li>
                        ) : statusBasis === 'canvasser' ? (
                          <li>
                            You're filtered to <strong>one canvasser</strong>, so the statuses on screen are that
                            person's own — not what the round holds. The console can't say here what happened in
                            the round; the result after the action reports it exactly.
                          </li>
                        ) : (
                          <li>
                            This view shows each door's status across the <strong>whole campaign</strong>, so the
                            console can't say here what happened in the round each walk list is on now. The result
                            after the action reports that exactly.
                          </li>
                        )}
                        {cannotMarkLines(plan || {}).length > 0 && (
                          <li>
                            <strong className="text-fg">{n(plan.cannotMark)} can't be marked</strong> —{' '}
                            {cannotMarkLines(plan).join(', ')}. They are never sent.
                          </li>
                        )}
                        <li>One action takes at most {n(SELECTION_CAP)} doors.</li>
                      </ul>
                    </InfoHint>
                  </div>
                  {scopeNote && <p className="mt-0.5 text-xs text-fg-subtle">{scopeNote}</p>}
                </div>
                <IconButton
                  label={onClose ? 'Leave select mode' : 'Clear selection'}
                  onClick={onClose || onClear}
                  className="-mr-1 -mt-1 shrink-0"
                >
                  <IconX />
                </IconButton>
              </div>

              {overCap && (
                <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-warning-tint px-2.5 py-1.5 text-xs text-warning-fg">
                  <span>
                    That would put {n(overCap.wouldBe)} doors in the selection — more than the {n(SELECTION_CAP)}{' '}
                    one action can take, so nothing was added. Zoom in, lasso a smaller stretch, or clear the
                    selection first.
                  </span>
                  {onDismissOverCap && (
                    <button type="button" onClick={onDismissOverCap} className="font-semibold hover:opacity-70">
                      ✕
                    </button>
                  )}
                </div>
              )}
              {disabledReason && !overCap && <p className="mt-2 text-xs text-fg-subtle">{disabledReason}</p>}
              {error && <p className="mt-2 text-xs text-danger">{error.message}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={blocked || markCount === 0}
                  onClick={() => request('mark')}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy === 'mark' ? 'Working…' : 'Mark restricted…'}
                </button>
                {canUnmark && (
                  <button
                    type="button"
                    disabled={blocked || unmarkCount === 0}
                    onClick={() => request('unmark')}
                    className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-sunken disabled:opacity-50"
                  >
                    {busy === 'unmark' ? 'Working…' : 'Unmark restricted…'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClear}
                  disabled={!!busy}
                  className="ml-auto rounded border border-transparent px-2 py-1.5 text-xs font-medium text-brand-accent hover:underline disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {pending && !inline && (
        <RestrictDoorsModal
          mode={pending.mode}
          plan={pending.plan}
          passLabel={passLabel}
          scopeNote={scopeNote}
          pending={!!busy}
          error={error}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

// The > 25-door confirm. Same shell and grammar as TurfsPage's whole-book RestrictModal — the
// typed-`restrict` gate on a mark, the scope choice whenever the selection holds doors the crew
// already reached — over a FROZEN plan, so a poll landing mid-type can't move the number the
// button promises.
export function RestrictDoorsModal({ mode, plan, passLabel, scopeNote, pending, error, onCancel, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const [scopeChoice, setScopeChoice] = useState(null); // null until the admin picks one
  const marking = mode === 'mark';

  // DERIVED, never seeded into useState: a plan that grows between renders (the bar re-opens the
  // modal against a bigger selection) would otherwise keep the very first render's default forever.
  const reached = plan.reached || 0;
  const showScope = marking && reached > 0;
  const scope = scopeChoice || (reached > 0 ? 'unknocked' : 'incomplete');
  const chosenCount = scope === 'unknocked' ? plan.unknocked || 0 : plan.markable || 0;
  const actionCount = marking ? chosenCount : plan.unmarkIds.length;
  const typedOk = !marking || confirmText.trim().toLowerCase() === 'restrict';

  // Esc closes the confirm and nothing else. Capture phase + stopPropagation because both pages
  // also listen for Esc to leave select mode — which would otherwise throw the selection away
  // from under an open, half-typed gate.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-fg">
          {marking
            ? `Mark ${n(plan.markable)} ${s(plan.markable, 'door')} restricted?`
            : `Remove desk marks on ${n(plan.unmarkIds.length)} ${s(plan.unmarkIds.length, 'door')}?`}
        </h3>
        {marking ? (
          <>
            {showScope ? (
              <>
                <p className="mt-2 text-sm text-fg-muted">
                  Your crew already reached {n(reached)} of the doors you picked
                  {passLabel ? ` in ${passLabel}` : ''}. Choose which doors to mark{' '}
                  <strong>Restricted Access</strong> — canvassers see them slate, they stay out of every rate and
                  knock count, and the next cut can exclude them.
                </p>
                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-strong p-2.5 hover:bg-sunken">
                    <input
                      type="radio"
                      name="door-restrict-scope"
                      checked={scope === 'unknocked'}
                      onChange={() => setScopeChoice('unknocked')}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-fg">Only unknocked doors ({n(plan.unknocked)})</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        Leaves the {n(reached)} {s(reached, 'door')} your crew reached (not-home, refused) exactly
                        as they are.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-strong p-2.5 hover:bg-sunken">
                    <input
                      type="radio"
                      name="door-restrict-scope"
                      checked={scope === 'incomplete'}
                      onChange={() => setScopeChoice('incomplete')}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-fg">Every door not yet done ({n(plan.markable)})</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        Also marks the {n(reached)} reached-but-unfinished {s(reached, 'door')}.
                      </span>
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                {n(plan.markable)} of the {n(plan.total)} {s(plan.total, 'door')} you picked
                {passLabel ? ` get a Restricted Access mark in ${passLabel}` : ' get a Restricted Access mark'} —
                canvassers see them slate, they stay out of every rate and knock count, and the next cut can
                exclude them.
              </p>
            )}
            <p className="mt-2 text-xs text-fg-subtle">
              Doors already <strong>completed</strong> keep their result; doors already restricted are skipped.
              {plan.cannotMark > 0 && (
                <>
                  {' '}
                  {n(plan.cannotMark)} selected {s(plan.cannotMark, 'door')} can't be marked (
                  {cannotMarkLines(plan).join(', ')}) and {s(plan.cannotMark, 'is', 'are')} not sent.
                </>
              )}{' '}
              Reversible via <strong>Unmark restricted</strong>, and a canvasser can re-disposition any door in the
              field.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">
            Removes every <strong>desk</strong> mark on the {n(plan.unmarkIds.length)} selected{' '}
            {s(plan.unmarkIds.length, 'door')}
            {passLabel ? ` in ${passLabel}` : ''} — including marks made before today, by anyone. Restricted marks
            canvassers recorded at the door are kept.
          </p>
        )}
        {scopeNote && <p className="mt-2 text-xs text-fg-subtle">{scopeNote}</p>}
        {marking && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-fg-muted">
              Type <strong>restrict</strong> to confirm
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="restrict"
              autoFocus
              className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-danger focus:outline-none"
            />
          </label>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-fg-muted hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(scope)}
            disabled={pending || !typedOk || actionCount === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending
              ? 'Working…'
              : marking
              ? `Restrict ${n(chosenCount)} ${s(chosenCount, 'door')}`
              : `Unmark ${n(plan.unmarkIds.length)} ${s(plan.unmarkIds.length, 'door')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
