import { PLATFORM_TOTALS } from './siteFacts.js';

// The numbers strip, right under the hero (and on /aapc): three platform totals in the brand red, one row
// at every width (smaller on a phone, so the three fit), with their date small on the right (the owner,
// Nov 2). `centered` is /aapc's: centred and a size larger from 640 px, so the numbers catch the eye of
// someone who just scanned the ad (the owner, Nov 15). The printed AAPC ad published totals too, so these
// never read lower than the ad's (siteFacts.js). No client names here.
const NumbersStrip = ({ centered = false }) => (
  <section aria-label="Doorline in numbers" className="border-y border-stone-200 bg-stone-50">
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
      <ul className={`grid grid-cols-3 gap-x-3 sm:gap-x-6 ${centered ? 'text-center' : ''}`}>
        {PLATFORM_TOTALS.items.map(({ value, label }) => (
          <li key={label}>
            <p className={`text-2xl font-extrabold tracking-tight text-brand-600 ${centered ? 'sm:text-5xl' : 'sm:text-4xl'}`}>{value}</p>
            <p className={`mt-1 text-sm text-stone-600 ${centered ? 'sm:text-base' : ''}`}>{label}</p>
          </li>
        ))}
      </ul>
      <p className={`mt-8 text-xs text-stone-500 ${centered ? 'text-center' : 'text-right'}`}>
        Doorline platform totals as of {PLATFORM_TOTALS.asOf}.
      </p>
    </div>
  </section>
);

export default NumbersStrip;
