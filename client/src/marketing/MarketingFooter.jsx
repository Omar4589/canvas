import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { demoMailto } from './contact.js';

// Public marketing footer — brand mark, an honest one-line description of the
// product, platform badges, and the small link row. "Contact" routes to the
// demo mailto. The store badges are unlinked until the public listings exist;
// swap the <span>s for <a href> when the App Store / Play URLs are live.
const LINKS = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/login', label: 'Sign in' },
];

export default function MarketingFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <Logo size={24} />
            <p className="mt-4 text-sm text-stone-500">
              Doorline is the door-to-door canvassing platform for political consulting firms
              and campaigns — a web operations console plus an offline-first mobile field app.
            </p>
            <div className="mt-5 flex gap-2.5" aria-label="Available on iOS and Android">
              <span className="flex flex-col rounded-lg bg-stone-900 px-3.5 py-1.5 leading-tight text-white">
                <span className="text-[8.5px] uppercase tracking-wide opacity-75">Available for</span>
                <span className="text-[13px] font-bold">iPhone &amp; iPad</span>
              </span>
              <span className="flex flex-col rounded-lg bg-stone-900 px-3.5 py-1.5 leading-tight text-white">
                <span className="text-[8.5px] uppercase tracking-wide opacity-75">Available for</span>
                <span className="text-[13px] font-bold">Android</span>
              </span>
            </div>
          </div>

          <nav aria-label="Footer">
            <ul className="flex items-center gap-6">
              {LINKS.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="rounded text-sm text-stone-600 transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={demoMailto()}
                  className="rounded text-sm text-stone-600 transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <p className="mt-8 text-xs text-stone-500">© 2026 Doorline</p>
      </div>
    </footer>
  );
}
