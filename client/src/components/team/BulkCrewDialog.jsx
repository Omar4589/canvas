import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui/index.js';
import CrewSelect from './CrewSelect.jsx';
import { RunProgress, RunSummary } from './RunReport.jsx';
import { useChunkRun } from '../../lib/useChunkRun.js';
import { teamLabelsLine, useAffectedTeams } from '../../lib/useAffectedTeams.js';
import { previewThenRun, runPreviewed } from '../../lib/runInChunks.js';
import {
  BULK_WRITE_SIZE,
  andList,
  bulkAffectedIds,
  bulkOutcome,
  bulkSourceTeams,
  bulkWriteBody,
  skipReason,
  teamName,
} from '../../lib/crewChange.js';

// Move to crew… on the Team page (docs/PROPOSAL_PEOPLE_PAGES.md §E.4, §B.3): pick a coordinator, see
// exactly how many doors move (one preview for the whole selection, so the total is deduplicated),
// which client-report teams that changes, and who runs a crew of their own — the same check one person
// gets — then the write, 10 people a request and one request at a time, each person with the `from`
// their preview showed. The run's rules are lib/runInChunks.js: Retry failed checks those people again
// first, and Continue picks up after a Stop. `ids` is the selection as it was when this opened.

const countBy = (people) => {
  const by = new Map();
  for (const p of people) by.set(p.skip, (by.get(p.skip) || 0) + 1);
  return [...by].map(([skip, n]) => `${skipReason(skip)} (${n.toLocaleString()})`).join(', ');
};

const BulkCrewDialog = ({ campaignId, ids, nameOf, coordinators, onClose, onRan }) => {
  const qc = useQueryClient();
  const runKey = useId();
  // The picked crew: an id, '' for No crew, or null before anything is picked.
  const [to, setTo] = useState(null);
  const toId = to || null;
  const toName = toId ? coordinators.find((c) => c.id === toId)?.name || 'Unknown' : null;
  const target = toName ? teamName(toName) : '“No team”';

  const previewFor = (userIds, signal) =>
    // intent 'move': someone taken off the campaign since the page loaded reads not-on-campaign and stays out
    // of the totals, as the write leaves them out.
    api(`/admin/campaigns/${campaignId}/crew/coordinator-bulk/preview`, { method: 'POST', body: { userIds, coordinatorId: toId, intent: 'move' }, signal });
  const previewQ = useQuery({
    queryKey: ['admin', 'crew-bulk-preview', campaignId, runKey, toId || 'none'],
    queryFn: ({ signal }) => previewFor(ids, signal),
    enabled: to !== null,
    retry: false,
    gcTime: 0,
  });
  const preview = previewQ.data;
  const affectedQ = useAffectedTeams(
    campaignId,
    preview ? bulkAffectedIds(preview, new Set(coordinators.map((c) => c.id))) : [],
    (preview?.totals?.doors || 0) > 0
  );

  const runner = useChunkRun({
    onFinally: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'coordinator-preview', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews'] });
      qc.invalidateQueries({ queryKey: ['reports', 'team-breakdown'] });
      qc.invalidateQueries({ queryKey: ['reports', 'canvasser-timeline'] });
      onRan?.();
    },
  });
  const [stopping, setStopping] = useState(false);

  const write = (fetchSignal) => async (people) => {
    const res = await api(`/admin/campaigns/${campaignId}/crew/coordinator-bulk`, {
      method: 'PATCH',
      body: bulkWriteBody(people, toId),
      signal: fetchSignal,
    });
    return (res?.results || []).map((r) => ({ id: String(r.userId), ...bulkOutcome(r) }));
  };
  const begin = () => {
    setStopping(false);
    runner.run(ids, ({ signal, fetchSignal, onProgress }) =>
      runPreviewed(preview, ids, { write: write(fetchSignal), size: BULK_WRITE_SIZE, concurrency: 1, signal, onProgress })
    );
  };
  // Retry failed and Continue check those people again first, so each write carries a fresh `from`.
  const again = (subset) => {
    setStopping(false);
    runner.run(subset, ({ signal, fetchSignal, onProgress }) =>
      previewThenRun(subset, {
        preview: (userIds) => previewFor(userIds, fetchSignal),
        write: write(fetchSignal),
        size: BULK_WRITE_SIZE,
        concurrency: 1,
        signal,
        onProgress,
      })
    );
  };

  const nameFor = (id) => preview?.people?.find((p) => String(p.userId) === String(id))?.name || nameOf(id);
  const summary = runner.summary;
  const people = preview?.people || [];
  const busyPeople = people.filter((p) => p.skip === 'busy');
  const leftAlone = people.filter((p) => p.skip && p.skip !== 'busy');
  const runsCrew = people.filter((p) => !p.skip && p.subjectRunsCrew);
  const unfinished = people.filter((p) => !p.skip && p.unfinished);
  const movers = preview?.totals?.people || 0;
  const doors = preview?.totals?.doors || 0;
  const sources = preview ? bulkSourceTeams(preview) : [];
  const reportsLine = doors > 0 ? teamLabelsLine(affectedQ) : null;

  const footer = runner.running ? null : summary ? (
    <Button onClick={onClose}>Done</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={begin} disabled={!preview || previewQ.isFetching || !movers}>
        Move {movers.toLocaleString()} {movers === 1 ? 'person' : 'people'}
      </Button>
    </>
  );

  return (
    <Modal size="lg" title="Move to crew" subtitle={`${ids.length.toLocaleString()} selected`} onClose={onClose} closable={!runner.running} footer={footer}>
      {runner.running ? (
        <RunProgress
          progress={runner.progress}
          verb="Moving"
          stopping={stopping}
          onStop={() => {
            setStopping(true);
            runner.stop();
          }}
        />
      ) : summary ? (
        <RunSummary
          summary={summary}
          nameOf={nameFor}
          doneLine={(n) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'} moved to ${toName ? `${toName}’s crew` : 'No crew'}.`}
          onRetry={() => again(summary.failed.map((f) => f.id))}
          onContinue={() => again(summary.notStarted)}
        />
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <label htmlFor={`${runKey}-crew`} className="mb-1 block text-xs font-medium text-fg-muted">
              Crew
            </label>
            <CrewSelect id={`${runKey}-crew`} coordinators={coordinators} value={to} onChange={setTo} placeholder="Pick a crew…" />
          </div>
          {to === null ? (
            <p className="text-fg-muted">Pick the crew they move to. You’ll see how many doors move before anything changes.</p>
          ) : previewQ.isLoading ? (
            <p className="text-fg-muted">Checking what would move…</p>
          ) : previewQ.isError ? (
            <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-danger-fg">
              Couldn’t check what would move: {previewQ.error.message}{' '}
              <Button variant="secondary" size="sm" className="ml-1" onClick={() => previewQ.refetch()}>
                Try again
              </Button>
            </div>
          ) : preview ? (
            <div className="space-y-2 rounded-md border border-brand-600 bg-brand-tint px-4 py-3">
              <p className="text-fg">
                {movers.toLocaleString()} {movers === 1 ? 'person changes' : 'people change'} crew to{' '}
                <strong>{toName || 'No crew'}</strong>.
              </p>
              {doors > 0 ? (
                <p className="text-fg">
                  Move <strong>{doors.toLocaleString()}</strong> {doors === 1 ? 'door' : 'doors'}
                  {sources.length ? ` from ${andList(sources)}` : ''} to {target}?
                </p>
              ) : (
                <p className="text-fg">None of their past doors move.</p>
              )}
              {doors > 0 && (
                <p className="text-xs text-fg-muted">
                  This changes these teams’ totals <strong>in this campaign</strong>, all time. Their work on your other
                  campaigns is not affected. It does not change campaign totals, coverage, or your bill.
                </p>
              )}
              {reportsLine && <p className="text-xs text-fg">{reportsLine}</p>}
              {runsCrew.map((p) => (
                <p key={p.userId} className="text-xs text-fg">
                  <strong>{p.name}</strong> runs a crew here. Their <em>own</em> doors move to {target}; their crew’s doors
                  stay with them.
                </p>
              ))}
              {unfinished.length > 0 && (
                <p className="text-xs text-fg">
                  This also finishes {unfinished.length.toLocaleString()} crew {unfinished.length === 1 ? 'change' : 'changes'} that
                  didn’t finish.
                </p>
              )}
              {leftAlone.length > 0 && <p className="text-xs text-fg-muted">Left alone: {countBy(leftAlone)}.</p>}
              {busyPeople.length > 0 && (
                <p className="text-xs text-warning-fg">
                  Another change for {busyPeople.length.toLocaleString()} of them is still finishing. They’ll be listed after the
                  move, for Retry failed.
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
};

export default BulkCrewDialog;
