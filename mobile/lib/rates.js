// The rate tiers, ordered best-first — the ONE place the thresholds live. The two rate
// functions below both derive their level from this, and the Activity group prints `word`
// and `range` straight from it, so the number that colors the chip and the words that
// explain it can never drift apart. Kept beside makeRateColors for the same reason.
export const RATE_TIERS = [
  { level: 'good', min: 20, word: 'On target', range: '20% and up' },
  { level: 'caution', min: 10, word: 'Watch', range: '10–19%' },
  { level: 'low', min: 0, word: 'Low', range: 'under 10%' },
];

const levelForPct = (pct) => RATE_TIERS.find((t) => pct >= t.min)?.level || 'low';

// The tier's plain-English word ('On target' / 'Watch' / 'Low'), for the rate row's sub-line.
export const tierWord = (level) => RATE_TIERS.find((t) => t.level === level)?.word || '';

// Tiered connection rate = surveyed homes ÷ knocked homes (callers pass DISTINCT-HOME counts),
// so it's bounded ≤100% and matches the admin/report rate — a home with 2 voters surveyed reads
// 100%, not 200%. Returns null when there's no data to ratio (avoids showing 0% when the truth is
// "haven't started yet"). The Math.min is a belt-and-suspenders guard. Tiers: see RATE_TIERS.
export function getConnectionRate(numerator, denominator) {
  if (!denominator) return null;
  const pct = Math.min(100, Math.round(((numerator || 0) / denominator) * 100));
  return { value: `${pct}%`, level: levelForPct(pct), pct };
}

// Same tiered shape, built from a precomputed percentage (the server's connectionRate,
// which is already "completion knocks ÷ knocks" and capped at 100). Returns null when the
// server has no rate yet (null), so we show "—" rather than a misleading 0%.
export function rateFromPct(pct) {
  if (pct == null) return null;
  return { value: `${pct}%`, level: levelForPct(pct), pct };
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
//
// `fg` is the vivid brand-y hue — right for a LARGE numeral or an icon, where the WCAG floor
// is 3:1. `deep` is the same tier darkened (lightened, in dark mode) to clear 4.5:1 against
// its own `bg`, and is what small text on a tint must use: `success` on `successBg` is only
// 3.00:1 and `danger` on `dangerBg` 3.08:1, so a 13pt label in `fg` on `bg` fails. Pick by
// size, not by taste — see docs/THEMING.md.
export function makeRateColors(colors) {
  return {
    good: { bg: colors.successBg, fg: colors.success, deep: colors.successFg },
    caution: { bg: colors.warnBg, fg: colors.warnFg, deep: colors.warnFg },
    low: { bg: colors.dangerBg, fg: colors.danger, deep: colors.dangerFg },
  };
}
