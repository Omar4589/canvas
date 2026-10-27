import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui/index.js';
import { RunProgress, RunSummary } from './RunReport.jsx';
import { useChunkRun } from '../../lib/useChunkRun.js';
import { runInChunks } from '../../lib/runInChunks.js';
import { crewsDisbanded, disbandLine } from '../../lib/teamSelection.js';

// Resend invites and Remove from campaign on the Team page (docs/PROPOSAL_PEOPLE_PAGES.md §E.4): one
// confirm naming exactly how many it reaches, then the run (lib/runInChunks.js) — invites one at a
// time, removals three at a time. One person's refusal (an invite sent in the last minute, say) is
// listed and the run carries on; Retry failed tries just those people again.
//
// `people` are the roster rows it reaches, as they were when this opened.

const KIND = {
  resend: {
    title: 'Resend invites',
    size: 1,
    concurrency: 1,
    verb: 'Sending',
    confirm: (n) => `Send ${n.toLocaleString()} invite ${n === 1 ? 'email' : 'emails'}`,
    done: (n) => `${n.toLocaleString()} ${n === 1 ? 'invite' : 'invites'} sent.`,
  },
  remove: {
    title: 'Remove from campaign',
    size: 1,
    concurrency: 3,
    verb: 'Removing',
    confirm: (n) => `Remove ${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`,
    done: (n) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'} removed. Their work stays counted.`,
  },
};

const BulkConfirmDialog = ({ kind, campaignId, campaignName, people, roster, onClose, onRan }) => {
  const qc = useQueryClient();
  const k = KIND[kind];
  const [stopping, setStopping] = useState(false);
  const runner = useChunkRun({
    onFinally: () => {
      if (kind === 'remove') {
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
        qc.invalidateQueries({ queryKey: ['memberships'] });
        qc.invalidateQueries({ queryKey: ['turf-assignments'] });
        qc.invalidateQueries({ queryKey: ['turfs'] });
        qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
        qc.invalidateQueries({ queryKey: ['admin', 'member-crews'] });
      }
      onRan?.();
    },
  });
  const byId = new Map(people.map((p) => [String(p.userId), p]));
  const nameOf = (id) => {
    const p = byId.get(String(id));
    return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || 'Someone' : 'Someone';
  };

  const one = (fetchSignal) => async ([id]) => {
    if (kind === 'resend') {
      const res = await api(`/admin/memberships/${id}/resend-invite`, { method: 'POST', signal: fetchSignal });
      return [res?.sent ? { id, outcome: 'done' } : { id, outcome: 'failed', reason: 'The email didn’t go out — check the email settings.' }];
    }
    await api(`/admin/campaigns/${campaignId}/assignments/${id}`, { method: 'DELETE', signal: fetchSignal });
    return [{ id, outcome: 'done' }];
  };
  const go = (ids) => {
    setStopping(false);
    runner.run(ids, ({ signal, fetchSignal, onProgress }) =>
      runInChunks(ids, { size: k.size, concurrency: k.concurrency, signal, onProgress }, one(fetchSignal))
    );
  };

  const ids = people.map((p) => String(p.userId));
  const disbands = kind === 'remove' ? crewsDisbanded(people, roster) : [];
  const summary = runner.summary;
  const footer = runner.running ? null : summary ? (
    <Button onClick={onClose}>Done</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant={kind === 'remove' ? 'danger' : 'primary'} onClick={() => go(ids)} disabled={!ids.length}>
        {k.confirm(ids.length)}
      </Button>
    </>
  );

  return (
    <Modal size="lg" title={k.title} onClose={onClose} closable={!runner.running} footer={footer}>
      {runner.running ? (
        <RunProgress
          progress={runner.progress}
          verb={k.verb}
          stopping={stopping}
          onStop={() => {
            setStopping(true);
            runner.stop();
          }}
        />
      ) : summary ? (
        <RunSummary
          summary={summary}
          nameOf={nameOf}
          doneLine={k.done}
          onRetry={() => go(summary.failed.map((f) => f.id))}
          onContinue={() => go(summary.notStarted)}
        />
      ) : kind === 'resend' ? (
        <div className="space-y-2 text-sm text-fg">
          <p>
            This emails a new set-password link to the {ids.length.toLocaleString()} selected{' '}
            {ids.length === 1 ? 'person who has' : 'people who have'} never signed in.
          </p>
          <p className="text-fg-muted">Each new link replaces any earlier invite or reset link for that person.</p>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-fg">
          <p>
            Remove {ids.length.toLocaleString()} {ids.length === 1 ? 'person' : 'people'} from <strong>{campaignName}</strong>?
          </p>
          <p className="text-fg-muted">
            Any books they hold here go back to the pool, so you can hand them to someone else. Books shared with other
            canvassers stay with them. Their other campaigns aren’t affected.
          </p>
          <p className="text-fg-muted">
            <strong className="font-medium text-fg">Their work is kept.</strong> Every door they knocked still counts toward
            this campaign’s totals.
          </p>
          {disbands.map((d) => (
            <p key={d.userId}>{disbandLine(d)}</p>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default BulkConfirmDialog;
