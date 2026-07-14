// Client mirror of the GPS-audit thresholds + display metadata for flag reasons and
// severities. The numbers here MUST stay in sync with the server source of truth at
// server/src/services/audit/flagThresholds.js (the browser can't import server ESM).
// Only the values the client actually needs are mirrored.
export const FLAG_THRESHOLDS = {
  FAR_WARN_M: 75, // "far" label threshold — matches the server (was an inconsistent 50/100 split)
  FAR_CONFIRM_M: 250,
  GPS_ACCURACY_WARN_M: 100,
};

export const FAR_WARN_M = FLAG_THRESHOLDS.FAR_WARN_M;

// The four flag reasons, in display order. `color` drives the map layer + badges; `short`
// is for chips/columns, `label` for panels.
// `countKey` maps to the server summary.totals field (which is camelCase).
export const REASON_META = [
  { key: 'far', countKey: 'far', short: 'Far', label: 'Far from house', color: '#ef4444', hint: 'Recorded far from the house pin' },
  { key: 'rapid', countKey: 'rapid', short: 'Rapid', label: 'Rapid succession', color: '#f97316', hint: 'Doors marked impossibly fast apart' },
  { key: 'one_spot', countKey: 'oneSpot', short: 'One-spot', label: 'One spot', color: '#8b5cf6', hint: 'Many doors from a single GPS spot' },
  { key: 'weak_gps', countKey: 'weakGps', short: 'Weak GPS', label: 'Weak / missing GPS', color: '#64748b', hint: 'Unreliable or missing location' },
];

export const REASON_BY_KEY = Object.fromEntries(REASON_META.map((r) => [r.key, r]));

export const SEV_RANK = { low: 1, med: 2, high: 3 };

// The worst reason on a flagged entry (highest severity, tie-broken by display order) —
// drives the flag's color on the map + the header accent in panels.
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

// Severity → badge styling (Tailwind tint classes used across the audit UI).
export const SEVERITY_META = {
  high: { label: 'High', dot: '#dc2626', chip: 'bg-danger-tint text-danger' },
  med: { label: 'Medium', dot: '#f59e0b', chip: 'bg-warning-tint text-warning-fg' },
  low: { label: 'Low', dot: '#9ca3af', chip: 'bg-sunken text-fg-muted' },
};

export const REVIEW_STATUS_META = {
  open: { label: 'Open', chip: 'bg-warning-tint text-warning-fg' },
  reviewed: { label: 'Reviewed', chip: 'bg-sunken text-fg-muted' },
  dismissed: { label: 'Dismissed', chip: 'bg-sunken text-fg-subtle' },
  confirmed: { label: 'Confirmed issue', chip: 'bg-danger-tint text-danger' },
};

// Display formatter for distances. The server stores/compares meters; users see feet,
// switching to miles once the distance reaches a mile. Mirrored in mobile/lib/geo.js
// (formatDistance) — keep the two in sync.
const FT_PER_M = 3.28084;
const FT_PER_MI = 5280;
export function formatDistanceImperial(meters) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  const ft = meters * FT_PER_M;
  if (ft < FT_PER_MI) return `${Math.round(ft).toLocaleString()} ft`;
  const mi = ft / FT_PER_MI;
  return `${mi >= 10 ? Math.round(mi) : mi.toFixed(1)} mi`;
}

// Human summary of an entry's reasons, e.g. "205 ft from house · 8 s between doors".
export function reasonDetailText(reason) {
  const d = reason.detail || {};
  switch (reason.type) {
    case 'far':
      return `${formatDistanceImperial(d.meters)} from house`;
    case 'rapid':
      return `${d.gapSec} s after the previous door`;
    case 'one_spot':
      return `${d.distinctHouseholds} doors from one spot${d.spanMin ? ` in ${d.spanMin} min` : ''}`;
    case 'weak_gps':
      if (d.missing) return 'no GPS captured';
      if (d.accuracy != null) return `GPS ±${formatDistanceImperial(d.accuracy)}`;
      return d.offline ? 'offline submission' : 'weak GPS';
    default:
      return '';
  }
}

const ACTION_LABELS = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  survey_submitted: 'Survey submitted',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  note_added: 'Note added',
};

// "Replaced “Restricted” recorded 4 min earlier from 20 ft away" — context line under a
// far flag whose row replaced the canvasser's own earlier entry at this door ("latest wins"
// deleted that row; the server stamps its snapshot into the far reason's detail). Null when
// the entry isn't a correction. Mirrored in mobile/lib/flags.js — keep the two in sync.
export function correctionContextText(entry) {
  const d = (entry?.reasons || []).find((r) => r.type === 'far')?.detail;
  if (!d?.priorActionType) return null;
  const label = ACTION_LABELS[d.priorActionType] || d.priorActionType;
  const min = d.minutesSincePrior;
  const when =
    min == null || min < 0 ? '' : min < 90 ? ` recorded ${min} min earlier` : ` recorded ${Math.round(min / 60)} h earlier`;
  const from = d.priorMeters == null ? ' (no GPS on the earlier entry)' : ` from ${formatDistanceImperial(d.priorMeters)} away`;
  return `Replaced “${label}”${when}${from}`;
}

// True when the far flag was downgraded to low because the correction's chain proves the
// canvasser was at the door recently (see server flagThresholds FAR_CORRECTION_WINDOW_MIN).
export function isDowngradedCorrection(entry) {
  return !!(entry?.reasons || []).find((r) => r.type === 'far')?.detail?.downgraded;
}
