import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { focusManager } from '@tanstack/react-query';
import { groupNeedsRefresh, refetchEnabled } from './refreshGroup';

// Keeps a screen's report sections refreshing TOGETHER, so numbers that are read against each other
// never come from two different moments ("Passes add up to the 1,204 above" on the campaign screen;
// the door goal and Coverage, both all-time door counts). Pass the useQuery results of the group:
//
//   useRefreshGroup([rollupQ, roundsQ, …], { maxAgeMs: 30_000, pollMs: embedded ? 30_000 : null })
//
// - On focus, and when the app comes back from the background, it refetches the whole group if any
//   enabled section is older than maxAgeMs (the rule lives in refreshGroup.js, unit-tested).
// - With pollMs, ONE timer refetches the whole group every pollMs while the screen is in view and the
//   app is in the foreground. Not a refetchInterval per query: each query restarts its own timer on
//   every update, and a filter change restarts some of them and not others, so per-query timers drift
//   apart. Ticks refetch unconditionally — a tick gated on a pollMs-old age would skip every other
//   tick, because the data is always one round trip younger than the interval.
// - The queries themselves should spread useFocusedPoll(), so they stop notifying while covered.
//
// Why it's built this way (docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §E.3):
// - The results reach the focus callback through a ref fed by an effect declared BEFORE the focus
//   effect (passive effects run in declaration order), never written during render. The callback is
//   then stable, so it runs on focus — keyed on the results it would re-run on every render, which
//   offline measured 44 fetches in 3 s for one query.
// - result.refetch is bound to its observer and always fetches the observer's CURRENT key, so a
//   result read from the ref can never refetch an old filter.
// - Navigation focus doesn't fire when the app returns from the background (refetchOnWindowFocus is
//   off app-wide), so the foreground run listens to focusManager — the instance app/_layout.jsx
//   drives from AppState. Its listener fires on both transitions; only `focused` runs.
// - Not queryClient.refetchQueries({ type: 'active' }): on focus the observers haven't re-subscribed
//   yet (useFocusedPoll flips them back on in the next render), so it would refetch nothing.
export const useRefreshGroup = (results, { maxAgeMs = 30_000, pollMs = null } = {}) => {
  const ref = useRef(results);
  useEffect(() => {
    ref.current = results;
  });

  useFocusEffect(
    useCallback(() => {
      const refreshIfStale = () => {
        if (groupNeedsRefresh(ref.current, maxAgeMs, Date.now())) refetchEnabled(ref.current);
      };
      refreshIfStale();
      const unsubscribe = focusManager.subscribe((focused) => {
        if (focused) refreshIfStale();
      });
      const timer = pollMs
        ? setInterval(() => {
            if (focusManager.isFocused()) refetchEnabled(ref.current);
          }, pollMs)
        : null;
      return () => {
        unsubscribe();
        if (timer) clearInterval(timer);
      };
    }, [maxAgeMs, pollMs])
  );
};
