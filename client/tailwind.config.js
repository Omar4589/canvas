/** @type {import('tailwindcss').Config} */
//
// Doorline design tokens (web). Mirrors mobile/lib/theme.js.
// Brand = red (#DC2626 = Tailwind red-600). The mobile theme uses the same
// values, so the two surfaces stay visually aligned.
//
// Semantic colors below resolve to CSS variables defined in src/index.css
// (:root = light, html.dark = dark), so `bg-card`/`text-fg`/`border-border`
// etc. flip automatically. The literal `brand.*` red ramp stays for fixed-
// contrast brand buttons (`bg-brand-600`) that don't flip.
const ch = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FEF2F2',   // brandTint — selected backgrounds, soft washes
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#EF4444',  // danger
          600: '#DC2626',  // brand — primary
          700: '#B91C1C',  // brandDark — pressed/hover
          800: '#991B1B',
          900: '#7F1D1D',
        },

        // Semantic tokens (variable-flipped light/dark).
        surface: ch('--surface'),
        card: ch('--card'),
        raised: ch('--raised'),
        sunken: ch('--sunken'),
        overlay: ch('--overlay'),

        fg: ch('--fg'),
        'fg-muted': ch('--fg-muted'),
        'fg-subtle': ch('--fg-subtle'),
        'fg-inverse': ch('--fg-inverse'),

        border: ch('--border'),
        'border-strong': ch('--border-strong'),

        'brand-accent': ch('--brand'),
        'brand-hover': ch('--brand-hover'),
        'brand-fg': ch('--brand-fg'),
        'brand-tint': ch('--brand-tint'),
        'brand-tint-fg': ch('--brand-tint-fg'),

        ring: ch('--ring'),

        success: ch('--success'),
        'success-fg': ch('--success-fg'),
        'success-tint': ch('--success-tint'),
        warning: ch('--warning'),
        'warning-fg': ch('--warning-fg'),
        'warning-tint': ch('--warning-tint'),
        danger: ch('--danger'),
        'danger-fg': ch('--danger-fg'),
        'danger-tint': ch('--danger-tint'),
        info: ch('--info'),
        'info-fg': ch('--info-fg'),
        'info-tint': ch('--info-tint'),
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        raised: '0 4px 6px -1px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.06)',
        popover: '0 8px 24px -4px rgb(16 24 40 / 0.12), 0 4px 8px -4px rgb(16 24 40 / 0.08)',
        overlay: '0 24px 48px -12px rgb(16 24 40 / 0.30)',
      },
      borderRadius: {
        card: '0.75rem',
      },
      transitionTimingFunction: {
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease both',
        'pop-in': 'pop-in 0.18s cubic-bezier(0.2,0,0,1) both',
        'slide-in': 'slide-in 0.2s cubic-bezier(0.2,0,0,1) both',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};
