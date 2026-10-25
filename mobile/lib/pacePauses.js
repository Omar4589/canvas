import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// Automatic pause on the phone's admin side (docs/PROPOSAL_PACE_PAUSE.md §G.3–G.4). One list query for the
// open pauses the viewer may see — every campaign for an org admin, the managed ones for a team lead (the server
// scopes it, and adds a roster line for a lead's canvasser paused on a campaign they don't manage) — shared by
// the Audit screen's Paused section and the Users list's badge, and the one refresh every unpause runs.
export const PAUSED_LIST_KEY = ['admin', 'pace-pauses', 'list', 'paused'];

export const usePausedList = ({ refetchInterval = false, ...options } = {}) =>
  useQuery({
    queryKey: PAUSED_LIST_KEY,
    queryFn: () => api('/admin/pace-pauses?status=paused'),
    refetchInterval,
    refetchIntervalInBackground: false,
    ...options,
  });

// Everything an unpause changes: the pause lists and detail, and the badges riding the campaigns list and the
// campaign rollup (admin/index.jsx, CampaignHome.jsx, more.jsx).
export const invalidatePaceCaches = (qc) =>
  qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey?.[0] === 'admin' &&
      (q.queryKey?.[1] === 'pace-pauses' ||
        q.queryKey?.[1] === 'campaigns' ||
        (q.queryKey?.[1] === 'reports' && q.queryKey?.[2] === 'campaign-rollup')),
  });
