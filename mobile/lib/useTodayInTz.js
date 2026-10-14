import { useEffect, useState } from 'react';
import { todayInTz } from './dateRanges';

// Today's date in `tz` ('YYYY-MM-DD'), worked out at render — so a tz that arrives late (device zone
// first, the campaign's once it loads) applies at once — and re-rendering the screen when the day
// changes, so a screen left open past midnight moves to the new day. Pair it with
// effectiveRange(pickedRange, useTodayInTz(tz)) (dateRanges.js).
//
// A screen only re-renders when something it reads changes, so computing today at render isn't
// enough on its own: the pushed campaign screen doesn't poll at all, and the org Overview's poll
// re-renders it only when its numbers change — the normal case overnight is that they don't. So this
// checks once a minute. (The embedded campaign home happens to re-render on every 30 s poll too,
// because useRefreshGroup reads each query's timestamps; this check doesn't rely on that.) setSeen
// with an unchanged string is skipped by React; a new day re-renders. The timer is cleared on unmount
// and restarted when tz changes.
export const useTodayInTz = (tz) => {
  const today = todayInTz(tz);
  const [, setSeen] = useState(today);
  useEffect(() => {
    const timer = setInterval(() => setSeen(todayInTz(tz)), 60_000);
    return () => clearInterval(timer);
  }, [tz]);
  return today;
};
