// A web-console screenshot enlarged so the UI is legible, running off one edge of the
// page and dissolving into a soft fade on the INNER edge (toward the page text). The
// app's sidebar/nav slides toward the outer/faded edge — it's not worth reading — so
// the main panel, map, and tables stay big and sharp. `bleed` is the page edge it runs
// off: 'right' (image sits in the right column) or 'left' (left column). Keeps a slim
// browser chrome on top; only top/bottom hairlines so both ends read as open. The
// full-bleed-to-the-edge itself is done by the tour row (negative margin); this
// enlarges the image, slides it toward the outer edge, and paints the inner fade.
const ZOOM = 1.3; // how much larger than its column the screenshot renders

export default function ConsoleShot({ src, alt, url, bleed = 'right', width, height }) {
  const left = bleed === 'left';
  // Fade the inner edge (the one facing the page text), and slide the image toward the
  // outer edge so the sidebar tucks under the fade / off-page and more view is revealed.
  const fadeEdge = left ? 'right-0 bg-gradient-to-l' : 'left-0 bg-gradient-to-r';
  const shift = left ? '-14%' : '-9%';
  return (
    <div className="relative overflow-hidden border-y border-stone-200 bg-white shadow-[0_18px_56px_rgba(28,25,23,0.13)]">
      <div
        className="flex items-center gap-2 border-b border-stone-200 bg-stone-100 px-3.5 py-2.5"
        aria-hidden="true"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="ml-2 truncate rounded-md border border-stone-200 bg-white px-3 py-0.5 text-[11px] text-stone-500">
          {url}
        </span>
      </div>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="block max-w-none"
        style={{ width: `${ZOOM * 100}%`, transform: `translateX(${shift})` }}
      />
      <div
        className={`pointer-events-none absolute inset-y-0 w-[28%] from-white to-transparent ${fadeEdge}`}
      />
    </div>
  );
}
