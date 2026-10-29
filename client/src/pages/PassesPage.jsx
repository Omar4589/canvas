import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import PassManager from '../components/PassManager.jsx';
import { WalkListStatus } from '../components/walkListLifecycle';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { walkListState } from '../lib/walkListState.js';

// Full-page view of one walk list's passes. The effort is fixed by the route
// (/campaigns/:campaignId/efforts/:effortId/passes) — no walk-list picker. The same
// <PassManager> also renders inline in the Walk Lists drawer (compact variant).
export default function PassesPage() {
  const { campaignId, effortId } = useParams();
  const { selected } = useCampaignSelection(campaignId);
  const orgTz = useOrgTimeZone();
  const tz = selected?.timeZone || orgTz;

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const effort = (effortsQ.data?.efforts || []).find((e) => String(e._id) === String(effortId));
  // The same list PassManager loads (one request): it names a waiting draft in the walk list's status.
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes?effortId=${effortId}`),
    enabled: !!campaignId && !!effortId,
  });
  const status = effort
    ? walkListState(effort, {
        formatDate: (iso) => formatInTz(iso, tz, { month: 'short', day: 'numeric' }, false),
        passes: passesQ.data?.passes,
      })
    : null;

  return (
    <div>
      <div className="mb-5">
        <Link to={`/campaigns/${campaignId}/efforts`} className="text-xs font-medium text-brand-accent hover:underline">
          ← Walk Lists
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Passes{effort ? ` — ${effort.name}` : ''}
          </h1>
          <WalkListStatus state={status} />
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          Each pass is a fresh trip through this walk list's doors. Cut a pass's books on the Turf Cutting page, then activate it here.
        </p>
      </div>

      {effortId ? (
        <PassManager campaignId={campaignId} effortId={effortId} tz={tz} variant="full" campaignType={selected?.type} />
      ) : (
        <p className="text-sm text-fg-muted">
          Pick a walk list from{' '}
          <Link to={`/campaigns/${campaignId}/efforts`} className="font-medium text-brand-accent hover:underline">Walk Lists</Link>{' '}
          to manage its passes.
        </p>
      )}
    </div>
  );
}
