import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Card, Modal, Skeleton } from '../ui/index.js';
import SurveyAnswerComposer from './SurveyAnswerComposer.jsx';
import { buildAnswers, dropEmptyAnswers } from '../../lib/surveyAnswerForm.js';

// Door-by-door desk entry: a bulk SELECTION, entered one address at a time so each voter gets
// their own real answers instead of everyone getting the same one.
//
// The remaining queue is DERIVED server-side — the frozen selection minus the rows already stamped
// with this run's id — never a stored cursor. So leaving mid-way and coming back is just a reload,
// and there is no pointer that can disagree with what actually landed. The whole session reverts
// as one unit, which is what "undo" means to someone who just walked 40 doors.
//
// Answers CARRY OVER from the previous door on purpose: consecutive corrections are usually the
// same fix, and re-picking an identical answer 40 times is how people start rubber-stamping. The
// carry is visible and every door is still confirmed individually.
export default function QueueWalkthrough({ campaignId, run, template, onDone, onCancel }) {
  const [remaining, setRemaining] = useState(run.doorsRemaining || []);
  const [vals, setVals] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [skipped, setSkipped] = useState(() => new Set());
  const [carried, setCarried] = useState(false);
  const [door, setDoor] = useState(null);
  const [voters, setVoters] = useState(null);
  const [error, setError] = useState(null);

  const actionId = remaining[0] || null;
  const total = run.progress?.doorsTotal || run.counts?.doorsTargeted || 0;
  const done = total - remaining.length;

  // The door and its people, as the RUN sees them — one fetch per door, aborted on move so a slow
  // response can never paint the previous address's people over the current one.
  useEffect(() => {
    if (!actionId) return undefined;
    const ac = new AbortController();
    setDoor(null);
    setVoters(null);
    api(`/admin/campaigns/${campaignId}/survey-conversions/${run.id}/door/${actionId}`, { signal: ac.signal })
      .then((d) => {
        setDoor(d.door);
        setVoters(d.voters || []);
        // Anyone who already answered this round starts unticked: the run would skip them anyway,
        // and offering to record over a real field answer is a promise the write won't keep.
        setSkipped(new Set((d.voters || []).filter((v) => v.alreadyAnswered).map((v) => v.id)));
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => ac.abort();
  }, [actionId, campaignId, run.id]);

  const questions = useMemo(
    () => (template?.questions || []).filter((q) => !q.retired),
    [template]
  );

  const apply = useMutation({
    mutationFn: () => {
      const answers = dropEmptyAnswers(buildAnswers(questions, vals, otherTexts));
      const voterPlans = {};
      for (const v of voters || []) {
        if (skipped.has(v.id) || v.dnc) continue;
        voterPlans[v.id] = { answers };
      }
      return api(`/admin/campaigns/${campaignId}/survey-conversions/${run.id}/door`, {
        method: 'POST',
        body: { actionId, voterPlans },
      });
    },
    onSuccess: () => {
      setRemaining((r) => r.slice(1));
      setCarried(true); // answers persist into the next door, visibly
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const finish = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/survey-conversions/${run.id}/close`, { method: 'POST' }),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (!remaining.length && !finish.isPending && !finish.isSuccess) finish.mutate();
    // finish.mutate is stable; re-running on every render would fire the close repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining.length]);

  if (!remaining.length) {
    return (
      <Modal onClose={onDone} title="Desk entry finished" size="md" footer={<Button onClick={onDone}>Close</Button>}>
        <p className="text-sm text-fg">
          All {total.toLocaleString()} doors done. You can undo the whole session from the run card.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onCancel}
      title={door ? door.address : 'Loading door…'}
      subtitle={`Door ${done + 1} of ${total.toLocaleString()}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={apply.isPending}>
            Finish later
          </Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending || !voters}>
            {apply.isPending ? 'Saving…' : remaining.length === 1 ? 'Save & finish' : 'Save & next door'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-brand-accent transition-[width] duration-300"
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </div>

      <Card className="mb-3 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Who answered
        </div>
        {!voters ? (
          <Skeleton className="h-12 w-full" />
        ) : !voters.length ? (
          <p className="text-sm text-fg-muted">Nobody is on file at this address — the door will change outcome with no answers.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {voters.map((v) => (
              <label key={v.id} className="flex items-center gap-1.5 text-sm text-fg">
                <input
                  type="checkbox"
                  className="accent-brand-accent"
                  checked={!skipped.has(v.id) && !v.dnc}
                  disabled={v.dnc || v.alreadyAnswered}
                  onChange={() =>
                    setSkipped((s) => {
                      const next = new Set(s);
                      next.has(v.id) ? next.delete(v.id) : next.add(v.id);
                      return next;
                    })
                  }
                />
                {v.fullName}
                {v.dnc && <span className="text-xs text-fg-subtle">(do-not-contact)</span>}
                {v.alreadyAnswered && !v.dnc && (
                  <span className="text-xs text-fg-subtle">(already answered this round)</span>
                )}
              </label>
            ))}
          </div>
        )}
      </Card>

      {carried && (
        <p className="mb-2 text-xs text-fg-muted">
          Answers carried over from the previous door — change anything that&rsquo;s different.
        </p>
      )}
      <SurveyAnswerComposer
        template={template}
        vals={vals}
        otherTexts={otherTexts}
        onChange={setVals}
        onOtherChange={setOtherTexts}
        idPrefix={`queue-${actionId}`}
      />
    </Modal>
  );
}
