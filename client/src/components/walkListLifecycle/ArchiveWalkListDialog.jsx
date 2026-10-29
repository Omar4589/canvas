import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Input, Modal } from '../ui';
import { archiveWalkListCopy } from './lifecycleCopy.js';
import { invalidateLifecycle, refreshAfterRefusal } from './invalidateLifecycle.js';
import RefusalBox, { DANGER_BOX, NOTE_BOX } from './RefusalBox.jsx';

// Archive a walk list (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.2, Part 1 "Archiving a walk list"). The
// box says what ends, from the server's preview, and asks for `archive` typed only when a pass is
// live. It always sends confirmArchive: the typed word, or the plain button when nothing is live, IS
// the confirm. On a walk list already archived with its pass still live (the amber row from before
// this change) the same call ends that pass, so the box reads "End Pass 3".
//
// effort: { _id, name, status? }. onDone(result) gets the server's { effort, endedPassId } plus
// endedPass ({ _id, roundNumber, name } or null) for the page's "North archived — Pass 3 ended" line.
const ArchiveWalkListDialog = ({ campaignId, effort, onClose, onDone }) => {
  const qc = useQueryClient();
  const formId = useId();
  const [typed, setTyped] = useState('');
  const base = `/admin/campaigns/${campaignId}/efforts/${effort._id}`;

  // Fresh every time the box opens (gcTime 0): it states what is live NOW.
  const previewQ = useQuery({
    queryKey: ['admin', 'walk-list-lifecycle', campaignId, String(effort._id), 'archive-preview'],
    queryFn: ({ signal }) => api(`${base}/archive-preview`, { signal }),
    enabled: !!campaignId,
    gcTime: 0,
    retry: false,
  });
  const preview = previewQ.data || null;
  // Names the drafts that stay drafts ("Pass 4 stays a draft") from the campaign's pass list — the
  // cache Turf Cutting and the pickers already hold — and counts them until it's there.
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId && !!preview?.drafts,
  });
  const draftPasses = passesQ.data
    ? passesQ.data.passes.filter((p) => p.status === 'draft' && String(p.effortId) === String(effort._id))
    : null;
  const copy = preview
    ? archiveWalkListCopy({ name: effort.name, preview, draftPasses, alreadyArchived: effort.status === 'archived' })
    : null;

  // The confirm flag goes only with the typed confirm: if a pass went live after this box opened with a
  // plain button, the server answers archive-confirm-required and the box reloads to ask for typing —
  // a live pass never ends without someone typing archive (owner ruling 4).
  const archive = useMutation({
    mutationFn: () => api(`${base}/archive`, { method: 'POST', body: { confirmArchive: !!copy?.confirmWord } }),
    onSuccess: (res) => {
      invalidateLifecycle(qc, campaignId);
      // The pass the server ended, as it names it: the preview can be a step behind — a pass that went
      // live after the box opened is the one ended, and the one Undo must bring back.
      const named = res?.endedPass || null;
      const endedPass = named ? { _id: named._id, roundNumber: named.roundNumber, name: named.name } : null;
      onDone?.({ ...res, endedPass });
    },
    onError: (err) => {
      refreshAfterRefusal(qc, campaignId, err);
      if (err?.data?.code === 'archive-confirm-required') previewQ.refetch();
    },
  });

  const ready = !!copy?.button && (!copy.confirmWord || typed.trim().toLowerCase() === copy.confirmWord);
  const submit = (e) => {
    e.preventDefault();
    if (ready && !archive.isPending) archive.mutate();
  };

  return (
    <Modal
      size="md"
      onClose={onClose}
      closable={!archive.isPending}
      title={copy?.title || `Archive "${effort.name}"?`}
      footer={
        copy?.button ? (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={archive.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" size="sm" disabled={!ready} loading={archive.isPending}>
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
      {previewQ.isError ? (
        <div role="alert" className={DANGER_BOX}>
          {previewQ.error.message}
        </div>
      ) : !copy ? (
        <p className="text-sm text-fg-muted">Checking what is live on {effort.name}…</p>
      ) : copy.nothingToDo ? (
        <p className={NOTE_BOX}>{copy.nothingToDo}</p>
      ) : (
        <form id={formId} onSubmit={submit} className="space-y-3 text-sm text-fg-muted">
          {copy.lead && (
            <div>
              <p className="font-medium text-fg">{copy.lead}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {copy.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {copy.drafts && <p>{copy.drafts}</p>}
          {copy.readOnly && <p>{copy.readOnly}</p>}
          <p>{copy.undo}</p>
          {copy.confirmWord && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">
                Type <strong>{copy.confirmWord}</strong> to confirm
              </span>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                readOnly={archive.isPending}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={copy.confirmWord}
              />
            </label>
          )}
          <RefusalBox error={archive.error} />
        </form>
      )}
    </Modal>
  );
};

export default ArchiveWalkListDialog;
