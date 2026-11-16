import { PLATFORM_TOTALS } from './siteFacts.js';

// The numbers strip, right under the hero (and on /aapc): three platform totals in the brand red, one row
// at every width (smaller on a phone, so the three fit), centred, the same on both pages (the owner, Nov 2,
// 15 and 16). Their date sits small in the band's bottom-right corner, out of the flow, so it takes no
// height and no attention from the numbers (the owner, Nov 16); stone-500 still passes contrast on the
// band at 11 px. Each number ends in a plus, "and counting" (the owner, Nov 16),
// as the printed ad's do ("95,000+ door knocks"); the date says when they were counted. The printed AAPC ad
// published totals too, so these never read lower than the ad's (siteFacts.js). No client names here.
const NumbersStrip = () => (
  <section aria-label="Doorline in numbers" className="border-y border-stone-200 bg-stone-50">
    <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <ul className="grid grid-cols-3 gap-x-3 text-center sm:gap-x-6">
        {PLATFORM_TOTALS.items.map(({ value, label }) => (
          <li key={label}>
            {/* 22 px on a phone: the plus made 24 px wider than a 360 px Android's column. */}
            <p className="text-[22px] font-extrabold leading-8 tracking-tight text-brand-600 sm:text-5xl">{value}+</p>
            <p className="mt-1 text-sm text-stone-600 sm:text-base">{label}</p>
          </li>
        ))}
      </ul>
      <p className="absolute bottom-2 right-4 text-[11px] text-stone-500 sm:right-6 lg:right-8">
        Doorline platform totals as of {PLATFORM_TOTALS.asOf}.
      </p>
    </div>
  </section>
);

export default NumbersStrip;
