// Mobile mirror of the GPS-audit flag display metadata (ported from client/src/lib/flags.js,
// which mirrors server/src/services/audit/flagThresholds.js). RN can't import the web/server
// modules, so the values are duplicated; keep them in sync. Reason colors are literal hex
// (theme-independent, like the door-status palette); review-status/severity carry a `tone` that
// components resolve against the theme (colors.warnBg/danger/etc.).

export const FLAG_THRESHOLDS = {
  FAR_WARN_M: 75,
  FAR_CONFIRM_M: 250,
  GPS_ACCURACY_WARN_M: 100,
};
export const FAR_WARN_M = FLAG_THRESHOLDS.FAR_WARN_M;

// The four flag reasons, in display order. `color` drives the map dots + badges.
// `countKey` maps to the server summary.totals field (camelCase).
export const REASON_META = [
  { key: 'far', countKey: 'far', short: 'Far', label: 'Far from house', color: '#ef4444', hint: 'Recorded far from the house pin' },
  { key: 'rapid', countKey: 'rapid', short: 'Rapid', label: 'Rapid succession', color: '#f97316', hint: 'Doors marked impossibly fast apart' },
  { key: 'one_spot', countKey: 'oneSpot', short: 'One-spot', label: 'One spot', color: '#8b5cf6', hint: 'Many doors from a single GPS spot' },
  { key: 'weak_gps', countKey: 'weakGps', short: 'Weak GPS', label: 'Weak / missing GPS', color: '#64748b', hint: 'Unreliable or missing location' },
];

export const REASON_BY_KEY = Object.fromEntries(REASON_META.map((r) => [r.key, r]));

export const SEV_RANK = { low: 1, med: 2, high: 3 };

// Worst reason on an entry (highest severity, tie-broken by display order) — drives the
// map dot color + the card accent.
export function primaryReason(entry) {
  const reasons = entry?.reasons || [];
  if (!reasons.length) return null;
  const order = REASON_META.map((r) => r.key);
  return [...reasons].sort((a, b) => {
    const s = (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
    return s || order.indexOf(a.type) - order.indexOf(b.type);
  })[0];
}

export function reasonLabel(type) {
  return REASON_BY_KEY[type]?.label || type;
}
export function reasonColor(type) {
  return REASON_BY_KEY[type]?.color || '#888';
}

// Severity dot colors (theme-independent hex, like the reason palette).
export const SEVERITY_META = {
  high: { label: 'High', dot: '#dc2626' },
  med: { label: 'Medium', dot: '#f59e0b' },
  low: { label: 'Low', dot: '#9ca3af' },
};

// Review status → { label, tone }. `tone` is resolved to theme colors by the pill component.
export const REVIEW_STATUS_META = {
  open: { label: 'Open', tone: 'warn' },
  reviewed: { label: 'Reviewed', tone: 'muted' },
  dismissed: { label: 'Dismissed', tone: 'subtle' },
  confirmed: { label: 'Confirmed issue', tone: 'danger' },
};

// tone → { bg, fg } from the theme. Kept here so the pill + any caller stay consistent.
export function reviewToneColors(colors, tone) {
  switch (tone) {
    case 'danger':
      return { bg: colors.dangerBg, fg: colors.danger };
    case 'warn':
      return { bg: colors.warnBg, fg: colors.warnFg };
    case 'subtle':
      return { bg: colors.sunken, fg: colors.textMuted };
    case 'muted':
    default:
      return { bg: colors.sunken, fg: colors.textSecondary };
  }
}

// Human summary of a reason, e.g. "62 m from house".
export function reasonDetailText(reason) {
  const d = reason.detail || {};
  switch (reason.type) {
    case 'far':
      return `${Math.round(d.meters)} m from house`;
    case 'rapid':
      return `${d.gapSec} s after the previous door`;
    case 'one_spot':
      return `${d.distinctHouseholds} doors from one spot${d.spanMin ? ` in ${d.spanMin} min` : ''}`;
    case 'weak_gps':
      if (d.missing) return 'no GPS captured';
      if (d.accuracy != null) return `GPS ±${Math.round(d.accuracy)} m`;
      return d.offline ? 'offline submission' : 'weak GPS';
    default:
      return '';
  }
}
