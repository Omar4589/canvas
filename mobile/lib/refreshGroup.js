// The rules behind useRefreshGroup (the hook that keeps a screen's report sections refreshing
// TOGETHER), kept out of the hook so they can be tested: CI runs `npm run test:mobile` with no mobile
// install, so a module a test loads may import nothing at all (see .github/workflows/tests.yml).
//
// `results` are react-query results (useQuery's return values). Only three fields are read here:
// isEnabled, dataUpdatedAt and errorUpdatedAt — plus refetch, in refetchEnabled.

// Does the group need a refresh? True when any enabled section is older than `maxAgeMs`.
//
// Age counts from the LATER of the last success and the last failure. A failed refetch leaves
// dataUpdatedAt where it was, so measuring from data alone would keep a section that keeps failing
// (an old server during an app rollout, a weak signal) "stale" forever and refetch the whole group
// on every return to the screen. A query that has never run reads 0 for both, so it counts as stale.
export const groupNeedsRefresh = (results, maxAgeMs, now) =>
  (results || []).some(
    (r) => r && r.isEnabled !== false && now - Math.max(r.dataUpdatedAt || 0, r.errorUpdatedAt || 0) > maxAgeMs
  );

// Refetch every enabled section. Two library defaults would bite here: refetch() ignores `enabled`
// (a lit-drop campaign would fetch survey results it never shows), and it defaults to
// cancelRefetch: true, which cancels a fetch already in flight and starts another — the screen's
// queryFns pass no abort signal, so the cancelled request still runs on the server, twice the cost
// for the heaviest one. cancelRefetch: false joins the fetch in flight instead.
export const refetchEnabled = (results) =>
  Promise.all(
    (results || []).filter((r) => r && r.isEnabled !== false).map((r) => r.refetch({ cancelRefetch: false }))
  );
