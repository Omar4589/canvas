import { PLATFORM_TOTALS } from './siteFacts.js';

// The numbers strip, right under the hero (and on /aapc): platform totals, with their date small on the
// right (the owner's addendum 3). The printed AAPC ad published totals too, so these never read lower
// than the ad's (siteFacts.js). No client names here.
const NumbersStrip = () => (
  <section aria-label="Doorline in numbers" className="border-y border-stone-200 bg-stone-50">
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
        {PLATFORM_TOTALS.items.map(({ value, label }) => (
          <li key={label}>
            <p className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">{value}</p>
            <p className="mt-1 text-sm text-stone-600">{label}</p>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-right text-xs text-stone-500">Doorline platform totals as of {PLATFORM_TOTALS.asOf}.</p>
    </div>
  </section>
);

export default NumbersStrip;
