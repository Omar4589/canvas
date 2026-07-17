// Shared date-display helpers (mobile/lib/dates.js is the byte-parallel mirror — keep in sync).
//
// formatRelative previously existed as six drifted copies (day cutoff 7 vs 30 vs uncapped, NaN
// guard present/absent, 'Never' vs ''). The options preserve each surface's deliberate choices —
// UserProfileModal keeps its 7-day cutoff via { cutoffDays: 7 } — while the accidents (no NaN
// guard, '730d ago' forever) are fixed everywhere.

export function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRelative(d, { cutoffDays = 30, never = 'Never' } = {}) {
  if (!d) return never;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < cutoffDays) return `${day}d ago`;
  return formatDate(d);
}
