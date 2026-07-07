import { Link } from 'react-router-dom';
import { demoMailto } from './contact.js';
import { Reveal } from './useReveal.jsx';

// CtaBand — brand-wash conversion band at the foot of the page.
export default function CtaBand() {
  return (
    <section className="border-t border-brand-100 bg-brand-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="py-20 text-center sm:py-24">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">Get started</p>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-[2.6rem] sm:leading-tight">
            See Doorline run your next canvass
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-base text-stone-600">
            We&apos;ll walk you through the console and the field app together, on a live demo
            campaign with turf, canvassers, and a published report — so you can see exactly
            what your team gets.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <a
              href={demoMailto()}
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Request a demo
            </a>
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
