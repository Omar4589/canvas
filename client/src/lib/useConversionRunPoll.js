import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { jobPollInterval, jobPct, RUN_TERMINAL } from './jobPoll.js';

// Poll a survey-conversion run until it settles. Same idiom as useJobPoll, but it reads the RUN
// DOC rather than the BullMQ job — which is what makes a foreign run id a structural 404 (the
// route scopes by {_id, campaignId, organizationId}) instead of an ownership check somebody has to
// remember to write.
//
// 'open' counts as terminal for polling: a door-by-door session advances on a user action, not on
// a worker tick, so there is nothing to wait for between steps.
export const useConversionRunPoll = ({ campaignId, runId, intervalMs = 1200 }) => {
  const q = useQuery({
    queryKey: ['survey-conversion', campaignId, runId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/survey-conversions/${runId}`),
    enabled: !!campaignId && !!runId,
    refetchInterval: (query) => jobPollInterval(query.state.data?.run?.status, intervalMs, RUN_TERMINAL),
  });
  const run = q.data?.run || null;
  return {
    run,
    status: run?.status || null,
    pct: jobPct(run?.progress),
    phase: run?.progress?.phase || null,
    busy: !!runId && !RUN_TERMINAL.includes(run?.status),
  };
};
