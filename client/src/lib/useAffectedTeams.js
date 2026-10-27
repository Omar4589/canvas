import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// The client-report teams whose numbers a crew change moves, for a Move to crew… or an add
// (GET /admin/client-reports/series/affected, the call CoordinatorConfirm makes for one person). One
// query; the route takes 50 coordinators a call, so a longer list is asked in parts and joined.
// `ids` is sorted (lib/crewChange.js), which makes it a stable key.
const PER_CALL = 50;

export const useAffectedTeams = (campaignId, ids, enabled = true) =>
  useQuery({
    queryKey: ['admin', 'client-report-affected-teams', campaignId, ids.join(',')],
    queryFn: async ({ signal }) => {
      const parts = [];
      for (let i = 0; i < ids.length; i += PER_CALL) parts.push(ids.slice(i, i + PER_CALL));
      const answers = await Promise.all(
        parts.map((p) => api(`/admin/client-reports/series/affected?campaignId=${campaignId}&coordinatorIds=${p.join(',')}`, { signal }))
      );
      const bySeries = new Map();
      for (const t of answers.flatMap((a) => a?.teams || [])) bySeries.set(String(t.seriesId), t);
      return { teams: [...bySeries.values()].sort((a, b) => String(a.label).localeCompare(String(b.label))) };
    },
    enabled: !!campaignId && enabled && ids.length > 0,
    retry: false,
    staleTime: 30 * 1000,
  });

// "Paid team", "Paid team and Volunteer team", "A, B and C".
export const teamLabelsLine = (q) => {
  const labels = (q.data?.teams || []).map((t) => t.label).filter(Boolean);
  if (!labels.length) return null;
  const list = labels.length < 2 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `This also changes the numbers in the ${list} client report${labels.length === 1 ? '' : 's'}.`;
};
