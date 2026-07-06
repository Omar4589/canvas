import { useIsFocused } from '@react-navigation/native';

// Options for a react-query query that polls only while its screen is visible.
// expo-router keeps screens mounted (Tabs forever, stack bases under pushed
// screens), so a bare refetchInterval keeps firing when covered. Spread this
// into useQuery alongside the query's own refetchInterval:
//
//   useQuery({ queryKey, queryFn, refetchInterval: 30_000, ...useFocusedPoll() })
//
// - subscribed:false when unfocused destroys the observer, stopping the poll;
//   refocus re-subscribes and refetches if stale.
// - staleTime keeps a refocus within the window from firing a redundant fetch
//   (returning right after the last poll shows cached data, no request storm).
// - gcTime holds the cache well past the default 5min so a screen left covered
//   for a while doesn't blank to a cold loader on return.
export function useFocusedPoll(staleTime = 30 * 1000) {
  const isFocused = useIsFocused();
  return { subscribed: isFocused, staleTime, gcTime: 30 * 60 * 1000 };
}
