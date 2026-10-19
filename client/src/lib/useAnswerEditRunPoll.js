import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { isAnswerEditSettled } from './answerEditPlan.js';

// Poll one answer-edit run until it settles — its apply phase OR its undo, whichever is moving.
// Reads the run doc (scoped server-side by campaign and organization, so a foreign id is a 404),
// the useConversionRunPoll idiom. An open one-person session is settled: it advances on a click,
// not a worker tick.
export const useAnswerEditRunPoll = ({ campaignId, runId, intervalMs = 1200 }) => {
  const q = useQuery({
    queryKey: ['answer-edit', campaignId, runId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/answer-edits/${runId}`),
    enabled: !!campaignId && !!runId,
    refetchInterval: (query) => (isAnswerEditSettled(query.state.data?.run) ? false : intervalMs),
  });
  const run = q.data?.run || null;
  return { run, settled: isAnswerEditSettled(run), error: q.error || null };
};
