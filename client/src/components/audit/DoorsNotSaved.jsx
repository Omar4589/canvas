import Segmented from '../ui/Segmented.jsx';
import { formatInTz } from '../../lib/datetime.js';
import { NOT_SAVED_TABS, doorLine, emptyLine, notSavedReason, rowState, whatLabel } from '../../lib/notSaved.js';

// The Audit page's "Doors not saved" section (docs/PROPOSAL_OFFLINE_QUEUE.md Part 1): doors phones saved
// without signal that the server turned down when they arrived, as GET
// /admin/campaigns/:campaignId/refused-uploads lists them. Pure view: the page owns the query (its own live
// poll, and its canvasser filter) and the Mark reviewed / Reopen write. The words are lib/notSaved.js.
// "Signed in as", not "Canvasser": an old phone uploads under whoever is signed in at the time.
const DoorsNotSaved = ({ data, tab, onTab, tz, loading, error, filteredName, busyId, onReview, reviewError }) => {
  const rows = data?.rows || [];
  const open = data?.open ?? 0;
  const truncated = (data?.total || 0) > rows.length;

  const action = (r) => {
    const state = rowState(r);
    if (state === 'saved-later') return <span className="text-xs font-medium text-success-fg">Saved later</span>;
    const reviewed = state === 'reviewed';
    return (
      <span className="inline-flex items-center gap-2">
        {reviewed && tab === 'all' && <span className="text-xs text-fg-muted">Reviewed</span>}
        <button
          type="button"
          onClick={() => onReview(r.id, !reviewed)}
          disabled={busyId === r.id}
          className="text-xs font-semibold text-brand-accent hover:underline disabled:opacity-50"
        >
          {reviewed ? 'Reopen' : 'Mark reviewed'}
        </button>
      </span>
    );
  };

  return (
    <section className="mb-6 rounded-lg border border-border bg-card" aria-label="Doors not saved">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">
          Doors not saved
          <span className="ml-2 text-xs font-normal text-fg-muted">
            · {open.toLocaleString()} open{filteredName ? ` · ${filteredName}` : ''}
          </span>
        </h2>
        <Segmented value={tab} onChange={onTab} options={NOT_SAVED_TABS} size="sm" />
      </div>
      {error ? (
        <p className="px-4 py-3 text-xs text-danger">Couldn’t load the doors not saved: {error.message}</p>
      ) : loading ? (
        <p className="px-4 py-3 text-xs text-fg-muted">Loading…</p>
      ) : !rows.length ? (
        <p className="px-4 py-3 text-xs text-fg-muted">{emptyLine(tab, data?.all || 0)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
                <th className="px-3 py-2 font-medium">Recorded</th>
                <th className="px-3 py-2 font-medium">Signed in as</th>
                <th className="px-3 py-2 font-medium">Door</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">Why</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatInTz(r.recordedAt || r.refusedAt, tz)}</td>
                  <td className="px-3 py-2 font-medium text-fg">{r.signedInAs || 'Unknown user'}</td>
                  <td className="px-3 py-2 text-fg">{doorLine(r)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-fg">{whatLabel(r)}</td>
                  <td className="px-3 py-2 text-fg-muted">{notSavedReason(r)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{action(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewError && <p className="border-t border-border px-4 py-2 text-xs text-danger">{reviewError}</p>}
      {truncated && !error && (
        <p className="border-t border-border px-4 py-2 text-xs text-fg-muted">
          Showing the newest {rows.length.toLocaleString()} of {(data.total || 0).toLocaleString()}.
        </p>
      )}
    </section>
  );
};

export default DoorsNotSaved;
