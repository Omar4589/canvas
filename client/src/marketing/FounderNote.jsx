// The founder's note and the trust list. The note is the owner's own words (addendum 1, Nov 1, 2026),
// and nothing here presents Fox Bryant as who built or owns Doorline. The monogram stands in for a
// photo until there is one — never a stock face.
//
// Each trust line is a published promise, checked against the code and the privacy policy:
// exports work even while an account is paused (do-not-contact voters are left out of every file);
// staff access needs a time-limited grant with a written reason, and every request is logged; a
// location is recorded only when someone saves something at a door (a lead's pin move stores theirs
// as the new pin).
const TRUST = [
  'Export your voters, results and notes any time, even while paused.',
  'Your data is never sold, and no other customer can see it.',
  'Staff access is audited and time-limited.',
  'Location is recorded only when you save something at a door, never between doors.',
];

const FounderNote = () => (
  <section className="bg-white">
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-4 py-16 sm:gap-14 sm:px-6 sm:py-24 lg:grid-cols-[7fr_5fr] lg:gap-20 lg:px-8">
      <figure>
        <blockquote className="text-xl font-semibold leading-relaxed text-stone-900 [text-wrap:pretty] sm:text-2xl sm:leading-relaxed">
          &ldquo;I&apos;m Omar. I run paid door programs, and I built Doorline because a door count
          shouldn&apos;t run on trust. Doorline checks every knock against the house it&apos;s for, and
          it&apos;s simple enough that canvassers are knocking minutes after the invite email.&rdquo;
        </blockquote>
        <figcaption className="mt-6 flex items-center gap-3.5">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-base font-extrabold text-brand-700"
            aria-hidden="true"
          >
            OZ
          </span>
          <span>
            <span className="block font-bold text-stone-900">Omar Zumaya</span>
            <span className="block text-sm text-stone-500">Founder, Doorline</span>
          </span>
        </figcaption>
      </figure>
      <div>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">Your data</h2>
        <ul className="mt-5 grid gap-3.5">
          {TRUST.map((t) => (
            <li key={t} className="flex gap-2.5 text-[15px] text-stone-900">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              {t}
            </li>
          ))}
        </ul>
        {/* A full page load: /privacy is a static document, not a React route. */}
        <a
          href="/privacy"
          className="mt-6 inline-flex items-center gap-1.5 rounded text-[15px] font-semibold text-brand-700 transition-colors hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Privacy policy
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  </section>
);

export default FounderNote;
