/** @type {import('tailwindcss').Config} */
//
// Doorline design tokens (web). Mirrors mobile/lib/theme.js.
// Brand = red (#DC2626 = Tailwind red-600). The mobile theme uses the same
// values, so the two surfaces stay visually aligned.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
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
      },
    },
  },
  plugins: [],
};
