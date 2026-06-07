// Tiered connection rate. Returns null when there's no data to ratio (avoids
// showing 0% when the truth is "haven't started yet"). Tiers match canvasser
// expectations from prior screens — green ≥20%, amber 10-19%, red <10%.
export function getConnectionRate(numerator, denominator) {
  if (!denominator) return null;
  const pct = Math.round(((numerator || 0) / denominator) * 100);
  let level;
  if (pct >= 20) level = 'good';
  else if (pct >= 10) level = 'caution';
  else level = 'low';
  return { value: `${pct}%`, level, pct };
}

// Same tiered shape, built from a precomputed percentage (the server's connectionRate,
// which is already "completion knocks ÷ knocks" and capped at 100). Returns null when the
// server has no rate yet (null), so we show "—" rather than a misleading 0%.
export function rateFromPct(pct) {
  if (pct == null) return null;
  let level;
  if (pct >= 20) level = 'good';
  else if (pct >= 10) level = 'caution';
  else level = 'low';
  return { value: `${pct}%`, level, pct };
}

// Doors-per-hour over a shift, formatted. Returns '—' when there isn't enough to
// compute: no doors, missing first/last timestamps, or a shift shorter than 15
// minutes (too short to be a meaningful rate). Shared by the map HUD, My Stats,
// and the day-detail screen so they all read the pace the same way.
export function formatPace(doorsKnocked, firstDoorAt, lastDoorAt) {
  const knocked = doorsKnocked || 0;
  if (!knocked || !firstDoorAt || !lastDoorAt) return '—';
  const hours =
    (new Date(lastDoorAt).getTime() - new Date(firstDoorAt).getTime()) / 3600000;
  if (hours < 0.25) return '—';
  return `${(knocked / hours).toFixed(1)}/hr`;
}

// Theme-aware rate color map: pass the active palette from useTheme().
export function makeRateColors(colors) {
  return {
    good: { bg: colors.successBg, fg: colors.success },
    caution: { bg: colors.warnBg, fg: colors.warnFg },
    low: { bg: colors.dangerBg, fg: colors.danger },
  };
}
