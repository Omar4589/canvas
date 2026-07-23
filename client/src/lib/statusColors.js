// Single source of truth for the door-status palette — mirrors mobile/lib/theme.js's
// `status` block. These are literal hexes (NOT CSS-var tokens) because they drive
// Mapbox paint expressions and canvas ImageData, which can't read CSS variables.
// Consumed by the map layers, MapFilters, CoverageBar, and the chart wrappers.

export const STATUS_COLORS = {
  unknocked: '#9ca3af', // gray-400
  not_home: '#3b82f6', // blue-500
  surveyed: '#22c55e', // green-500
  wrong_address: '#ef4444', // red-500
  refused: '#f59e0b', // amber-500
  lit_dropped: '#a855f7', // purple-500
  restricted: '#475569', // slate-600 — inaccessible/blocked home
  voted: '#14b8a6', // teal-500
  dnc: '#9f1239', // rose-800 — do not contact
};

export const STATUS_LABELS = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  voted: 'Voted',
  dnc: 'Do not contact',
};

// On a dark basemap the unknocked gray (#9ca3af) is too low-contrast; lighten it.
// Every other status stays vivid enough on both light and dark basemaps.
export function statusColorsForTheme(dark) {
  return dark ? { ...STATUS_COLORS, unknocked: '#d1d5db' } : STATUS_COLORS;
}

// ACTION type → label. Distinct from STATUS_LABELS above: an action is what a canvasser
// RECORDED at a door ('survey_submitted'), a status is what the door IS as a result
// ('surveyed'). Lives here so the two label maps stay side by side — this one had drifted
// into private copies in HouseholdDetailPanel and lib/flags.js before it was pulled out.
export const ACTION_LABELS = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  survey_submitted: 'Survey submitted',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  note_added: 'Note added',
};

export const actionLabel = (t) => ACTION_LABELS[t] || t || '—';
