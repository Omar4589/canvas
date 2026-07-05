// Phone shell around field-app content — either a real screenshot <img> or the
// CSS-drawn door list used until device captures exist. Width is controlled by
// the parent; the shell only supplies chrome.
export default function PhoneFrame({ children, className = '' }) {
  return (
    <div
      className={`rounded-[2rem] border border-stone-200 bg-white p-3 shadow-[0_20px_60px_rgba(28,25,23,0.16)] ${className}`}
    >
      <div className="mx-auto mb-2.5 mt-0.5 h-1.5 w-16 rounded-full bg-stone-200" aria-hidden="true" />
      <div className="overflow-hidden rounded-[1.4rem]">{children}</div>
    </div>
  );
}
