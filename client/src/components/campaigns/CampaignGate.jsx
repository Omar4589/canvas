import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Skeleton } from '../ui/index.js';

// The two non-page states of a campaign drill-in, shared by all eight pages so they cannot
// drift — and, more to the point, so there is one place that decides what each state LOOKS
// like. See lib/useCurrentCampaign.js for which state is which; the rule it enforces is that
// "not found" is a claim about the campaign, never about how far the list query has got.

// Still resolving :campaignId — the list query hasn't answered for this id yet. Shaped like the
// header every drill-in page opens with (name, then the one-line "Timeline — who's knocking"
// style subtitle) so the real page lands in the same place the skeleton was.
export function CampaignLoading() {
  return (
    <div>
      <div className="mb-4 space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 opacity-60" />
      </div>
      <Skeleton className="h-64 w-full opacity-60" />
    </div>
  );
}

// The list HAS answered and this campaign isn't in it: deleted, archived out of a lead's grants,
// belongs to another org, or the URL was mistyped. `title`/`hint` are for the one caller that
// distinguishes "no campaign selected" from "campaign not found".
export function CampaignMissing({ title = 'Campaign not found', hint = '' }) {
  const { homePath } = useAuth();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-fg">{title}</h1>
      {hint && <p className="text-sm text-fg-muted">{hint}</p>}
      <Link
        to={homePath}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        {homePath === '/campaigns' ? 'Go to Campaigns' : 'Go to Overview'}
      </Link>
    </div>
  );
}
