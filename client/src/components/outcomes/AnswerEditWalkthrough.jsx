import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Modal } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import PerPersonAnswerEditor, { seedEditor, touchedAnswers } from '../surveys/PerPersonAnswerEditor.jsx';

// Door Outcomes → Edit answers… → One person at a time (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §I and
// Part 1 Design §6): each survey of the frozen selection opens with its recorded answers, the admin
// fixes what's wrong, and the whole session undoes as ONE change.
//
// The server keeps the cursor and checks every save against the editors' version: a survey that
// changed while it was open refuses (409 RESPONSE_CHANGED) and comes back with the latest answers,
// so a stale screen can never write over a re-survey. Save & next with nothing changed is a skip;
// a double tap is a no-op.
// Did the admin change anything on this survey — a touched question whose answer now differs from
// the stored one? A pick ticked and unticked again is touched but unchanged, and the notice below
// called it a lost change (code review round 4).
const changedFromStored = (questions, editor, stored) => {
  const byQuestion = (rows) => new Map(rows.map((a) => [a.questionKey, JSON.stringify(a)]));
  const now = byQuestion(touchedAnswers(questions, editor));
  const before = byQuestion(touchedAnswers(questions, { ...seedEditor(questions, stored), touched: editor.touched }));
  return [...new Set([...now.keys(), ...before.keys()])].some((k) => now.get(k) !== before.get(k));
};

// `onClosedElsewhere(message)`: the session was stopped from another tab or by another admin — the
// walkthrough leaves and the page says so, instead of refusing every Save on the same survey (round 5).
const AnswerEditWalkthrough = ({ campaignId, run, initial, tz, onFinishLater, onStopped, onClosedElsewhere = onFinishLater }) => {
  const [current, setCurrent] = useState(initial || null);
  const [editor, setEditor] = useState(() => (initial ? seedEditor(initial.questions, initial.answers) : null));
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [runWire, setRunWire] = useState(run);
  const bodyRef = useRef(null);
  const base = `/admin/campaigns/${campaignId}/answer-edits/${run.id}`;

  // A new survey: fresh editor state, scrolled to the top (the Modal body is reused between steps).
  const responseKey = current?.responseId || null;
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [responseKey]);
  const show = (next) => {
    setCurrent(next);
    setEditor(next && !next.missing ? seedEditor(next.questions, next.answers) : null);
  };

  const save = useMutation({
    mutationFn: ({ answers }) =>
      api(`${base}/response`, {
        method: 'POST',
        body: { responseId: current.responseId, version: current.version, answers },
      }),
    onSuccess: (d, { changed, who }) => {
      // The survey left the session between showing it and saving (deleted, or surveyed again with
      // another survey): the server moved on without saving, and says so here — never silently
      // (code review round 2) — when there was a change to lose (round 3).
      setNotice(
        d.skipped && d.reason && changed
          ? d.reason === 'other_survey'
            ? `${who} was surveyed again with a different survey while you were editing, so your change wasn’t saved.`
            : `${who}’s survey was deleted while you were editing, so your change wasn’t saved.`
          : null
      );
      setError(null);
      setRunWire(d.run);
      show(d.current);
    },
    onError: (e, v) => {
      if (e.code === 'RESPONSE_CHANGED' && e.data?.current) {
        setNotice(e.message);
        show(e.data.current);
        return;
      }
      if (e.code === 'RUN_NOT_OPEN') {
        // ...and the change on this screen is gone with it — say so (round 6).
        onClosedElsewhere(v?.changed ? `${e.message} Your change to ${v.who}’s survey wasn’t saved.` : e.message);
        return;
      }
      setError(e.message);
    },
  });
  const skip = useMutation({
    mutationFn: () => api(`${base}/skip`, { method: 'POST', body: { responseId: current.responseId } }),
    onSuccess: (d) => {
      setNotice(null);
      setError(null);
      setRunWire(d.run);
      show(d.current);
    },
    onError: (e) => (e.code === 'RUN_NOT_OPEN' ? onClosedElsewhere(e.message) : setError(e.message)),
  });
  const stop = useMutation({
    mutationFn: () => api(`${base}/close`, { method: 'POST' }),
    onSuccess: (d) => onStopped(d.run),
    // Stopped elsewhere already: leave, as a refused save does — Stop here was refused every time
    // (round 6).
    onError: (e) => (e.code === 'RUN_NOT_OPEN' ? onClosedElsewhere(e.message) : setError(e.message)),
  });

  const busy = save.isPending || skip.isPending || stop.isPending;
  const saveStep = () =>
    save.mutate({
      answers: touchedAnswers(current.questions, editor),
      changed: changedFromStored(current.questions, editor, current.answers),
      who: current?.voter?.name || 'This voter',
    });
  // No closing mid-save (Escape, the backdrop): the reply would land on a closed session.
  const finishLater = () => {
    if (!busy) onFinishLater();
  };
  const total = current?.total || runWire?.progress?.total || 0;
  const changed = runWire?.counts?.surveysChanged || 0;

  if (!current) {
    return (
      <Modal
        onClose={finishLater}
        title="That’s every survey in this session"
        subtitle={`${changed.toLocaleString()} ${changed === 1 ? 'survey' : 'surveys'} changed`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onFinishLater} disabled={busy}>Finish later</Button>
            <Button onClick={() => stop.mutate()} disabled={busy}>{stop.isPending ? 'Finishing…' : 'Stop here'}</Button>
          </>
        }
      >
        {/* The last survey's notice too: saving it is what brought this screen up (round 3). */}
        {notice && <p className="mb-3 rounded border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning-fg">{notice}</p>}
        <p className="text-sm text-fg">
          Stop here finishes the session: it&rsquo;s listed under Survey answer changes, and its Undo puts
          every survey you changed back as one change.
        </p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      onClose={finishLater}
      bodyRef={bodyRef}
      title={
        current.missing
          ? current.reason === 'other_survey'
            ? 'Surveyed again with a different survey'
            : 'This survey is no longer on file'
          : current.voter?.name || 'Survey'
      }
      subtitle={
        current.missing
          ? undefined
          : [current.address, current.round, current.recordedBy ? `recorded by ${current.recordedBy}` : null, formatInTz(current.submittedAt, tz)]
              .filter(Boolean)
              .join(' · ')
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onFinishLater} disabled={busy}>Finish later</Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => skip.mutate()} disabled={busy}>Skip</Button>
          {!current.missing && (
            <Button onClick={saveStep} disabled={busy}>{save.isPending ? 'Saving…' : 'Save & next'}</Button>
          )}
        </>
      }
    >
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>
            Survey {(current.position + 1).toLocaleString()} of {total.toLocaleString()}
            {current.done ? <Badge variant="neutral" className="ml-2">Changed</Badge> : null}
          </span>
          <span>{changed.toLocaleString()} changed so far</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand-accent" style={{ width: `${Math.max(3, Math.round(((current.position + 1) / Math.max(1, total)) * 100))}%` }} />
        </div>
      </div>

      {notice && <p className="mb-3 rounded border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning-fg">{notice}</p>}
      {error && <p className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}

      {current.missing ? (
        <p className="text-sm text-fg-muted">
          {current.reason === 'other_survey'
            ? 'This voter was surveyed again since the session started, with a different survey, so this session’s questions don’t apply. Nothing here can be edited — skip it.'
            : 'Someone deleted this survey or recorded a different result at the door since the session started. There is nothing to edit here — skip it.'}
        </p>
      ) : (
        <>
          {current.deskEntry && (
            <p className="mb-2 text-xs text-fg-muted">Entered by {current.deskEntry.by || 'an admin'} at the desk.</p>
          )}
          {current.edited && (
            <p className="mb-2 text-xs text-fg-muted">
              Edited {formatInTz(current.edited.at, tz)}{current.edited.by ? ` by ${current.edited.by}` : ''}.
            </p>
          )}
          <PerPersonAnswerEditor
            questions={current.questions}
            answers={current.answers}
            editor={editor}
            onChange={setEditor}
            idPrefix={`aw-${current.responseId}`}
          />
        </>
      )}
    </Modal>
  );
};

export default AnswerEditWalkthrough;
