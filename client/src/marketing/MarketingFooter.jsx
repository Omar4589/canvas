import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { demoMailto } from './contact.js';
import { useAuthCta } from './useAuthCta.js';
import { IOS_INSTALL_URL, ANDROID_INSTALL_URL } from '../lib/appLinks.js';

// Public marketing footer — brand mark, an honest one-line description of the
// product, the beta install badges, and the small link row. "Contact" routes to the
// demo mailto. The badges link to the CLOSED betas (Apple TestFlight + Google Play
// internal test), so they're framed as "beta" — NOT the official "Download on the App
// Store" / "Get it on Google Play" badges, which are only for public store listings and
// would be misleading (and against brand guidelines) for a beta. Swap to the official
// badges once the apps are publicly listed — the URLs themselves live in lib/appLinks.js,
// which the signed-in install card (SelectOrgPage) shares.
const IPHONE_BETA_URL = IOS_INSTALL_URL;
const ANDROID_BETA_URL = ANDROID_INSTALL_URL;
// Privacy and Terms are static documents served by Express (client/public/*.html), not React
// routes — they must be full-page loads (href), never client-side <Link> navigations, so every
// visitor gets the same zero-JS artifact with its own canonical tag.
const LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export default function MarketingFooter() {
  const cta = useAuthCta();
  // Privacy/Terms are static; the last link is auth-aware — "Dashboard" when signed in,
  // "Sign in" when not — so the footer never disagrees with the nav.
  const links = [...LINKS, { to: cta.to, label: cta.authed ? 'Dashboard' : 'Sign in' }];
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <Logo size={24} />
            <p className="mt-4 text-sm text-stone-500">
              Doorline is the door-to-door canvassing platform for political campaigns and every
              cause that knocks doors — a web operations console plus an offline-first field app.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5" aria-label="Get the Doorline beta on iPhone and Android">
              <a
                href={IPHONE_BETA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col rounded-lg bg-stone-900 px-3.5 py-1.5 leading-tight text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                <span className="text-[8.5px] uppercase tracking-wide opacity-75">iPhone beta · TestFlight</span>
                <span className="text-[13px] font-bold">iPhone &amp; iPad</span>
              </a>
              <a
                href={ANDROID_BETA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col rounded-lg bg-stone-900 px-3.5 py-1.5 leading-tight text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                <span className="text-[8.5px] uppercase tracking-wide opacity-75">Android test · Google Play</span>
                <span className="text-[13px] font-bold">Android</span>
              </a>
            </div>
          </div>

          <nav aria-label="Footer">
            <ul className="flex items-center gap-6">
              {links.map(({ to, href, label }) => (
                <li key={href || to}>
                  {href ? (
                    <a
                      href={href}
                      className="rounded text-sm text-stone-600 transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link
                      to={to}
                      className="rounded text-sm text-stone-600 transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      {label}
                    </Link>
                  )}
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

        <p className="mt-8 text-xs text-stone-500">© 2026 Doorline LLC</p>
      </div>
    </footer>
  );
}
