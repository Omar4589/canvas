import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui';
import { bringBackPassCopy } from './lifecycleCopy.js';
import { invalidateLifecycle, refreshAfterRefusal } from './invalidateLifecycle.js';
import RefusalBox, { NOTE_BOX, WARN_BOX } from './RefusalBox.jsx';

// Bring an archived pass back (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.5, Part 1 "Archiving a pass, and
// bringing it back"). The box says what happens before anything changes, from the facts GET /passes
// already sent with the row (bringBack: to, books, canvassers, downgraded): back live to the same
// canvassers, or back as a draft — including a pass whose books have no doors left. The server
// re-checks every rule; a refusal shows its sentence and the page refetches.
//
// pass: the GET /passes row. onDone(result) gets { pass, to, downgraded }.
const BringBackPassDialog = ({ campaignId, pass, effortName, onClose, onDone }) => {
  const qc = useQueryClient();
  const copy = bringBackPassCopy(pass);
  const bring = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/passes/${pass._id}/bring-back`, { method: 'POST', body: {} }),
    onSuccess: (res) => {
      invalidateLifecycle(qc, campaignId);
      onDone?.(res);
    },
    onError: (err) => refreshAfterRefusal(qc, campaignId, err),
  });

  return (
    <Modal
      size="md"
      onClose={onClose}
      closable={!bring.isPending}
      title={copy.title}
      subtitle={effortName ? `Walk list: ${effortName}` : undefined}
      footer={
        copy.ok ? (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={bring.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => bring.mutate()} loading={bring.isPending}>
              {copy.button}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm text-fg-muted">
        {copy.ok ? <p className="text-fg">{copy.body}</p> : <p className={copy.temporary ? WARN_BOX : NOTE_BOX}>{copy.body}</p>}
        {/* After a refusal the row is refetched and its copy carries the reason — never say it twice
            (the Unarchive box's rule). */}
        {copy.ok && <RefusalBox error={bring.error} />}
      </div>
    </Modal>
  );
};

export default BringBackPassDialog;
