import { Badge, Button, Modal } from '../ui/index.js';

// Small pieces the Client Reports pages share: the error banner every action reports into (§G3),
// a confirm dialog on the shared Modal, and the build-state line a row and the builder show (§G1).

// Codes the server explains in a sentence of its own are shown as sent; these get plainer words or
// the next step the operator can take.
const CODE_TEXT = {
  REPORT_BUSY: null, // the server's sentence names the state (queued, waiting, running)
  REVIEW_PENDING: 'New numbers are waiting for your review — apply or discard them first.',
  SNAPSHOT_CHANGED: 'Your numbers were just rebuilt — look at the preview, then publish.',
  SAVING: 'Your latest changes are still saving — publish again in a moment.',
  ALREADY_PUBLISHED: 'This report is already published. Use Edit or Refresh numbers to change it.',
  NEEDS_REFRESH: 'That adds to what this published report shows. Add it with Refresh numbers.',
  HISTORY_ERASED: 'This text was erased, so it can’t be restored.',
  NOT_LATEST_REPORT: 'A later report of this series already exists — open it instead.',
  STATUS_CHANGED: 'This report was just published or changed — reload it.',
  // Contract C6: the server's own sentence says the goal came after the numbers and what rebuilds them.
  GOAL_AFTER_BUILD: null,
};

// Refusals that mean the report moved under the page (ADMINUX-3). The builder re-reads the report for
// these (and for a 404) and marks the error `reread`; the words then say what the page now shows,
// instead of a "try again" or "reload" that could never help. Unmarked (a page that doesn't re-read),
// the plainer CODE_TEXT words stand.
export const REREAD_CODES = new Set([
  'SAVING',
  'SNAPSHOT_CHANGED',
  'ALREADY_PUBLISHED',
  'STATUS_CHANGED',
  // Contract C8: the server's own sentence says this page now shows the latest version.
  'CHANGED_ELSEWHERE',
  'NOTHING_TO_APPLY',
  'NOTHING_TO_DISCARD',
  'NOTHING_TO_CANCEL',
  'REVIEW_PENDING',
  'REPORT_BUSY',
  'NOT_PUBLISHED',
]);
const REREAD_TEXT = {
  SAVING: 'This report changed since the preview — it now shows the latest version. Look it over, then publish.',
  SNAPSHOT_CHANGED: 'Your numbers were just rebuilt — the preview now shows them. Look it over, then publish.',
  ALREADY_PUBLISHED: 'This report was already published somewhere else, so nothing changed here. It now shows as published.',
  STATUS_CHANGED: 'This report was just published or changed somewhere else — this page now shows it as it stands.',
  NOTHING_TO_APPLY: 'These new numbers were already applied or discarded somewhere else — this page now shows where things stand.',
  NOTHING_TO_DISCARD: 'These new numbers were already applied or discarded somewhere else — this page now shows where things stand.',
  NOTHING_TO_CANCEL: 'That build had already finished or been cancelled — this page now shows where it stands.',
};

/** The words for a failed request: the code's sentence, else the server's message. */
export const errorText = (err) => {
  if (!err) return '';
  if (err.reread && err.code && REREAD_TEXT[err.code]) return REREAD_TEXT[err.code];
  if (err.code && CODE_TEXT[err.code]) return CODE_TEXT[err.code];
  if (err.status === 413) return 'That file is too large.';
  return err.message || 'Something went wrong — try again.';
};

/** The banner under a page's header. `title` says which action failed. */
export const ErrorBanner = ({ error, title, onDismiss, children }) => {
  if (!error && !children) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 rounded-md border border-danger/30 bg-danger-tint px-4 py-2.5 text-sm text-danger-fg">
      <div className="min-w-0">
        {title && <span className="font-semibold">{title} </span>}
        {error ? errorText(error) : null}
        {children}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:opacity-80">
          Dismiss
        </button>
      )}
    </div>
  );
};

/** A one-question dialog: the body says what happens, the buttons do it or don't. */
export const ConfirmDialog = ({ title, children, confirmLabel = 'Confirm', danger = false, busy = false, error = null, onConfirm, onClose, size = 'md' }) => (
  <Modal
    size={size}
    title={title}
    onClose={busy ? undefined : onClose}
    closable={!busy}
    footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    <div className="space-y-3 text-sm text-fg-muted">{children}</div>
    {error && (
      <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">
        {errorText(error)}
      </div>
    )}
  </Modal>
);

/** A thin progress bar (brand fill on a sunken track). */
export const ProgressBar = ({ value, label = 'Progress' }) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={value ?? undefined}
    className="h-1.5 w-full min-w-[6rem] overflow-hidden rounded-full bg-sunken"
  >
    <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${value ?? 0}%` }} />
  </div>
);

/**
 * A build's state (buildStateOf) with the buttons it offers. `compact` is the row form: the badge,
 * the reason a failed or waiting build gives, and small buttons; the full form adds the detail line
 * and a progress bar.
 */
export const BuildStatus = ({ state, onCancel, onRetry, onReview, busy = null, compact = false }) => {
  if (!state || state.teamChanged) return null;
  const showReason = state.status === 'failed' || state.status === 'waiting' || state.status === 'stalled';
  return (
    <div
      role="status"
      aria-live="polite"
      className={compact ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : 'rounded-md border border-border bg-sunken/60 px-3 py-2.5'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={state.tone} dot>
          {state.label}
        </Badge>
        {compact && showReason && <span className="text-xs text-fg-muted">{state.detail}</span>}
        {!compact && state.detail && <span className="text-xs text-fg-muted">{state.detail}</span>}
        {state.canCancel && onCancel && (
          <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {state.canRetry && onRetry && (
          <Button size="sm" variant="secondary" loading={busy === 'retry'} onClick={onRetry}>
            Retry
          </Button>
        )}
        {state.canReview && onReview && (
          <Button size="sm" onClick={onReview}>
            Review
          </Button>
        )}
      </div>
      {!compact && state.progress != null && (
        <div className="mt-2">
          <ProgressBar value={state.progress} label={state.label} />
        </div>
      )}
    </div>
  );
};

/** A small uppercase section heading, the builder's left-column grammar. */
export const SectionTitle = ({ children, right = null }) => (
  <div className="mb-2 flex items-center justify-between gap-2">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h2>
    {right}
  </div>
);
