import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button, Modal, FIELD_CLS } from './ui/index.js';
import {
  afterFailedDelete,
  confirmMatches,
  deleteAccountMutationKey,
  fullName,
  goneOutcome,
  reloadNote,
  reviewLines,
  roleLabel,
} from '../lib/memberDeletion.js';

const DANGER_BOX = 'rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-danger-fg';
const WARN_BOX = 'rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-warning-fg';
const BUTTONS = 'flex flex-wrap gap-2 pt-1';

// Profile → Account → More options → Delete account… (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md, Part 1
// "What you'll see", and §D). Two confirmations, so it is hard to do by accident: a review worked
// out from the person's own records, then their email typed back. The server decides everything; a
// blocked review lists the server's reasons, each naming its remedy, and offers only Close.
//
// `statsQuery` is the profile's stats query (its options), refetched by the profile as this opens;
// this dialog observes it itself. `flowRef` is the profile's deleteFlowRef: set while this dialog is
// mounted, so the profile's Escape leaves it alone. While the DELETE is in flight nothing closes (no
// close button, scrim or Escape; Back disabled): its answer has to land here. `onDeleted` and `onGone`
// close everything with the matching notice.
const DeleteMemberDialog = ({ membership, statsQuery, flowRef, onClose, onDeleted, onGone }) => {
  const user = membership.user;
  const name = fullName(user);
  const [step, setStep] = useState(1);
  const [typed, setTyped] = useState('');
  // What was confirmed at Continue. The DELETE carries this kind, so the server can answer
  // USAGE_CHANGED if it no longer holds, and step 2 asks for this email.
  const [reviewed, setReviewed] = useState(null);
  // Why step 1 is showing again (reloadNote's lines), after a refusal or an answer that never came.
  const [note, setNote] = useState(null);
  // The DELETE in flight, known at once. react-query reports "pending" a render later, and a second
  // submit or a close can land in between (two clicks a frame apart, Enter then Escape): the ref is
  // what they check, the state is what the screen shows.
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  // Set when step 1 comes back (Back, or a reload): focus then goes to the review, not the page.
  const cameBackRef = useRef(false);
  // onDeleted / onGone run once, whichever answer gets there first.
  const doneRef = useRef(false);
  const inputRef = useRef(null);
  const reviewRef = useRef(null);

  useEffect(() => {
    flowRef.current = true;
    return () => {
      flowRef.current = false;
    };
  }, [flowRef]);

  // This dialog's own observer, never the profile's result passed down: react-query re-renders a
  // component only for the result fields it has read, so a refetch that landed with identical
  // numbers before the check did never re-rendered the profile, and a passed-down result kept saying
  // "fetching" — Continue stayed grey for good. Every render of this dialog reads the query as it is
  // now, and the flags are read up front so their changes re-render it too.
  const statsQ = useQuery(statsQuery);
  const statsFetching = statsQ.isFetching;
  const statsError = statsQ.isError;

  // gcTime 0: every open starts from a fresh check, never the answer cached by the last one.
  const checkQ = useQuery({
    queryKey: ['admin', 'membership-deletion-check', user.id],
    queryFn: ({ signal }) => api(`/admin/memberships/${user.id}/deletion-check`, { signal }),
    retry: false,
    gcTime: 0,
  });

  const finish = (outcome) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (outcome === 'gone') onGone();
    else onDeleted();
  };

  // The check itself can find the account gone: deleted (by a delete whose answer was lost, or by
  // another admin first), or its membership here removed (an unused account's delete takes the row).
  const gone = goneOutcome(checkQ.error);
  useEffect(() => {
    if (gone) finish(gone);
  }, [gone]);

  // The review again, read afresh, with why on top.
  const reloadReview = (why) => {
    cameBackRef.current = true;
    setNote(why);
    setTyped('');
    setStep(1);
    checkQ.refetch();
    statsQ.refetch();
  };

  const del = useMutation({
    mutationKey: deleteAccountMutationKey(user.id),
    mutationFn: (body) => api(`/admin/memberships/${user.id}/account`, { method: 'DELETE', body }),
    onSuccess: () => finish('deleted'),
    onError: (err) => {
      const next = afterFailedDelete(err);
      // Gone already: an earlier try landed and its answer was lost, or another admin got there first.
      if (next === 'deleted' || next === 'gone') return finish(next);
      // They signed in or recorded something since the review (USAGE_CHANGED), something now stands
      // in the way (BLOCKED, e.g. a membership elsewhere), or no answer came at all and the delete may
      // have landed: the review again, re-read, with why on top. A blocked review lists the reasons
      // with only Close, the same as the phone.
      if (next === 'review' || next === 'unconfirmed') reloadReview(reloadNote(err));
      // 'refused': stays on this step, in the server's words.
    },
    onSettled: () => {
      deletingRef.current = false;
      setDeleting(false);
    },
  });
  const busy = deleting || del.isPending;

  // Step 2 opens empty, with the cursor in the box. Coming back to step 1 puts focus on the review,
  // inside the dialog, rather than losing it to the page when step 2's controls go away.
  useEffect(() => {
    if (step === 2) inputRef.current?.focus();
    else if (cameBackRef.current) {
      cameBackRef.current = false;
      reviewRef.current?.focus();
    }
  }, [step]);

  const check = checkQ.data;
  const stats = statsQ.data;
  const email = check?.confirmEmail || user.email;
  const settled = !checkQ.isFetching && !statsFetching && !checkQ.isError && !statsError;
  const blocked = !!check && !checkQ.isFetching && !checkQ.isError && !check.canDelete;
  const lines = settled && check?.canDelete && stats ? reviewLines({ user, check, stats }) : null;
  const matches = confirmMatches(typed, reviewed?.email);

  // Nothing closes while the DELETE is out, even a close that beats the pending render.
  const close = () => {
    if (deletingRef.current) return;
    onClose();
  };

  const toConfirm = () => {
    setReviewed({ kind: check.kind, email: check.confirmEmail });
    setTyped('');
    setNote(null);
    del.reset();
    setStep(2);
  };

  const toReview = () => {
    cameBackRef.current = true;
    setTyped('');
    del.reset();
    setStep(1);
  };

  // Enter does nothing until the email matches (the submit button is disabled until then too), and
  // nothing while a DELETE is already out.
  const onSubmit = (e) => {
    e.preventDefault();
    if (!matches || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    del.mutate({ confirmEmail: typed.trim(), expectKind: reviewed.kind });
  };

  const closeOnly = (
    <div className={BUTTONS}>
      <Button variant="secondary" onClick={close}>
        Close
      </Button>
    </div>
  );

  return (
    <Modal
      size="lg"
      closable={!busy}
      onClose={close}
      title={step === 2 ? `Delete ${name}'s account permanently?` : `Delete ${name}'s account?`}
      subtitle={step === 2 ? "This can't be undone." : `${roleLabel(membership.role)} · ${email}`}
    >
      {step === 2 ? (
        <form onSubmit={onSubmit} className="space-y-3 text-sm">
          <div>
            <label htmlFor="delete-member-confirm" className="block text-fg">
              Type <span className="font-mono font-semibold">{reviewed?.email}</span> to confirm
            </label>
            <input
              id="delete-member-confirm"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              readOnly={busy}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className={`${FIELD_CLS} mt-1 w-full font-mono`}
            />
          </div>
          {!busy && del.isError && (
            <div role="alert" className={DANGER_BOX}>
              {del.error.message}
            </div>
          )}
          <div className={BUTTONS}>
            <Button type="submit" variant="danger" disabled={!matches} loading={busy}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button variant="secondary" onClick={toReview} disabled={busy}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        // One wrapper for every state of step 1, so focus placed on it survives the review
        // reloading into a blocked one or an error.
        <div ref={reviewRef} tabIndex={-1} className="space-y-3 text-sm outline-none">
          {note?.length > 0 && (
            <div role="alert" className={`${WARN_BOX} space-y-1`}>
              {note.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
          )}
          {checkQ.isError && !gone ? (
            <>
              <div role="alert" className={DANGER_BOX}>
                {checkQ.error.message}
              </div>
              {closeOnly}
            </>
          ) : blocked ? (
            <>
              <div className={DANGER_BOX}>
                <p className="font-semibold">This account can&apos;t be deleted:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {(check.blockers || []).map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </div>
              {closeOnly}
            </>
          ) : (
            <>
              {statsError ? (
                <div role="alert" className={DANGER_BOX}>
                  Could not load their activity: {statsQ.error.message}
                </div>
              ) : !lines ? (
                <p className="text-fg-muted">Checking what deleting would change…</p>
              ) : (
                <>
                  {lines.callout.length > 0 && (
                    <div className={`${WARN_BOX} space-y-1.5`}>
                      {lines.callout.map((t, i) => (
                        <p key={i}>{t}</p>
                      ))}
                    </div>
                  )}
                  {lines.intro && <p className="text-fg">{lines.intro}</p>}
                  <ul className="list-disc space-y-1.5 pl-5 text-fg">
                    {lines.bullets.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  {lines.removeHint && <p className="text-fg-muted">Usually you want Remove from org instead.</p>}
                </>
              )}
              <div className={BUTTONS}>
                <Button variant="danger" onClick={toConfirm} disabled={!lines}>
                  Continue
                </Button>
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default DeleteMemberDialog;
