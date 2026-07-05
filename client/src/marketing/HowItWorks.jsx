import { Reveal } from './useReveal.jsx';

// HowItWorks — four numbered steps from voter file to published client report.
// This is a genuine sequence, so the numbering carries information.
const STEPS = [
  {
    title: 'Import the file',
    body: "Upload the voter file, map the vendor's columns, preview exactly what will change, and apply.",
  },
  {
    title: 'Cut the turf',
    body: 'Claim doors into a walk list, cut a pass into balanced books, and assign each book to a canvasser.',
  },
  {
    title: 'Knock the doors',
    body: 'Crews walk their books in the app — GPS-stamped outcomes, surveys, and scripts, online or off.',
  },
  {
    title: 'Publish the report',
    body: 'Watch results land live, then freeze the week into a client report and send one link.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">How it works</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Four steps from file to field report
          </h2>
        </Reveal>
        <ol className="mt-12 grid grid-cols-1 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 90}>
              <li className="relative border-t-2 border-stone-200 pt-4">
                <span className="absolute -top-[13px] left-0 bg-white pr-2.5 text-[13px] font-extrabold tracking-wider text-brand-600 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-[16.5px] font-bold text-stone-900">{s.title}</h3>
                <p className="mt-2 text-[13.5px] text-stone-500">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
