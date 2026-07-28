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
  refused: '#F59E0B',
  lit_dropped: '#A855F7',
  restricted: '#475569', // slate — inaccessible/blocked home; distinct from grey unknocked
  voted: '#14B8A6',
  dnc: '#9F1239', // deep rose — do-not-contact; distinct from wrong_address red
};
const statusLabels = {
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

// ACTION type → label. Distinct from statusLabels above: an action is what a canvasser
// RECORDED at a door ('survey_submitted'), a status is what the door IS as a result
// ('surveyed'). Kept beside statusLabels so the two vocabularies stay visible together.
//
// This had drifted into seven private copies across web and mobile, with `survey_submitted`
// reading "Survey submitted" on audit surfaces, "Surveyed" in activity feeds and "Survey" in
// notes lists. Canonical wording is now "Surveyed" — it matches statusLabels.surveyed, so an
// action and the status it produces finally read the same. Mirrored in
// client/src/lib/statusColors.js; keep the two in sync.
//
// NOT the same thing as the ACTION_PIN / ACTION_TO_PIN maps in the screens, which translate
// an action enum into a STATUS key to pick a pin icon ('survey_submitted' → 'surveyed').
// Those are semantic, not display text — never fold them into this.
export const ACTION_LABELS = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  survey_submitted: 'Surveyed',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  note_added: 'Note added',
};

export const actionLabel = (t) => ACTION_LABELS[t] || t || '—';

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
  successFg: '#166534',  // readable success text on successBg — 6.49:1 (raw `success` is 3.00:1)
  successBorder: '#86EFAC',

  warn: '#F59E0B',
  warnBg: '#FEF3C7',
  warnFg: '#92400E',     // readable warning text / icon on warnBg
  warnBorder: '#FCD34D',

  danger: '#EF4444',
  dangerBg: '#FEE2E2',
  dangerFg: '#991B1B',   // readable danger text on dangerBg — 6.80:1 (raw `danger` is 3.08:1)

  info: '#3B82F6',
  infoBg: '#DBEAFE',

  dangerBorder: '#FCA5A5',

  // Accent pairs for non-status categorizations (campaign types, voted badges).
  accentPurple: '#7E22CE',
  accentPurpleBg: '#F3E8FF',
  teal: '#0F766E',
  tealBg: '#CCFBF1',

  // Party affiliation dots — kept recognizable (blue=Dem, red=Rep) across themes.
  party: {
    Democratic: '#3B82F6',
    Republican: '#EF4444',
    Independent: '#A855F7',
    'No Party': '#9CA3AF',
    Other: '#F59E0B',
    Unknown: '#9CA3AF',
  },

  backdrop: 'rgba(0,0,0,0.45)',          // modal scrims
  chromeBar: 'rgba(255,255,255,0.95)',   // translucent map top bars
  mapLabel: '#111827',                   // Mapbox symbol label text
  mapLabelHalo: '#FFFFFF',               // Mapbox symbol label halo
  doorDot: '#6B7280',                    // assign-map density dots — neutral gray, never status-colored

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
  successFg: '#4ADE80',  // readable success text on the dark successBg — 8.53:1
  successBorder: '#15803D',

  warn: '#FBBF24',
  warnBg: '#3A2A05',
  warnFg: '#FCD34D',
  warnBorder: '#854D0E',

  danger: '#F87171',
  dangerBg: '#3A1212',
  dangerFg: '#FCA5A5',   // readable danger text on the dark dangerBg — 8.68:1

  info: '#60A5FA',
  infoBg: '#12243F',

  dangerBorder: '#7F1D1D',

  accentPurple: '#C084FC',
  accentPurpleBg: '#2E1065',
  teal: '#2DD4BF',
  tealBg: '#042F2A',

  party: {
    Democratic: '#60A5FA',
    Republican: '#F87171',
    Independent: '#C084FC',
    'No Party': '#9CA3AF',
    Other: '#FBBF24',
    Unknown: '#9CA3AF',
  },

  backdrop: 'rgba(0,0,0,0.65)',
  chromeBar: 'rgba(17,24,39,0.95)',
  mapLabel: '#E5E7EB',
  mapLabelHalo: '#0B0F19',
  doorDot: '#9CA3AF',                    // assign-map density dots — neutral gray, never status-colored

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
