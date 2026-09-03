import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Resolving the `:campaignId` in the URL against the org's campaign list — the ONE owner for
// every page under the campaign drill-in.
//
// The bug this exists to prevent: **"Campaign not found" flashing over a campaign that exists.**
// Eight pages each carried their own copy of
//
//     if (!campaignId || (!campaignsQ.isLoading && !current)) → "Campaign not found"
//
// and react-query's `isLoading` is only true when the query holds NO data at all. Land on a
// campaign while the list cache still holds an OLDER answer and `isLoading` is false, the id
// isn't in the stale array yet, and the page confidently declares the campaign missing until the
// refetch lands a moment later. Creating a campaign hits that every single time, by construction:
// CampaignsPage invalidates ['admin','campaigns'] and navigates to the new campaign in the same
// tick, so the drill-in mounts against a list written before the campaign existed.
//
// So the three states are named apart, and a cached list that predates the id is NOT an answer:
// while a fetch is in flight and the id hasn't turned up, we are still RESOLVING. `notFound` is
// claimed only once the list has actually answered. `isFetching` is what covers the refetch, and
// it is reported OPTIMISTICALLY in the same render pass that mounts the observer (verified
// against @tanstack/react-query 5.100.6: a seeded-then-invalidated cache renders
// isLoading:false / isFetching:true), so there is no frame in which a stale miss reads as final.
// A settled cache without the id is a real 404 and says so immediately — this never turns a
// genuinely missing campaign into a spinner that never resolves.
//
// Mid-delete campaigns are NOT resolvable here on purpose: the server ships them in their own
// `deletingCampaigns` array and this reads `campaigns`, so a campaign being deleted reads as gone
// on every drill-in — only the Campaigns page renders those rows.
export function resolveCampaign({ campaignId, campaigns, isLoading, isFetching }) {
  const campaign = campaignId
    ? (campaigns || []).find((c) => String(c._id) === String(campaignId)) || null
    : null;
  // No id in the URL at all isn't "still resolving" — there is nothing to resolve.
  const resolving = !!campaignId && !campaign && !!(isLoading || isFetching);
  return { campaign, resolving, notFound: !campaign && !resolving };
}

// The list query itself is shared cache (['admin','campaigns'], 60s stale) — the same key the
// Campaigns page, the sidebar switcher and the drill-in pages have always used, so this hook adds
// no request.
export function useCurrentCampaign(campaignId) {
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const { campaign, resolving, notFound } = resolveCampaign({
    campaignId,
    campaigns,
    isLoading: campaignsQ.isLoading,
    isFetching: campaignsQ.isFetching,
  });
  return { campaignsQ, campaigns, campaign, resolving, notFound };
}
