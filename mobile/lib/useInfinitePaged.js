import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';

// Shared "Load more" pagination for server lists that speak the super-admin paging contract:
// clamped skip/limit params + an exact countDocuments `total` in the response. Modeled on the
// notes.jsx useInfiniteQuery shape; house style keeps an explicit Load-more button (no onEndReached).
//
//   const usersQ = useInfinitePaged(
//     ['super-admin', 'users', q], '/super-admin/users', { q },
//     { limit: 50, itemsKey: 'users' }
//   );
//   → usersQ.items (flattened), usersQ.total, usersQ.hasNextPage, usersQ.fetchNextPage, …
//
// TRAP: because the URL is built HERE, the endpoint literal never appears at an api() call site —
// and scripts/mobile-api-surface.mjs finds mobile's server dependencies by grepping for exactly
// that. Endpoints consumed only through this helper are INVISIBLE to `npm run audit:mobile-api`
// (/super-admin/users and /super-admin/emails are both missing from --list today). So a route file
// reachable only this way can be wrongly cleared as "not mobile-facing". If that matters for a
// given screen, write the useInfiniteQuery inline with a literal path instead — see
// admin/duplicate-surveys.jsx, which does exactly that and says why.
export function useInfinitePaged(queryKey, path, params = {}, options = {}) {
  const { limit = 25, itemsKey = 'items', ...queryOpts } = options;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
      }
      p.set('skip', String(pageParam));
      p.set('limit', String(limit));
      return api(`${path}?${p.toString()}`);
    },
    // Next pageParam is the count of rows already loaded — i.e. the next `skip`.
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, pg) => n + (pg[itemsKey]?.length || 0), 0);
      return loaded < (lastPage.total || 0) ? loaded : undefined;
    },
    ...queryOpts,
  });
  const pages = query.data?.pages || [];
  const items = pages.flatMap((pg) => pg[itemsKey] || []);
  const total = pages.length ? pages[pages.length - 1].total || 0 : 0;
  return { ...query, items, total };
}
