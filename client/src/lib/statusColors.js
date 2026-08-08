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
  no_soliciting: '#db2777', // pink-600 — a posted sign ended the visit
  voted: '#14b8a6', // teal-500
  dnc: '#9f1239', // rose-800 — do not contact
  doNotKnock: '#4c0519', // rose-950 — address-level "never come back"; darker than dnc on purpose
};

export const STATUS_LABELS = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  no_soliciting: 'No soliciting',
  voted: 'Voted',
  dnc: 'Do not contact',
  doNotKnock: 'Do not knock',
};

// On a dark basemap the unknocked gray (#9ca3af) is too low-contrast; lighten it.
// Every other status stays vivid enough on both light and dark basemaps.
export function statusColorsForTheme(dark) {
  return dark ? { ...STATUS_COLORS, unknocked: '#d1d5db' } : STATUS_COLORS;
}

// ACTION type → label. Distinct from STATUS_LABELS above: an action is what a canvasser
// RECORDED at a door ('survey_submitted'), a status is what the door IS as a result
// ('surveyed'). Lives here so the two label maps stay side by side.
//
// This had drifted into seven private copies across web and mobile, with `survey_submitted`
// reading "Survey submitted" on audit surfaces, "Surveyed" in activity feeds and "Survey" in
// notes lists. Canonical wording is now "Surveyed" — it matches STATUS_LABELS.surveyed, so an
// action and the status it produces finally read the same. Mirrored in mobile/lib/theme.js;
// keep the two in sync.
//
// NOT the same thing as the ACTION_PIN / ACTION_TO_PIN maps on mobile, which translate an
// action enum into a STATUS key to pick a pin icon ('survey_submitted' → 'surveyed'). Those
// are semantic, not display text — never fold them into this.
export const ACTION_LABELS = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  survey_submitted: 'Surveyed',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  no_soliciting: 'No soliciting',
  note_added: 'Note added',
};

export const actionLabel = (t) => ACTION_LABELS[t] || t || '—';
