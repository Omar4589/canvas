import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { outcomeInUse } from './outcomeToggles';

// Has this campaign EVER had an off-by-default outcome on (today: 'not_target')? The gate behind
// every admin figure, chip and tab that exists only for such an outcome, so a customer who never
// turns it on never sees the words.
//
// Read from the shared ['admin','campaigns'] cache — the full campaign rows — exactly as
// useCampaignArchived does, and for the same reason: the campaign objects most admin screens hold
// are SHAPED copies (campaignShape, useAdminCampaign's shape(), MemberSheet's { id, name, type }),
// none of which carries these fields, and the persisted active-campaign blob must not be widened.
// No extra fetch — react-query dedupes by key.
//
// FALSE until the list resolves, so a figure can only appear, never flash and retract.
export const useOutcomeInUse = (campaignId, key = 'not_target') => {
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const doc = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId));
  return doc ? outcomeInUse(doc, key) : false;
};
