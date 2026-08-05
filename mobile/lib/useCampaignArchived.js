import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { archiveStateOf } from './campaignSelection';

// Is the campaign a screen is showing ARCHIVED — i.e. read-only?
//
// Derived from the shared ['admin','campaigns'] cache rather than carried on the persisted
// campaign blob, deliberately. That blob (`canvass.activeCampaign`) is written once and believed
// forever, has no invalidation, and is also written by the canvasser picker off /mobile/campaigns
// — an endpoint that filters to active campaigns and never sends the flag at all. A field baked
// in there would be a snapshot that goes stale the moment someone archives from the web, on the
// one device that most needs to notice. The query refetches; the blob can't.
//
// Costs no extra fetch: every screen that needs this already has this query in flight (the chip
// mounts it, more.jsx holds it, the campaign screens subscribe), and react-query dedupes by key.
//
// `canWrite` is FALSE until the list resolves. Gate write affordances in the positive form —
// `{canWrite && <Button/>}`, never `{!isArchived && ...}` — so a button can only ever appear,
// never flash and retract. Same rule duplicate-surveys.jsx already follows for the lead check.
export const useCampaignArchived = (campaignId) => {
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const state = archiveStateOf(campaignsQ.data?.campaigns, campaignId);
  return {
    isArchived: state === 'archived',
    canWrite: state === 'active',
    resolved: state !== 'unknown',
  };
};
