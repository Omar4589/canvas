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
  // null = NOT LOADED YET, [] = genuinely nothing left. Collapsing the two is what made a fresh
  // session close itself on first render: the creating call returned doorsRemaining: null, the
  // walkthrough read that as an empty queue, and the "all done" effect below fired immediately.
  const [remaining, setRemaining] = useState(run.doorsRemaining ?? null);
  const [vals, setVals] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  // "Different answers per person": one entry per voter instead of one per door. The shared set
  // stays the default because consecutive corrections are usually identical — but a household
  // where two people genuinely answered differently must be recordable in ONE pass, because the
  // door stamps on save and a skipped voter has no second chance through this tool.
  const [perVoter, setPerVoter] = useState(false);
  const [voterEntries, setVoterEntries] = useState({}); // { voterId: { vals, otherTexts } }
  const [activeVoterId, setActiveVoterId] = useState(null);
  const [skipped, setSkipped] = useState(() => new Set());
  const [carried, setCarried] = useState(false);
  const [door, setDoor] = useState(null);
  const [voters, setVoters] = useState(null);
  const [error, setError] = useState(null);

  const actionId = remaining?.[0] || null;
  const total = run.progress?.doorsTotal || run.counts?.doorsTargeted || 0;
  const done = remaining === null ? 0 : total - remaining.length;

  // Belt-and-braces: if we were handed a run without its queue (an older client, a shape change),
  // fetch it rather than assuming either answer.
  useEffect(() => {
    if (remaining !== null) return undefined;
    const ac = new AbortController();
    api(`/admin/campaigns/${campaignId}/survey-conversions/${run.id}`, { signal: ac.signal })
      .then((d) => setRemaining(d.run?.doorsRemaining || []))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => ac.abort();
  }, [remaining, campaignId, run.id]);

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
        // Per-voter entries are per-DOOR state; the shared set is what carries over.
        setPerVoter(false);
        setVoterEntries({});
        setActiveVoterId(null);
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

  const eligibleVoters = (voters || []).filter((v) => !skipped.has(v.id) && !v.dnc);
  // The tab actually shown: the chosen one while it stays eligible, else the first eligible — so
  // un-ticking whoever is active can never leave the composer editing a voter who won't be saved.
  const shownVoterId = eligibleVoters.some((v) => v.id === activeVoterId)
    ? activeVoterId
    : eligibleVoters[0]?.id || null;

  // Turning per-voter ON seeds every eligible voter from the shared answers, so switching modes
  // half-typed loses nothing and each person starts from the common case.
  const enablePerVoter = () => {
    const seeded = {};
    for (const v of eligibleVoters) {
      seeded[v.id] = voterEntries[v.id] || { vals: { ...vals }, otherTexts: { ...otherTexts } };
    }
    setVoterEntries(seeded);
    setActiveVoterId(eligibleVoters[0]?.id || null);
    setPerVoter(true);
  };

  const apply = useMutation({
    mutationFn: () => {
      const voterPlans = {};
      if (perVoter) {
        for (const v of eligibleVoters) {
          const e = voterEntries[v.id] || { vals: {}, otherTexts: {} };
          voterPlans[v.id] = { answers: dropEmptyAnswers(buildAnswers(questions, e.vals, e.otherTexts)) };
        }
      } else {
        const answers = dropEmptyAnswers(buildAnswers(questions, vals, otherTexts));
        for (const v of eligibleVoters) voterPlans[v.id] = { answers };
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
    // `remaining === null` means we don't know yet — closing on that is the bug this guards.
    if (remaining !== null && !remaining.length && !finish.isPending && !finish.isSuccess) finish.mutate();
    // finish.mutate is stable; re-running on every render would fire the close repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (remaining === null) {
    return (
      <Modal onClose={onCancel} title="Opening desk entry…" size="md">
        <Skeleton className="h-24 w-full" />
      </Modal>
    );
  }

  // A session without its survey can't compose answers — say so instead of rendering a dead page.
  // (Reachable only if the template was deleted between creating and resuming the session.)
  if (!template) {
    return (
      <Modal onClose={onCancel} title="Can't open this session" size="md" footer={<Button onClick={onCancel}>Close</Button>}>
        <p className="text-sm text-fg">
          The survey this session was recording against is no longer available. You can undo the
          session from the run card, or restore the survey and resume.
        </p>
      </Modal>
    );
  }

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

      {eligibleVoters.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="accent-brand-accent"
            checked={perVoter}
            onChange={() => (perVoter ? setPerVoter(false) : enablePerVoter())}
          />
          Different answers for each person
        </label>
      )}

      {carried && !perVoter && (
        <p className="mb-2 text-xs text-fg-muted">
          Answers carried over from the previous door — change anything that&rsquo;s different.
        </p>
      )}

      {perVoter ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {eligibleVoters.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveVoterId(v.id)}
                className={[
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  v.id === shownVoterId
                    ? 'border-brand-accent bg-brand-tint text-brand-tint-fg'
                    : 'border-border bg-card text-fg-muted hover:bg-sunken',
                ].join(' ')}
              >
                {v.fullName}
              </button>
            ))}
          </div>
          {shownVoterId && (
            <SurveyAnswerComposer
              template={template}
              vals={(voterEntries[shownVoterId] || {}).vals || {}}
              otherTexts={(voterEntries[shownVoterId] || {}).otherTexts || {}}
              onChange={(next) =>
                setVoterEntries((e) => ({ ...e, [shownVoterId]: { otherTexts: {}, ...e[shownVoterId], vals: next } }))
              }
              onOtherChange={(next) =>
                setVoterEntries((e) => ({ ...e, [shownVoterId]: { vals: {}, ...e[shownVoterId], otherTexts: next } }))
              }
              idPrefix={`queue-${actionId}-${shownVoterId}`}
            />
          )}
        </>
      ) : (
        <SurveyAnswerComposer
          template={template}
          vals={vals}
          otherTexts={otherTexts}
          onChange={setVals}
          onOtherChange={setOtherTexts}
          idPrefix={`queue-${actionId}`}
        />
      )}
    </Modal>
  );
}
