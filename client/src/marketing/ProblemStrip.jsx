import { Reveal } from './useReveal.jsx';

// Diagnostic framing before the product tour: name the fragmented status quo,
// then land the consolidation pitch in one line.
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
    title: 'The recap is a Friday-night deck',
    body: 'Hours of copy-paste into a PowerPoint that gets skimmed once — and the numbers get questioned anyway.',
  },
];

export default function ProblemStrip() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">
            The way it usually goes
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            A door program shouldn&apos;t live in five tools
          </h2>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {PAINS.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <div className="h-full rounded-lg border border-stone-200 bg-stone-50 p-6">
                <h3 className="text-[15.5px] font-bold text-stone-900">{p.title}</h3>
                <p className="mt-2 text-sm text-stone-500">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p className="mt-8 text-lg font-bold text-stone-900">
            Doorline replaces all of it with <em className="not-italic text-brand-600">one pipeline</em>:
            file in, turf out, knocks live, report published.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
