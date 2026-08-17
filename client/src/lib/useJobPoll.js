import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { jobPollInterval, jobPct } from './jobPoll.js';

// Poll a TURF-queue job (generate / supplemental / claim) until it reaches a
// terminal state. One implementation of the terminal-state refetchInterval idiom
// that was copy-pasted across TurfsPage/ImportPage/ExportsPage — new job-backed
// flows should use this instead of hand-rolling the query.
//
// GET /turfs/jobs/:jobId serves ANY job on the TURF queue whose data carries this
// campaign (the route checks ownership), so claim jobs started from the Walk
// Lists page poll the same endpoint as cuts.
export const useJobPoll = ({ campaignId, jobId, intervalMs = 1200 }) => {
  const q = useQuery({
    queryKey: ['turf-job', campaignId, jobId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/jobs/${jobId}`),
    enabled: !!campaignId && !!jobId,
    refetchInterval: (query) => jobPollInterval(query.state.data?.status, intervalMs),
  });
  const status = q.data?.status || null;
  const progress = q.data?.progress;
  return {
    status,
    phase: typeof progress === 'object' ? progress?.phase : null,
    pct: jobPct(progress),
    result: q.data?.result || null,
    error: q.data?.error || null,
    // Busy from the moment a jobId exists until the job reports terminal — this
    // covers the gap before the first poll lands, so a double-click can't start
    // a second job while the first is still queued.
    busy: !!jobId && status !== 'completed' && status !== 'failed',
  };
};
