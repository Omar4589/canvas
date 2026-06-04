import { Link } from 'react-router-dom';
import { demoMailto } from './contact.js';

// CtaBand — flat brand-50 conversion band near the foot of the page.
export default function CtaBand() {
  return (
    <section className="bg-brand-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 text-center sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            See Doorline run your next canvass
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600">
            We'll walk you through the console and the field app together, with
            turf and voters that look like your campaign. No self-serve signup —
            email hello@doorline.app to set up a demo.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={demoMailto()}
              className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Request a demo
            </a>
            <Link
              to="/login"
              className="rounded text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
