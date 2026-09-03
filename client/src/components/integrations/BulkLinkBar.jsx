import { useState } from 'react';
import { Button, Modal } from '../ui/index.js';

// Above 25 the consequence deserves a real dialog rather than a line in a bar.
const CONFIRM_OVER = 25;

/**
 * The multi-select action bar.
 *
 * `fixed`, never sticky inside the table: DataTable's wrapper is overflow-x-auto,
 * so a sticky child would slide sideways with the horizontal scroll.
 *
 * Every row gets a checkbox, including ones nothing can be done to — disabled
 * checkboxes force the reader to reverse-engineer an eligibility rule. The bar
 * does that arithmetic instead and says so.
 */
export default function BulkLinkBar({ selected, linkable, unlinkable, busy, progress, onLink, onUnlink, onClear }) {
  const [confirming, setConfirming] = useState(false);
  if (!selected.length) return null;

  const inert = selected.length - linkable.length - unlinkable.length;
  const bigUnlink = unlinkable.length > CONFIRM_OVER;

  const consequence = `Their hours stop counting immediately — reports go back to estimated for ${
    unlinkable.length === 1 ? 'them' : 'those people'
  }.`;

  const doUnlink = () => {
    setConfirming(false);
    onUnlink(unlinkable);
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-4">
        <div className="pointer-events-auto w-full max-w-2xl rounded-card border border-border bg-raised p-3 shadow-popover">
          {confirming && !bigUnlink ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 text-sm text-fg">
                Unlink {unlinkable.length}? {consequence}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={doUnlink}>
                Unlink {unlinkable.length}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-fg">
                {busy
                  ? `Working… ${progress?.done || 0} of ${progress?.total || selected.length}`
                  : `${selected.length} selected`}
              </span>
              {!busy && inert > 0 && (
                <span className="text-xs text-fg-muted">
                  {inert} of these can’t be linked or unlinked
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {linkable.length > 0 && (
                  <Button size="sm" disabled={busy} onClick={() => onLink(linkable)}>
                    Link {linkable.length} suggested
                  </Button>
                )}
                {unlinkable.length > 0 && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming(true)}
                  >
                    Unlink {unlinkable.length}
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirming && bigUnlink && (
        <Modal
          size="md"
          title={`Unlink ${unlinkable.length} people?`}
          onClose={() => setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={doUnlink}>
                Unlink {unlinkable.length}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-fg">{consequence}</p>
          <p className="mt-2 text-sm text-fg-muted">
            You can link them again at any time — nothing is deleted, and their hours reattach as
            soon as they are.
          </p>
        </Modal>
      )}
    </>
  );
}
