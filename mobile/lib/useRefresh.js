import { useState, useCallback } from 'react';

// Drives a <RefreshControl> from one or more React Query refetch fns.
// Pass an array; falsy entries are skipped (e.g. a collapsed section's query).
// Uses manual `refreshing` state (not isRefetching) so the pull spinner only
// shows for user-initiated pulls, never for background interval refetches.
export function useRefresh(refetchers) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        (Array.isArray(refetchers) ? refetchers : [refetchers])
          .filter(Boolean)
          .map((fn) => fn())
      );
    } finally {
      setRefreshing(false);
    }
  }, [refetchers]);
  return { refreshing, onRefresh };
}
