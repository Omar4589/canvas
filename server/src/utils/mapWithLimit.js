// Run `fn` over `items`, at most `limit` at a time, and return the answers in input order. For work
// that is independent per item but shouldn't all hit the database at once — the crew jobs of one
// request (services/memberships/setCoordinator.js): ten at once filled the 20-connection pool and kept
// other requests waiting; four at a time is as fast and leaves room.
export const mapWithLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
};
