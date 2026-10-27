import { Button } from '../ui/index.js';

// What a bulk run on the Team page shows (docs/PROPOSAL_PEOPLE_PAGES.md §E.5): progress with Stop while
// it runs, then the summary — done, skipped with reasons, failed with reasons and Retry failed, and
// anyone a stopped run never reached, with Continue. A run stopped by a refusal of the whole action
// (the org's account read-only for billing, an archived campaign) says why first.

const SHOWN = 50;

export const RunProgress = ({ progress, verb = 'Working', onStop, stopping = false }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg">
    <span role="status">
      {verb}… {(progress?.settled ?? 0).toLocaleString()} of {(progress?.total ?? 0).toLocaleString()}
    </span>
    <Button variant="secondary" size="sm" onClick={onStop} disabled={stopping}>
      {stopping ? 'Stopping after this one…' : 'Stop'}
    </Button>
  </div>
);

const People = ({ items, nameOf }) => (
  <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-fg-muted">
    {items.slice(0, SHOWN).map((x) => (
      <li key={x.id}>
        <span className="text-fg">{nameOf(x.id)}</span>
        {x.reason ? ` — ${x.reason}` : ''}
      </li>
    ))}
    {items.length > SHOWN && <li>and {(items.length - SHOWN).toLocaleString()} more</li>}
  </ul>
);

export const RunSummary = ({ summary, nameOf, doneLine, onRetry, onContinue, busy = false }) => {
  const { done, skipped, failed, notStarted, stopped } = summary;
  const refused = stopped && stopped.reason !== 'stopped';
  return (
    <div className="space-y-3 text-sm">
      {refused && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-danger-fg">
          {stopped.reason}
        </div>
      )}
      <p className="font-medium text-fg">{doneLine(done.length)}</p>
      {skipped.length > 0 && (
        <div>
          <p className="text-fg">{skipped.length.toLocaleString()} left alone:</p>
          <People items={skipped} nameOf={nameOf} />
        </div>
      )}
      {failed.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-warning-fg">{failed.length.toLocaleString()} couldn’t be done:</p>
            {onRetry && (
              <Button size="sm" variant="secondary" onClick={onRetry} disabled={busy}>
                Retry failed
              </Button>
            )}
          </div>
          <People items={failed} nameOf={nameOf} />
        </div>
      )}
      {notStarted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-sunken px-3 py-2">
          <p className="text-fg">{notStarted.length.toLocaleString()} not started.</p>
          {onContinue && (
            <Button size="sm" variant="secondary" onClick={onContinue} disabled={busy}>
              Continue
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
