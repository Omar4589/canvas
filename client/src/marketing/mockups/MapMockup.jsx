// MapMockup — standalone, decorative live-map panel (no browser chrome).
// Pure CSS/SVG, brand palette only, no external images, no real voter data.
// Reusable building block: DashboardMockup frames it in browser chrome, and it
// can stand on its own inside other marketing sections. Abstract/placeholder
// labels only (e.g. "312 Oak St", "Book 7", "4 members", initials "JM").

import { IconPin } from '../../components/navIcons.jsx';

// Real turf palette (BOOK_COLORS, from TurfsPage.jsx) so the mockup matches the app.
const BOOK_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c'];

// Translucent turf polygons drawn on the abstract map grid (percent coords).
const TURFS = [
  { color: BOOK_COLORS[0], points: '6,10 40,6 44,34 14,40 5,26' },
  { color: BOOK_COLORS[1], points: '50,8 92,12 90,40 58,38' },
  { color: BOOK_COLORS[2], points: '8,52 38,48 42,82 12,90 4,70' },
  { color: BOOK_COLORS[3], points: '50,46 90,48 94,86 56,90' },
];

// Small door dots scattered across the panel (percent coords).
const DOORS = [
  [14, 18], [22, 14], [30, 22], [20, 30], [34, 16],
  [60, 18], [72, 16], [82, 24], [66, 30], [78, 32],
  [16, 64], [26, 60], [22, 74], [34, 70], [12, 80],
  [62, 60], [74, 58], [84, 66], [68, 74], [80, 80],
];

// Canvasser pings: position + initials for the ring-white avatar chip.
const PINGS = [
  { x: 26, y: 24, initials: 'JM' },
  { x: 70, y: 22, initials: 'AR' },
  { x: 24, y: 68, initials: 'TK' },
  { x: 72, y: 70, initials: 'DP' },
];

export default function MapMockup() {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-lg bg-gray-50"
      role="img"
      aria-label="Live canvassing map showing turf areas, door locations, and canvasser positions"
    >
      {/* Subtle map grid */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="#e5e7eb" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#map-grid)" />

        {/* Translucent turf polygons with 2px-style outlines in BOOK_COLORS */}
        {TURFS.map((turf, i) => (
          <polygon
            key={i}
            points={turf.points}
            fill={turf.color}
            fillOpacity="0.12"
            stroke={turf.color}
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        ))}

        {/* Small circular door dots */}
        {DOORS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.9" fill="#9ca3af" />
        ))}
      </svg>

      {/* Canvasser pings — brand-600 IconPin + ring-white avatar chip */}
      {PINGS.map((ping) => (
        <div
          key={ping.initials}
          className="absolute -translate-x-1/2 -translate-y-full"
          style={{ left: `${ping.x}%`, top: `${ping.y}%` }}
        >
          <div className="flex flex-col items-center">
            <span className="text-brand-600">
              <IconPin size={26} />
            </span>
            <span className="-mt-5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700 ring-1 ring-white">
              {ping.initials}
            </span>
          </div>
        </div>
      ))}

      {/* Floating Live pill, top-right */}
      <div className="absolute right-3 top-3">
        <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
          Live
        </span>
      </div>

      {/* Floating HousePopup card, bottom-left */}
      <div className="absolute bottom-3 left-3 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">312 Oak St</span>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: BOOK_COLORS[0] }}
            aria-hidden="true"
          />
        </div>
        <p className="mt-0.5 text-xs text-gray-500">4 members · Book 7</p>
      </div>
    </div>
  );
}
