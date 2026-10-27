import { Button } from '../ui/index.js';
import { SELECT_MAX } from '../../lib/teamSelection.js';

// The Team page's bar for the people ticked (docs/PROPOSAL_PEOPLE_PAGES.md §E.4): how many are
// selected, Select all N that match (up to 500), and the three actions. It acts on the selection still
// in the filter, and each action's count is who it actually reaches: Resend invites only goes to
// people who never signed in (canvassers only, for a team lead), Remove from campaign only to people
// this viewer may remove.
//
// `fixed`, above BottomNav on a narrow window, like the other bulk bars (BulkLinkBar).
const TeamBulkBar = ({ count, matching, onSelectAll, onClear, onMove, resendCount, onResend, removeCount, onRemove }) => {
  if (!count) return null;
  const canSelectMore = count < Math.min(matching, SELECT_MAX);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-4">
      <div className="pointer-events-auto w-full max-w-3xl rounded-card border border-border bg-raised p-3 shadow-popover">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium text-fg">{count.toLocaleString()} selected</span>
          {canSelectMore && (
            <button type="button" onClick={onSelectAll} className="text-sm font-medium text-brand-accent hover:underline">
              Select all {matching.toLocaleString()} that match{matching > SELECT_MAX ? ` (up to ${SELECT_MAX})` : ''}
            </button>
          )}
          <button type="button" onClick={onClear} className="text-sm text-fg-muted hover:underline">
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onMove}>
              Move to crew…
            </Button>
            <Button size="sm" variant="secondary" onClick={onResend} disabled={!resendCount} title={resendCount ? undefined : 'No one selected has a sign-in to set up'}>
              Resend invites ({resendCount.toLocaleString()})
            </Button>
            <Button size="sm" variant="danger" onClick={onRemove} disabled={!removeCount}>
              Remove from campaign{removeCount !== count ? ` (${removeCount.toLocaleString()})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamBulkBar;
