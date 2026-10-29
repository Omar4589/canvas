import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Input, Modal } from '../ui';
import { archivePassCopy, isTemporaryError } from './lifecycleCopy.js';
import { invalidateLifecycle, refreshAfterRefusal } from './invalidateLifecycle.js';
import RefusalBox, { DANGER_BOX } from './RefusalBox.jsx';

// Archive one pass (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.4, §D.2). The words depend on the pass: a
// live one leaves canvassers' phones and can come back until a newer pass on its walk list goes live;
// a draft holding knocks (a discard that kept them, a restored snapshot) comes back as a draft. Typing
// `archive` is asked for once it has knocks, as before. Nothing here says "one-way" any more.
//
// pass: { _id, roundNumber, name, status, knockCount }. onDone(result) gets the server's { pass }.
const ArchivePassDialog = ({ campaignId, pass, effortName, onClose, onDone }) => {
  const qc = useQueryClient();
  const formId = useId();
  const [typed, setTyped] = useState('');
  // The words describe the pass as it was when the box opened: the refetch after a refusal (someone
  // archived it meanwhile) must not flip them to a draft's (code review round 2). Once the row has
  // changed, or the server refused for good, Archive stays off — the refusal below says why.
  const [opened] = useState(pass);
  const copy = archivePassCopy(opened);
  const changed = pass.status !== opened.status;
  const archive = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/passes/${pass._id}/archive`, { method: 'POST', body: { confirmArchive: true } }),
    onSuccess: (res) => {
      invalidateLifecycle(qc, campaignId);
      onDone?.(res);
    },
    onError: (err) => refreshAfterRefusal(qc, campaignId, err),
  });
  const refused = archive.error?.status === 409 && !isTemporaryError(archive.error);
  const ready = (!copy.confirmWord || typed.trim().toLowerCase() === copy.confirmWord) && !changed && !refused;
  const submit = (e) => {
    e.preventDefault();
    if (ready && !archive.isPending) archive.mutate();
  };

  return (
    <Modal
      size="md"
      onClose={onClose}
      closable={!archive.isPending}
      title={copy.title}
      subtitle={effortName ? `Walk list: ${effortName}` : undefined}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={archive.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" size="sm" disabled={!ready} loading={archive.isPending}>
            {copy.button}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-3 text-sm text-fg-muted">
        <p>{copy.body}</p>
        {copy.knocks && <div className={DANGER_BOX}>{copy.knocks}</div>}
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
    </Modal>
  );
};

export default ArchivePassDialog;
