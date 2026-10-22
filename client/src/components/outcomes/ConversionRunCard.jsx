import { Badge, Button, Card } from '../ui/index.js';
import { ACTION_LABELS } from '../../lib/statusColors.js';

// A survey-conversion run in flight, or its result once it lands.
//
// The result half exists because a bulk run is not fully described by "done": an admin needs to
// know which voters it deliberately did NOT touch, by name, or the skip rules are invisible and
// they will assume the answers went in everywhere.
//
// A FAILED run offers both Revert and Resume, and neither is a guess: what landed stays landed —
// every converted door is individually correct and individually revertible — so Resume picks up
// exactly where it stopped and Revert undoes precisely what happened.
//
// A stopped UNDO (revert_failed) offers only Retry undo. The undo is re-entrant, so running it again
// finishes it; resuming would run the conversion forward and make the change again.
const label = (r) =>
  r.direction === 'to_survey'
    ? `${(r.sources || []).map((s) => ACTION_LABELS[s] || s).join(', ') || 'Door entries'} → Surveyed`
    : `Surveyed → ${ACTION_LABELS[r.to] || r.to}`;

const Line = ({ n, children }) =>
  n > 0 ? (
    <li>
      <span className="font-medium text-fg">{n.toLocaleString()}</span>{' '}
      <span className="text-fg-muted">{children}</span>
    </li>
  ) : null;

export default function ConversionRunCard({ run, onRevert, onResume, onDismiss, busy, stopped = false }) {
  const c = run.counts || {};
  // `stopped`: the poll ended on a refusal — the last state that loaded, with only Dismiss.
  const running = !stopped && (run.status === 'running' || run.status === 'pending' || run.status === 'reverting');

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg">
          {label(run)}
          {run.scopeSummary && (
            <div className="mt-0.5 text-xs font-normal text-fg-subtle">Filtered to: {run.scopeSummary}</div>
          )}
        </div>
        {run.status === 'completed' && <Badge variant="success">Done</Badge>}
        {run.status === 'reverted' && <Badge variant="neutral">Undone</Badge>}
        {run.status === 'failed' && <Badge variant="danger">Stopped</Badge>}
        {run.status === 'revert_failed' && <Badge variant="danger">Undo stopped</Badge>}
        {run.status === 'open' && <Badge variant="neutral">Unfinished</Badge>}
        {running && <Badge variant="neutral">{run.status === 'reverting' ? 'Undoing' : 'Working'}</Badge>}
      </div>

      {running && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-brand-accent transition-[width] duration-500"
              style={{ width: `${Math.max(3, run.progress?.pct || 0)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {/* An undo counts the people whose answers it has put back; going forward it counts doors
                (2026-10-21: an undo's bar sat at the start, reading 0 doors, until it finished). */}
            {run.progress?.phase === 'recomputing'
              ? 'Updating campaign totals…'
              : run.status === 'reverting'
                ? run.progress?.peopleTotal
                  ? `Putting answers back · ${(run.progress.peopleDone || 0).toLocaleString()} of ${run.progress.peopleTotal.toLocaleString()} people`
                  : 'Undoing…'
                : run.status === 'pending'
                  ? 'Waiting to start…'
                  : `${(run.progress?.doorsDone || 0).toLocaleString()} of ${(run.progress?.doorsTotal || 0).toLocaleString()} doors`}
          </div>
        </div>
      )}

      {stopped && (
        <p className="mt-2 rounded border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
          This change can&rsquo;t be read any more, so what&rsquo;s shown is the last that loaded. Its row under
          Survey answer changes shows where it stands.
        </p>
      )}

      {run.status === 'failed' && run.error && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.error} Everything that already landed is correct and can be undone — or pick up where
          it stopped.
        </p>
      )}
      {run.status === 'revert_failed' && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.error || 'The undo stopped before it finished.'} Everything it already put back is
          correct. Retry the undo to finish putting the rest back.
        </p>
      )}

      {!running && (
        <ul className="mt-3 space-y-1 text-sm">
          <Line n={c.responsesCreated}>surveys recorded</Line>
          <Line n={c.responsesArchived}>surveys removed and preserved</Line>
          <Line n={c.entriesConverted}>door entries changed</Line>
          <Line n={c.votersSkippedAlreadyAnswered}>voters already had an answer — left untouched</Line>
          <Line n={c.votersSkippedDnc}>voters skipped as do-not-contact</Line>
          <Line n={c.doorsNoVoters}>doors had nobody on file</Line>
          <Line n={c.responsesNotRestored}>surveys could not be put back — a newer field survey is there now</Line>
        </ul>
      )}

      {run.samples?.length > 0 && !running && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-accent">
            Who was skipped ({run.samplesTotal?.toLocaleString() || run.samples.length})
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-fg-muted">
            {run.samples.map((s, i) => (
              <li key={`${s.voterId}-${i}`}>
                {s.voterName || 'Voter'}
                <span className="text-fg-subtle">
                  {' '}
                  ·{' '}
                  {s.reason === 'dnc'
                    ? 'do-not-contact'
                    : s.reason === 'not_restored'
                      ? 'a newer answer is on file'
                      : 'already answered'}
                </span>
              </li>
            ))}
          </ul>
          {run.samplesTruncated && (
            <p className="mt-1 text-xs text-fg-subtle">Showing the first {run.samples.length}.</p>
          )}
        </details>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!stopped && run.status === 'failed' && (
          <Button size="sm" onClick={onResume} disabled={busy}>Pick up where it stopped</Button>
        )}
        {/* An open door-by-door session is undone once it's closed (the server refuses before). */}
        {!stopped && !run.revertedAt && !running && run.status !== 'open' && (
          <Button variant="secondary" size="sm" onClick={onRevert} disabled={busy}>
            {run.status === 'revert_failed' ? 'Retry undo' : 'Undo this change'}
          </Button>
        )}
        {!running && (
          <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>Dismiss</Button>
        )}
      </div>
    </Card>
  );
}
