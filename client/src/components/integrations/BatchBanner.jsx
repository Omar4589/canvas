import { Button, IconCheck } from '../ui/index.js';

/**
 * What a link/unlink batch did, with Undo for an unlink.
 *
 * `batch.undo` holds the links as they were BEFORE the writes (after the refetch there
 * is no way to tell which links were removed), minus the ones that can never be linked
 * again — a deleted account, a member who left — whose count is `undoSkipped`. Undo
 * re-links through POST /links, and re-linking the exact pair an unlink said was wrong
 * cancels that clear if the worker hasn't run it yet; `cleared` counts the undoable
 * unlinks that asked for one.
 */
const BatchBanner = ({ batch, onUndo, onDismiss }) => {
  const { ok, failed } = batch.results;
  const undoable = (batch.undo || []).filter((u) => ok.includes(u.key));

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-2.5 text-sm shadow-card">
      <IconCheck size={16} className="text-success-fg" />
      <span className="text-fg">
        {ok.length} updated
        {failed.length ? ` · ${failed.length} failed` : ''}
      </span>
      {failed.length > 0 && <span className="text-xs text-danger">{failed[0].message}</span>}
      {undoable.length > 0 && (
        <Button variant="secondary" size="sm" onClick={() => onUndo(undoable)}>
          Undo
        </Button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
      >
        Dismiss
      </button>
      {undoable.length > 0 && batch.cleared > 0 && (
        <p className="basis-full text-xs text-fg-muted">Undo cancels the clear if it hasn’t run yet.</p>
      )}
      {batch.undoSkipped > 0 && (
        <p className="basis-full text-xs text-fg-muted">
          Undo skips deleted accounts and members who left — they can’t be linked again.
        </p>
      )}
    </div>
  );
};

export default BatchBanner;
