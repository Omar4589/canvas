// Doorline design tokens.
//
// Use these for everything (colors, type, spacing, radius, shadow). If a value
// isn't here, it shouldn't be inline either — add it here first.

export const colors = {
  brand: '#DC2626',      // primary red
  brandDark: '#B91C1C',  // pressed / hover
  brandTint: '#FEF2F2',  // very light red wash for selected backgrounds

  bg: '#F9FAFB',         // screen background
  card: '#FFFFFF',
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

  danger: '#EF4444',
  dangerBg: '#FEE2E2',

  info: '#3B82F6',
  infoBg: '#DBEAFE',

  // Pin / status palette (kept from original — pins stay distinguishable).
  status: {
    unknocked: '#9CA3AF',
    not_home: '#3B82F6',
    surveyed: '#22C55E',
    wrong_address: '#EF4444',
    lit_dropped: '#A855F7',
  },
  statusLabels: {
    unknocked: 'Unknocked',
    not_home: 'Not home',
    surveyed: 'Surveyed',
    wrong_address: 'Wrong address',
    lit_dropped: 'Lit dropped',
  },
};

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

export const type = {
  display: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  h2: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  h3: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textPrimary },
  bodyStrong: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  caption: { fontSize: 13, color: colors.textSecondary },
  micro: { fontSize: 11, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
};

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
