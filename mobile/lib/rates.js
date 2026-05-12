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

export const RATE_COLORS = {
  good: { bg: colors.successBg, fg: colors.success },
  caution: { bg: colors.warnBg, fg: '#92400E' },
  low: { bg: colors.dangerBg, fg: colors.danger },
};
