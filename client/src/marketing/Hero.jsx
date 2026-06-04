import { Link } from 'react-router-dom';
import { demoMailto } from './contact.js';
import DashboardMockup from './mockups/DashboardMockup.jsx';

// Hero — top of the marketing landing page. Owns the page's single <h1>.
// Copy left, browser-framed map mockup right; stacks on mobile.
export default function Hero() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 sm:py-20">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            {/* Copy column */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                All-in-one door-to-door canvassing platform
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                The console and the field app, finally on the same map.
              </h1>
              <p className="mt-5 text-base text-gray-600">
                Doorline is the all-in-one door-to-door canvassing platform for
                campaigns and field organizers. Cut turf and build walk lists in
                the web console, knock with a GPS-stamped, offline-ready mobile
                app, and bring every canvasser and every door onto one shared
                map.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoMailto()}
                  className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Request a demo
                </a>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Sign in
                </Link>
              </div>
            </div>

            {/* Mockup column */}
            <div className="lg:pl-4">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
