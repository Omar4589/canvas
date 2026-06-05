// Shared UI icon set — extends the nav icons' stroke language (24-grid, 1.8 stroke,
// round caps, currentColor) for in-app glyphs. Re-exports navIcons so there's one
// import surface. Each icon takes { size, className } and inherits text color.
export * from '../navIcons.jsx';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function Svg({ size = 18, className, children }) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      {children}
    </svg>
  );
}

export const IconSearch = (p) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>
);
export const IconChevronRight = (p) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const IconChevronDown = (p) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconChevronUpDown = (p) => (
  <Svg {...p}><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></Svg>
);
export const IconX = (p) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const IconPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconCheck = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const IconInfo = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></Svg>
);
export const IconAlert = (p) => (
  <Svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>
);
export const IconSun = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Svg>
);
export const IconMoon = (p) => (
  <Svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Svg>
);
export const IconEye = (p) => (
  <Svg {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconEyeOff = (p) => (
  <Svg {...p}><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.4 0 10 7 10 7a18 18 0 0 1-2.6 3.4M6.6 6.6A18 18 0 0 0 2 13s3.6 7 10 7a9.7 9.7 0 0 0 4.5-1.1" /><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2M2 2l20 20" /></Svg>
);
export const IconFilter = (p) => (
  <Svg {...p}><path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" /></Svg>
);
export const IconSpinner = ({ size = 18, className }) => (
  <svg width={size} height={size} className={`animate-spin ${className || ''}`} {...base}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);
