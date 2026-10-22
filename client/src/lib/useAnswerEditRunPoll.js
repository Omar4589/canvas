import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { isAnswerEditSettled, isAnswerEditWaiting } from './answerEditPlan.js';

// A run poll's error that ends it: a 4xx is the server's answer about the run; anything else (a
// 5xx, the network) is worth asking again.
export const gaveUp = (query) => {
  if (query.state.status !== 'error') return false;
  const s = query.state.error?.status;
  return s >= 400 && s < 500;
};

// Poll one answer-edit run until it settles — its apply phase OR its undo, whichever is moving.
// Reads the run doc (scoped server-side by campaign and organization, so a foreign id is a 404),
// the useConversionRunPoll idiom. An open one-person session is settled: it advances on a click,
// not a worker tick.
const WAITING_POLL_MS = 15000;

export const useAnswerEditRunPoll = ({ campaignId, runId, intervalMs = 1200 }) => {
  const q = useQuery({
    queryKey: ['answer-edit', campaignId, runId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/answer-edits/${runId}`),
    enabled: !!campaignId && !!runId,
    // Stops on a refusal (a run that's gone — a 404 after a campaign switch — has nothing to poll),
    // never on a blip: a dyno restart or a dropped connection keeps the last answer and polls on,
    // or the card froze on "Working" for good (code review round 2).
    // A run waiting on the worker, or stopped responding, moves only when the worker comes back or on Start
    // again (whose reply restarts this poll — followEditRun): read every 15 s, not every second, now that its
    // card comes back on every visit (code review of 12b56fa).
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      if (gaveUp(query) || isAnswerEditSettled(run)) return false;
      return isAnswerEditWaiting(run) ? WAITING_POLL_MS : intervalMs;
    },
  });
  const run = q.data?.run || null;
  // `stopped`: the poll ended on a refusal, so the card shows the last answer it got — with a way
  // to dismiss it even mid-run (round 3: a card frozen on "Working" had no button at all).
  const stopped = q.status === 'error' && q.error?.status >= 400 && q.error?.status < 500;
  return { run, settled: isAnswerEditSettled(run), error: q.error || null, stopped };
};
