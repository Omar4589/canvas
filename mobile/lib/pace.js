// Automatic pause on the phone (docs/PROPOSAL_PACE_PAUSE.md §E). The server pauses a canvasser whose doors
// come in faster than anyone could knock them, and says so as `pace: { paused, at }` (`at` the server's
// clock) on the bootstrap, the 30s /changes delta, every recording response, a PACE_PAUSED refusal and
// GET /mobile/pace. The phone keeps the newest answer inside the cached bootstrap (file-backed, so it
// survives restarts and dead zones); setPace (lib/recordAction.js) is its one writer and these are its
// rules — pure, so node can test them (pace.test.js).

export const PACE_TITLE = 'Recording paused';
export const PACE_MESSAGE = 'Recording is paused for review. Call your team lead.';
// The write that created the pause was saved; the next one won't be.
export const PACE_TIPPED_MESSAGE = 'That door was saved. Recording is now paused for review. Call your team lead.';
export const PACE_CHECK_FAILED = "Can't check right now — move to where you have signal and tap Check again.";
// The canvasser Help article the banner links to (server/src/content/help/faq/).
export const PACE_HELP_SLUG = 'why-is-recording-paused';

const isAnswer = (p) => !!p && typeof p.paused === 'boolean';
const stampOf = (p) => {
  const t = Date.parse(p?.at);
  return Number.isFinite(t) ? t : null;
};

// The newer of the held answer and an incoming one, by the server's clock: a slow reply that left the
// server before a newer one landed must never undo it. Equal times take the incoming answer. A malformed
// answer never wins, and neither does one without a time over one that has it. `tipped` is a moment, not
// state, so it is never kept.
export const newerPace = (held, next) => {
  if (!isAnswer(next)) return isAnswer(held) ? held : null;
  const incoming = { paused: next.paused, at: next.at ?? null };
  if (!isAnswer(held)) return incoming;
  const h = stampOf(held);
  const n = stampOf(next);
  if (n == null) return h == null ? incoming : held;
  if (h != null && n < h) return held;
  return incoming;
};

// The bootstrap with an answer folded in — the very same object when nothing changed, so a no-op answer
// never re-renders the map or rewrites the snapshot on disk.
export const withPace = (data, pace) => {
  if (!data || !isAnswer(pace)) return data;
  const held = data.pace;
  const next = newerPace(held, pace);
  if (next === held || (isAnswer(held) && next.paused === held.paused && next.at === held.at)) return data;
  return { ...data, pace: next };
};

// Is this phone's canvasser paused? Read from the cached bootstrap. A server older than automatic pause sends
// no `pace`, and that reads as not paused; so does anyone the rule doesn't judge (admins and team leads).
export const isPaused = (data) => data?.pace?.paused === true;

// The local block inside optimisticSubmit (§E.3): door results, surveys and the walk-up add stop here while
// paused. Pin fixes (`requireFix: false`) never do — map hygiene stays possible.
export const blocksRecording = (data, { requireFix = true } = {}) => requireFix && isPaused(data);

// A flushed queue item's answer speaks for the active org only: an item pinned to another org (a multi-org
// canvasser who switched since recording) was answered about THAT org. An item from before the pin existed
// flushes under the active org, so its answer is about it.
export const flushAnswerApplies = (item, activeOrgId) => !item?.orgId || String(item.orgId) === String(activeOrgId ?? '');

// The admin side (§G.3–G.4): who is paused right now, from GET /admin/pace-pauses?status=paused — a pause that
// blocks (an active canvasser while automatic pause runs for the org), or, for a team lead, a roster line (their
// canvasser paused on a campaign they don't manage). The Users list's badge reads this.
export const pausedUserIds = (data) =>
  new Set([
    ...(data?.pauses || []).filter((p) => p.status === 'paused' && p.blocking).map((p) => String(p.userId)),
    ...(data?.rosterLines || []).filter((l) => l.paused).map((l) => String(l.userId)),
  ]);
