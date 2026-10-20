import { Badge, Button, Card } from '../ui/index.js';
import { runState, picksLine } from '../../lib/answerEditPlan.js';

// One answer edit, live or just finished — Part 1 Design §4 of docs/PROPOSAL_SURVEY_ANSWER_EDITS.md.
// Its state and buttons come from runState(), the one owner the list rows share, so the card and
// the row can never offer different things. Once an undo has started, Pick up is never offered:
// applying a change that is being taken back would make it again.
const ACTION_LABEL = {
  startAgain: 'Start again',
  startAgainUndo: 'Start again',
  details: 'Details',
  undo: 'Undo',
  undoAgain: 'Undo again',
  retryUndo: 'Retry undo',
  pickUp: 'Pick up where it stopped',
  undoLanded: 'Undo what landed',
  resume: 'Resume',
  stopHere: 'Stop here',
};

const REASON = {
  changed_since_review: 'changed after you reviewed it — left as it was',
  not_found: 'no longer on file — left alone',
};

const UNDO_REASON = {
  changed_since: 'kept newer answers',
  waiting: 'waiting on a later change',
  cleared: 'cleared with a re-cut — after a snapshot restore, Undo again finishes it',
  erased: 'its earlier answers were erased on the profile',
  restored_on_profile: 'restored on the profile',
  gone: 'no longer on file',
};

export const undoReasonText = (n) => `${UNDO_REASON[n.reason] || n.reason}${n.detail ? ` (${n.detail})` : ''}`;

const AnswerEditRunCard = ({ run, onAction, busy, onDismiss, stopped = false }) => {
  const state = runState(run);
  if (!state) return null;
  const running = !stopped && (state.key === 'running' || state.key === 'undoing' || state.key === 'waiting');
  const pct = run.progress?.total ? Math.round(((run.progress.done || 0) / run.progress.total) * 100) : 0;
  const undoNames = run.undo?.summary?.names || [];

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-fg">
          Answers edited{run.planSummary ? ` · ${run.planSummary}` : ''}
          {run.scopeSummary && <div className="mt-0.5 text-xs font-normal text-fg-subtle">Filtered to: {run.scopeSummary}</div>}
        </div>
        <Badge variant={state.tone === 'danger' ? 'danger' : state.tone === 'success' ? 'success' : 'neutral'}>{state.label}</Badge>
      </div>

      {running && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          {state.key === 'running' ? (
            <div className="h-full rounded-full bg-brand-accent transition-[width] duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
          ) : (
            // Waiting or undoing: no count to show (the stored progress is the apply phase's).
            <div className="h-full w-full animate-pulse rounded-full bg-brand-accent/40" />
          )}
        </div>
      )}

      {stopped && (
        <p className="mt-2 rounded border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
          This change can&rsquo;t be read any more, so what&rsquo;s shown is the last that loaded. Its row under
          Survey answer changes shows where it stands.
        </p>
      )}

      {!running && picksLine(run) && <p className="mt-2 text-sm text-fg-muted">{picksLine(run)}</p>}

      {run.status === 'failed' && (state.key === 'notStarted' || state.key === 'stoppedEmpty') && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.error || 'The change stopped before changing any survey.'}{' '}
          {state.key === 'stoppedEmpty' ? 'No survey has been changed — press Pick up where it stopped to run it.' : ''}
        </p>
      )}
      {run.status === 'failed' && state.key === 'stopped' && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.error || 'The change stopped part-way.'} Every survey it already changed is correct and
          can be undone — or pick up where it stopped.
        </p>
      )}
      {run.undo?.status === 'failed' && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.undo.error || 'The undo stopped part-way.'} Everything it already put back is correct. Retry
          the undo to finish putting the rest back.
        </p>
      )}

      {run.samples?.length > 0 && !running && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-accent">
            Left as they were ({(run.samplesTotal || run.samples.length).toLocaleString()})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-fg-muted">
            {run.samples.map((s, i) => (
              <li key={`${s.voterId}-${i}`}>
                {s.voterName || 'Voter'} <span className="text-fg-subtle">· {REASON[s.reason] || s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {undoNames.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-accent">
            Not put back ({(run.undo.summary.namesTotal || undoNames.length).toLocaleString()})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-fg-muted">
            {undoNames.map((n, i) => (
              <li key={`${n.voterId}-${i}`}>
                {n.voterName || 'Voter'} <span className="text-fg-subtle">· {undoReasonText(n)}</span>
              </li>
            ))}
          </ul>
          {(run.undo.summary.waiting || 0) > 0 && (
            <p className="mt-1 text-xs text-fg-subtle">Undo the later change first, then press Undo again here.</p>
          )}
        </details>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!stopped && state.actions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === 'pickUp' || a === 'retryUndo' || a === 'resume' ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => onAction(a, run)}
          >
            {ACTION_LABEL[a] || a}
          </Button>
        ))}
        {!running && onDismiss && (
          <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>Dismiss</Button>
        )}
      </div>
    </Card>
  );
};

export default AnswerEditRunCard;

export { ACTION_LABEL };
