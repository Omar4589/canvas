// Client mirror of the GPS-audit thresholds + display metadata for flag reasons and
// severities. The numbers here MUST stay in sync with the server source of truth at
// server/src/services/audit/flagThresholds.js (the browser can't import server ESM).
// Only the values the client actually needs are mirrored.
import { ACTION_LABELS } from './statusColors.js';

export const FLAG_THRESHOLDS = {
  FAR_WARN_M: 75, // "far" label threshold — matches the server (was an inconsistent 50/100 split)
  FAR_CONFIRM_M: 250,
  GPS_ACCURACY_WARN_M: 100,
};

export const FAR_WARN_M = FLAG_THRESHOLDS.FAR_WARN_M;

// The five flag reasons, in display order. `color` drives the map layer + badges; `short`
// is for chips/columns, `label` for panels.
// `countKey` maps to the server summary.totals field (which is camelCase).
// mock_gps is FIRST on purpose: display order is primaryReason's tie-break, and a mock
// fix is the strongest signal (always high severity) — a mock+far entry colors as mock.
export const REASON_META = [
  { key: 'mock_gps', countKey: 'mockGps', short: 'Mock', label: 'Mock location', color: '#db2777', hint: 'Fix came from a mock-location app' },
  { key: 'far', countKey: 'far', short: 'Far', label: 'Far from house', color: '#ef4444', hint: 'Recorded far from the house pin' },
  { key: 'rapid', countKey: 'rapid', short: 'Rapid', label: 'Rapid succession', color: '#f97316', hint: 'Doors marked impossibly fast apart' },
  { key: 'one_spot', countKey: 'oneSpot', short: 'One-spot', label: 'One spot', color: '#8b5cf6', hint: 'Many doors from a single GPS spot' },
  { key: 'weak_gps', countKey: 'weakGps', short: 'Weak GPS', label: 'Weak / missing GPS', color: '#64748b', hint: 'Unreliable or missing location' },
];

export const REASON_BY_KEY = Object.fromEntries(REASON_META.map((r) => [r.key, r]));

// Plain-language legend for the (i) affordances on the audit surfaces. Labels come from
// REASON_META (REASON_BY_KEY[key].label); distances in FEET to match the rest of the UI
// (feet values derive from the server thresholds: 75 m ≈ 250 ft, 100 m ≈ 330 ft,
// 250 m ≈ 820 ft). Mirrored in mobile/lib/flags.js — keep the two in sync.
export const FLAG_LEGEND = [
  {
    key: 'mock_gps',
    text: 'The phone itself reported that the location came from a fake-GPS app. Always high severity. Only Android reports this signal — an iPhone entry never carries it.',
  },
  {
    key: 'far',
    text: 'Recorded ~250 ft or more from the house pin after allowing for GPS accuracy; ~820 ft or more is high. An honest same-day correction of an entry made at the door shows as low.',
  },
  {
    key: 'rapid',
    text: 'Two different doors recorded under 20 s apart — too fast to have walked between them. Under 8 s is high.',
  },
  {
    key: 'one_spot',
    text: "4 or more different houses logged from one point while the houses themselves are spread out. Apartment buildings — many units at one spot — deliberately don't trip this.",
  },
  {
    key: 'weak_gps',
    text: "The location reading itself can't be trusted, for one of four reasons:",
    kinds: [
      { label: 'No location', text: 'older entries recorded before the app required location — recording now requires it.' },
      { label: 'Poor accuracy', text: 'the GPS fix was worse than ~330 ft (medium) or ~820 ft (high).' },
      { label: 'Stale fix', text: 'the GPS reading was taken well before the door was recorded — 5+ min is medium, 30+ min is high.' },
      { label: 'Synced offline', text: 'low severity — the phone had no signal at tap time. Location was on and the stamp is real; only the timestamp is device-reported.' },
    ],
  },
];
export const FLAG_LEGEND_FOOTER =
  'Severity: low is context worth a glance, medium is worth a look, high is a strong signal. Counts show OPEN flags — reviewing, dismissing, or confirming clears them from the count, never the data.';

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
      if (d.stale && d.fixAgeSec != null) return `GPS fix ${Math.round(d.fixAgeSec / 60)} min before recording`;
      // Accuracy is only the story when it's the actual problem — the server stamps a
      // non-null accuracy on ANY fix, so an offline-only flag with a perfect fix must
      // read as offline, not as if its (good) accuracy were suspect.
      if (d.accuracy != null && d.accuracy > FLAG_THRESHOLDS.GPS_ACCURACY_WARN_M)
        return `GPS ±${formatDistanceImperial(d.accuracy)}`;
      if (d.offline) return 'offline submission';
      return 'weak GPS';
    case 'mock_gps':
      return 'mock location provider';
    default:
      return '';
  }
}

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
