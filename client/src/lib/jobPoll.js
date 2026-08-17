// Pure halves of the job-poll hook (useJobPoll.js) — kept dependency-free so the
// node --test sweep can exercise them without pulling react-query into Node.

// The stop-polling decision: keep polling (the interval) until the job reports a
// terminal status, then stop (false — react-query's "don't refetch").
export const jobPollInterval = (status, intervalMs = 1200) =>
  status === 'completed' || status === 'failed' ? false : intervalMs;

// BullMQ progress starts life as the number 0 and becomes our {phase, pct}
// object on the first updateProgress — normalize both shapes.
export const jobPct = (progress) => (typeof progress === 'object' ? progress?.pct : progress);
