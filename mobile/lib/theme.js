// Doorline design tokens.
//
// Use these for everything (colors, type, spacing, radius, shadow). If a value
// isn't here, it shouldn't be inline either — add it here first.
//
// LIGHT/DARK: there are two color palettes — `lightColors` and `darkColors` —
// with identical keys. `buildTheme(scheme)` assembles the active theme object
// ({ scheme, isDark, colors, type, shadow }); screens consume it via
// `useTheme()` (lib/ThemeContext) and build their StyleSheet through
// `useThemedStyles(makeStyles)` (lib/useThemedStyles) so styles regenerate when
// the theme flips. `radius`/`spacing` are theme-independent and exported plain.
//
// NOTE — back-compat shim at the bottom: `colors`, `type`, `shadow` are still
// exported as the LIGHT values so screens not yet converted to the hook keep
// compiling and render in light. Remove the shim once every screen is converted.

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// Pin / status palette — FIXED across themes (like the web's literal brand
// ramp). Pins must stay mutually distinguishable on the map regardless of theme,
// so these identical values are spread into both palettes below.
const status = {
  unknocked: '#9CA3AF',
  not_home: '#3B82F6',
  surveyed: '#22C55E',
  wrong_address: '#EF4444',
  lit_dropped: '#A855F7',
  voted: '#14B8A6',
};
const statusLabels = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
  voted: 'Voted',
};

// Shadows. Black drop shadows read poorly on dark surfaces, so dark UIs lean on
// the `border` token (cards already carry a 1px border) to separate surfaces;
// the shadow values are shared and effectively a no-op against a dark bg.
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  raised: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
};

export const lightColors = {
  brand: '#DC2626',      // primary red
  brandDark: '#B91C1C',  // pressed / hover
  brandTint: '#FEF2F2',  // very light red wash for selected backgrounds

  bg: '#F9FAFB',         // screen background
  card: '#FFFFFF',
  raised: '#FFFFFF',     // popovers, menus (lifted above card)
  sunken: '#F3F4F6',     // wells, table headers, locked/disabled fields
  border: '#E5E7EB',     // card borders, dividers
  borderStrong: '#D1D5DB',

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',

  success: '#16A34A',
  successBg: '#DCFCE7',
  successBorder: '#86EFAC',

  warn: '#F59E0B',
  warnBg: '#FEF3C7',
  warnFg: '#92400E',     // readable warning text / icon on warnBg
  warnBorder: '#FCD34D',

  danger: '#EF4444',
  dangerBg: '#FEE2E2',

  info: '#3B82F6',
  infoBg: '#DBEAFE',

  backdrop: 'rgba(0,0,0,0.45)',          // modal scrims
  chromeBar: 'rgba(255,255,255,0.95)',   // translucent map top bars
  mapLabel: '#111827',                   // Mapbox symbol label text
  mapLabelHalo: '#FFFFFF',               // Mapbox symbol label halo

  status,
  statusLabels,
};

export const darkColors = {
  brand: '#EF4444',
  brandDark: '#F87171',
  brandTint: '#3F1414',

  bg: '#0B0F19',
  card: '#111827',
  raised: '#1F2937',
  sunken: '#0F1420',
  border: '#272E3C',
  borderStrong: '#374151',

  textPrimary: '#E5E7EB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textInverse: '#111827',

  success: '#22C55E',
  successBg: '#052E1B',
  successBorder: '#15803D',

  warn: '#FBBF24',
  warnBg: '#3A2A05',
  warnFg: '#FCD34D',
  warnBorder: '#854D0E',

  danger: '#F87171',
  dangerBg: '#3A1212',

  info: '#60A5FA',
  infoBg: '#12243F',

  backdrop: 'rgba(0,0,0,0.65)',
  chromeBar: 'rgba(17,24,39,0.95)',
  mapLabel: '#E5E7EB',
  mapLabelHalo: '#0B0F19',

  status,
  statusLabels,
};

// Typography bakes the active text color, so it's a function of the palette.
export function makeType(c) {
  return {
    display: { fontSize: 28, fontWeight: '700', color: c.textPrimary },
    title: { fontSize: 22, fontWeight: '700', color: c.textPrimary },
    h2: { fontSize: 18, fontWeight: '600', color: c.textPrimary },
    h3: { fontSize: 16, fontWeight: '600', color: c.textPrimary },
    body: { fontSize: 15, color: c.textPrimary },
    bodyStrong: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    caption: { fontSize: 13, color: c.textSecondary },
    micro: { fontSize: 11, color: c.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  };
}

// Assembled once per scheme so each theme object is referentially stable —
// useThemedStyles keys its memo on this, so a screen's StyleSheet is recreated
// only when the scheme actually flips (two instances over the app's life).
const THEMES = {
  light: { scheme: 'light', isDark: false, colors: lightColors, type: makeType(lightColors), shadow },
  dark: { scheme: 'dark', isDark: true, colors: darkColors, type: makeType(darkColors), shadow },
};

export function buildTheme(scheme) {
  return THEMES[scheme] || THEMES.light;
}

// ---------------------------------------------------------------------------
// Back-compat shim — LIGHT values for screens not yet converted to useTheme().
// Remove once the dark-mode sweep is complete (no file should import `colors`,
// `type`, or `shadow` directly anymore).
// ---------------------------------------------------------------------------
export const colors = lightColors;
export const type = THEMES.light.type;
