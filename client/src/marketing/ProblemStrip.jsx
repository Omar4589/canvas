// Diagnostic framing before the product: name the fragmented status quo, then land the pitch in one
// line. The honor-system card describes field fraud as it happens, and names no product — nothing on
// the site knocks another platform (the owner's addendum, Nov 1, 2026).
const PAINS = [
  {
    title: 'The universe is a spreadsheet',
    body: 'The voter file gets sliced in Excel, printed into packets, and nobody can say which doors are actually left.',
  },
  {
    title: 'The field day is a group chat',
    body: '“Where are you?” “Did anyone do Maple St?” Coverage lives in texts and memory until someone types it up.',
  },
  {
    title: 'The door count runs on the honor system',
    body: "Doors get marked from the car. Surveys get filled in to hit a goal. By the time anyone checks, the money's spent.",
  },
  {
    title: 'The recap is a Friday-night deck',
    body: 'Hours of copy-paste into a PowerPoint that gets skimmed once — and the numbers get questioned anyway.',
  },
];

export default function ProblemStrip() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            The way it usually goes
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            A door program shouldn&apos;t live in five tools
          </h2>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {PAINS.map((p) => (
            <div key={p.title} className="h-full rounded-lg border border-stone-200 bg-stone-50 p-5 sm:p-6">
              <h3 className="text-[15.5px] font-bold text-stone-900">{p.title}</h3>
              <p className="mt-2 text-sm text-stone-500">{p.body}</p>
            </div>
          ))}
        </div>
        {/* "Checks every door recorded in the app", not "makes every door prove itself": iOS doesn't
            report fake GPS, and results typed in at a desk carry the desk's location. */}
        <p className="mt-8 text-lg font-bold text-stone-900">
          Doorline puts it all in one place, and{' '}
          <em className="not-italic text-brand-600">checks every door recorded in the app against its house</em>.
        </p>
      </div>
    </section>
  );
}
