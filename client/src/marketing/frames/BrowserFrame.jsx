// Browser chrome around a real product screenshot (adapted from the old CSS-drawn
// DashboardMockup). Children should be an <img> with explicit width/height so the
// frame reserves space and the page never shifts as screenshots lazy-load.
export default function BrowserFrame({ url = 'doorline.app', children, className = '' }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_18px_56px_rgba(28,25,23,0.13)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-100 px-3.5 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="ml-2 truncate rounded-md border border-stone-200 bg-white px-3 py-0.5 text-[11px] text-stone-500">
          {url}
        </span>
      </div>
      {children}
    </div>
  );
}
