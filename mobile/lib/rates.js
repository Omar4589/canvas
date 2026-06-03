import { colors } from './theme';

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

export const RATE_COLORS = {
  good: { bg: colors.successBg, fg: colors.success },
  caution: { bg: colors.warnBg, fg: '#92400E' },
  low: { bg: colors.dangerBg, fg: colors.danger },
};
