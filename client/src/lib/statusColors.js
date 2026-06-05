// Single source of truth for the door-status palette — mirrors mobile/lib/theme.js's
// `status` block. These are literal hexes (NOT CSS-var tokens) because they drive
// Mapbox paint expressions and canvas ImageData, which can't read CSS variables.
// Consumed by the map layers, MapFilters, CoverageBar, and the chart wrappers.

export const STATUS_COLORS = {
  unknocked: '#9ca3af', // gray-400
  not_home: '#3b82f6', // blue-500
  surveyed: '#22c55e', // green-500
  wrong_address: '#ef4444', // red-500
  lit_dropped: '#a855f7', // purple-500
  voted: '#14b8a6', // teal-500
};

export const STATUS_LABELS = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
  voted: 'Voted',
};

// On a dark basemap the unknocked gray (#9ca3af) is too low-contrast; lighten it.
// Every other status stays vivid enough on both light and dark basemaps.
export function statusColorsForTheme(dark) {
  return dark ? { ...STATUS_COLORS, unknocked: '#d1d5db' } : STATUS_COLORS;
}
