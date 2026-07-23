import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { loadActiveCampaign, saveActiveCampaign } from './cache';

// The VALIDATED campaign for admin-surface screens that have no CampaignChip. The cached
// active campaign is written by the canvasser-side picker, which lists campaigns by FIELD
// assignment — so a team lead's cache can hold a campaign they don't manage. Screens that
// trusted it showed an unmanaged campaign's context while every endpoint 403'd ("guards on
// the pages, not the entry"). This hook resolves against the lead-filtered /admin/campaigns
// list (admins: the whole org, so it's a no-op for them):
//
//   useAdminCampaign(preferredId?) → undefined (resolving) | null (none/unmanaged) | campaign
//
// - With `preferredId` (a threaded ?campaignId= param): resolve THAT id from the list —
//   the pusher's context wins over the cache, and an unmanaged id comes back null.
// - Without: the cached pick, validated; a stale/unmanaged entry is cleared so the next
//   screen doesn't re-trip on it.
//
// Cache reads re-run on FOCUS, not mount — these are hidden Tabs.Screens that stay mounted,
// and a mount-once read shows the previous campaign after switching elsewhere (the same
// pattern notes.jsx/audit.jsx use). CampaignChip performs this same validation itself; use
// this hook ONLY where there's no chip.
export function useAdminCampaign(preferredId) {
  const [cached, setCached] = useState(undefined);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      loadActiveCampaign().then((c) => {
        if (mounted) setCached(c || null);
      });
      return () => {
        mounted = false;
      };
    }, [])
  );

  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const list = campaignsQ.data?.campaigns;
  const shape = (c) => ({ id: String(c._id), name: c.name, type: c.type, state: c.state, timeZone: c.timeZone });

  if (preferredId) {
    if (!list) return undefined;
    const c = list.find((x) => String(x._id) === String(preferredId));
    return c ? shape(c) : null;
  }
  if (cached === undefined) return undefined;
  if (!cached) return null;
  if (!list) return undefined;
  const ok = list.some((x) => String(x._id) === String(cached.id));
  if (!ok) {
    saveActiveCampaign(null); // drop the stale entry
    return null;
  }
  return cached;
}
