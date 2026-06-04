// DashboardMockup — hero mockup: a browser-framed admin map.
// Proves the "console + field app on one shared map" promise on sight.
// Pure CSS/SVG, brand palette only, no external images, no real voter data.
// Wraps MapMockup (the standalone map panel) in slim browser chrome.

import MapMockup from './MapMockup.jsx';

export default function DashboardMockup() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
      role="img"
      aria-label="Doorline admin console showing a canvassing map with turf, doors, and canvasser pings"
    >
      {/* Slim browser-style top chrome: three dots + a muted URL pill */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
        </span>
        <span className="ml-2 flex-1 truncate rounded bg-gray-100 px-2 py-1 text-center text-[11px] text-gray-500">
          doorline.app/map
        </span>
      </div>

      {/* Map panel */}
      <div className="h-72 w-full sm:h-80">
        <MapMockup />
      </div>
    </div>
  );
}
