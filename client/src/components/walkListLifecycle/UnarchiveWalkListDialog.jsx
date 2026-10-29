import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useOrgTimeZone } from '../../auth/AuthContext.jsx';
import { useCampaignSelection } from '../CampaignSelector.jsx';
import { formatInTz } from '../../lib/datetime.js';
import { Button, Modal } from '../ui';
import { isTemporaryError, unarchiveCopy } from './lifecycleCopy.js';
import { invalidateLifecycle, refreshAfterRefusal } from './invalidateLifecycle.js';
import RefusalBox, { DANGER_BOX, NOTE_BOX, WARN_BOX } from './RefusalBox.jsx';

// Unarchive a walk list (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.3, Part 1 "Unarchiving"). It asks
// about the pass that archiving ended, every time (owner ruling 1):
//   - it can come back → [Unarchive only] [Unarchive and bring Pass 3 back];
//   - it can't → the reason, and a single [Unarchive];
//   - someone is changing the walk list right now → "Try again in a minute", and nothing to press.
// A 200 that unarchived the walk list but couldn't bring the pass back (bringBackError) stays on
// screen as a warning; closing it then reports onDone(result).
//
// effort: { _id, name }. onDone(result) gets the server's { effort, broughtBack, to, bringBackError? }
// plus endedPass ({ _id, roundNumber, name } or null).
const UnarchiveWalkListDialog = ({ campaignId, effort, onClose, onDone }) => {
  const qc = useQueryClient();
  const { selected } = useCampaignSelection(campaignId);
  const orgTz = useOrgTimeZone();
  const tz = selected?.timeZone || orgTz;
  const [warned, setWarned] = useState(null); // the 200 whose pass couldn't come back
  const base = `/admin/campaigns/${campaignId}/efforts/${effort._id}`;

  const previewQ = useQuery({
    queryKey: ['admin', 'walk-list-lifecycle', campaignId, String(effort._id), 'unarchive-preview'],
    queryFn: ({ signal }) => api(`${base}/unarchive-preview`, { signal }),
    enabled: !!campaignId,
    gcTime: 0,
    retry: false,
  });
  const endedPass = previewQ.data?.endedPass || null;
  const copy = unarchiveCopy({
    name: effort.name,
    endedPass,
    formatDate: (iso) => formatInTz(iso, tz, { month: 'short', day: 'numeric' }, false),
  });

  const unarchive = useMutation({
    mutationFn: (bringBack) => api(`${base}/unarchive`, { method: 'POST', body: { bringBack } }),
    onSuccess: (res) => {
      invalidateLifecycle(qc, campaignId);
      const result = {
        ...res,
        endedPass: endedPass ? { _id: endedPass._id, roundNumber: endedPass.roundNumber, name: endedPass.name } : null,
      };
      if (res?.bringBackError) setWarned(result);
      else onDone?.(result);
    },
    onError: (err) => {
      refreshAfterRefusal(qc, campaignId, err);
      // A permanent refusal means the preview is out of date (say a newer pass went live meanwhile):
      // re-ask, so the box offers what can still be done. A temporary one changes nothing.
      if (err?.status === 409 && !isTemporaryError(err)) previewQ.refetch();
    },
  });
  const pending = unarchive.isPending;
  const bringingBack = pending && unarchive.variables === true;

  if (warned) {
    const done = () => onDone?.(warned);
    return (
      <Modal
        size="md"
        onClose={done}
        title={`${effort.name} is unarchived`}
        footer={
          <Button variant="secondary" size="sm" onClick={done}>
            Close
          </Button>
        }
      >
        <div role="alert" className={WARN_BOX}>
          {warned.bringBackError.error}
        </div>
      </Modal>
    );
  }

  const ready = previewQ.isSuccess;
  let footer;
  if (!ready || copy.temporary) {
    footer = (
      <Button variant="secondary" size="sm" onClick={onClose}>
        Close
      </Button>
    );
  } else if (copy.choice) {
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={() => unarchive.mutate(false)} disabled={pending} loading={pending && !bringingBack}>
          Unarchive only
        </Button>
        <Button size="sm" onClick={() => unarchive.mutate(true)} disabled={pending} loading={bringingBack}>
          {copy.bringBackButton}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => unarchive.mutate(false)} loading={pending}>
          Unarchive
        </Button>
      </>
    );
  }

  return (
    <Modal size="md" onClose={onClose} closable={!pending} title={copy.title} footer={footer}>
      {previewQ.isError ? (
        <div role="alert" className={DANGER_BOX}>
          {previewQ.error.message}
        </div>
      ) : !ready ? (
        <p className="text-sm text-fg-muted">Checking what archiving {effort.name} ended…</p>
      ) : (
        <div className="space-y-3 text-sm text-fg-muted">
          <p className="text-fg">{copy.intro}</p>
          {copy.ended && (
            <p>
              {copy.ended}
              {copy.bringBack ? ` ${copy.bringBack}` : ''}
            </p>
          )}
          {copy.refusal && <div className={copy.temporary ? WARN_BOX : NOTE_BOX}>{copy.refusal}</div>}
          {/* After a refusal the preview is re-asked and its copy carries the reason — never say it twice. */}
          {!copy.refusal && <RefusalBox error={unarchive.error} />}
        </div>
      )}
    </Modal>
  );
};

export default UnarchiveWalkListDialog;
