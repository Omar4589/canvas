import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import PassManager from '../components/PassManager.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';

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

  return (
    <div>
      <div className="mb-5">
        <Link to={`/campaigns/${campaignId}/efforts`} className="text-xs font-medium text-brand-accent hover:underline">
          ← Walk Lists
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
          Passes{effort ? ` — ${effort.name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Each pass is a billable trip through this walk list's doors. Cut a pass's books on the Turf Cutting page, then activate it here.
        </p>
      </div>

      {effortId ? (
        <PassManager campaignId={campaignId} effortId={effortId} tz={tz} variant="full" />
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
