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

export default function ConversionRunCard({ run, onRevert, onResume, onDismiss, busy }) {
  const c = run.counts || {};
  const running = run.status === 'running' || run.status === 'pending' || run.status === 'reverting';

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg">{label(run)}</div>
        {run.status === 'completed' && <Badge variant="success">Done</Badge>}
        {run.status === 'reverted' && <Badge variant="neutral">Undone</Badge>}
        {run.status === 'failed' && <Badge variant="danger">Stopped</Badge>}
        {running && <Badge variant="neutral">{run.progress?.phase === 'reverting' ? 'Undoing' : 'Working'}</Badge>}
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
            {run.progress?.phase === 'recomputing'
              ? 'Updating campaign totals…'
              : `${(run.progress?.doorsDone || 0).toLocaleString()} of ${(run.progress?.doorsTotal || 0).toLocaleString()} doors`}
          </div>
        </div>
      )}

      {run.status === 'failed' && run.error && (
        <p className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {run.error} Everything that already landed is correct and can be undone — or pick up where
          it stopped.
        </p>
      )}

      {!running && (
        <ul className="mt-3 space-y-1 text-sm">
          <Line n={c.responsesCreated}>survey responses recorded</Line>
          <Line n={c.responsesArchived}>answers removed and preserved</Line>
          <Line n={c.entriesConverted}>door entries changed</Line>
          <Line n={c.votersSkippedAlreadyAnswered}>voters already had an answer — left untouched</Line>
          <Line n={c.votersSkippedDnc}>voters skipped as do-not-contact</Line>
          <Line n={c.doorsNoVoters}>doors had nobody on file</Line>
          <Line n={c.responsesNotRestored}>answers could not be put back — a newer field answer is there now</Line>
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
        {run.status === 'failed' && (
          <Button size="sm" onClick={onResume} disabled={busy}>Pick up where it stopped</Button>
        )}
        {!run.revertedAt && !running && (
          <Button variant="secondary" size="sm" onClick={onRevert} disabled={busy}>Undo this change</Button>
        )}
        {!running && (
          <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>Dismiss</Button>
        )}
      </div>
    </Card>
  );
}
