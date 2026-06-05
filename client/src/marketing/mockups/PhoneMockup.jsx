// PhoneMockup — field-app walk-list / knock screen.
// Makes the offline-queue claim tangible with an "Offline — 4 queued" chip.
// Pure CSS/SVG, brand palette only, no external images, no real voter data.
// Abstract/placeholder addresses + initials only.

import { LogoMark } from '../../components/Logo.jsx';

// Walk-list rows: address + status dot color (covers app door-status states).
const ROWS = [
  { address: '312 Oak St', members: '4 members', dot: '#16a34a' },
  { address: '318 Oak St', members: '2 members', dot: '#9ca3af' },
  { address: '11 Birch Ln', members: '3 members', dot: '#ea580c' },
];

export default function PhoneMockup() {
  return (
    <div
      className="mx-auto w-full max-w-[18rem] rounded-[2rem] border border-gray-200 bg-white p-3 shadow-sm"
      role="img"
      aria-label="Doorline mobile field app showing a walk list with knock buttons and an offline sync chip"
    >
      {/* Thin notch bar */}
      <div className="flex justify-center pb-2" aria-hidden="true">
        <span className="h-1.5 w-16 rounded-full bg-gray-200" />
      </div>

      <div className="overflow-hidden rounded-[1.4rem] border border-gray-200 bg-gray-50">
        {/* App header with LogoMark + Book label */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2.5">
          <div className="flex items-center gap-2">
            <LogoMark size={18} />
            <span className="text-sm font-semibold text-gray-900">Book 7</span>
          </div>
          <span className="text-[11px] text-gray-500">Pass 2</span>
        </div>

        {/* Walk-list rows */}
        <ul className="divide-y divide-gray-200">
          {ROWS.map((row) => (
            <li
              key={row.address}
              className="flex items-center justify-between gap-2 bg-white px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.dot }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {row.address}
                  </p>
                  <p className="truncate text-[11px] text-gray-500">{row.members}</p>
                </div>
              </div>
              <span className="rounded-md bg-brand-600 px-2 py-1 text-xs text-white">
                Knock
              </span>
            </li>
          ))}
        </ul>

        {/* Offline sync chip */}
        <div className="flex items-center justify-center gap-1.5 border-t border-gray-200 bg-gray-50 px-3 py-2.5">
          <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
            Offline — 4 queued
          </span>
        </div>
      </div>
    </div>
  );
}
