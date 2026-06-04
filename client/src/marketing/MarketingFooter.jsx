import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { demoMailto } from './contact.js';

// Public marketing footer — brand mark, an honest one-line description of the
// product, and the small link row. "Contact" routes to the demo mailto.
export default function MarketingFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <Logo size={24} />
            <p className="mt-4 text-sm text-gray-500">
              Doorline is the all-in-one door-to-door canvassing and
              field-organizing platform — a web admin console plus an
              offline-ready mobile field app — built for political campaigns,
              advocacy groups, and community organizers.
            </p>
          </div>

          <nav aria-label="Footer">
            <ul className="flex items-center gap-6">
              <li>
                <Link
                  to="/privacy"
                  className="rounded text-sm text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  to="/login"
                  className="rounded text-sm text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <a
                  href={demoMailto()}
                  className="rounded text-sm text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <p className="mt-8 text-xs text-gray-500">© 2026 Doorline</p>
      </div>
    </footer>
  );
}
