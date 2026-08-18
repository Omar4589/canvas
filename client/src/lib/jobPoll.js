// Pure halves of the job-poll hook (useJobPoll.js) — kept dependency-free so the
// node --test sweep can exercise them without pulling react-query into Node.

// The stop-polling decision: keep polling (the interval) until the job reports a
// terminal status, then stop (false — react-query's "don't refetch").
//
// `terminal` is overridable because not every job-shaped thing shares BullMQ's two end states: a
// survey-conversion run also settles at 'reverted', and rests at 'open' between door-by-door steps
// (which is terminal for polling purposes — the next step is a user action, not a worker tick).
export const JOB_TERMINAL = ['completed', 'failed'];
export const RUN_TERMINAL = ['completed', 'failed', 'reverted', 'open'];

export const jobPollInterval = (status, intervalMs = 1200, terminal = JOB_TERMINAL) =>
  terminal.includes(status) ? false : intervalMs;

// BullMQ progress starts life as the number 0 and becomes our {phase, pct}
// object on the first updateProgress — normalize both shapes.
export const jobPct = (progress) => (typeof progress === 'object' ? progress?.pct : progress);
