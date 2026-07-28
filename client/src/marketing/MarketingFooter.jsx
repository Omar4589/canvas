import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { demoMailto } from './contact.js';
import { useAuthCta } from './useAuthCta.js';
import { IOS_INSTALL_URL, ANDROID_INSTALL_URL } from '../lib/appLinks.js';
import badgeAppStore from '../assets/marketing/badge-app-store.svg';
import badgeGooglePlay from '../assets/marketing/badge-google-play.png';

// Public marketing footer — brand mark, an honest one-line description of the product, the store
// badges, and the small link row. "Contact" routes to the demo mailto. Both apps went public
// 2026-07-28, so these are now the OFFICIAL badges; the URLs live in lib/appLinks.js, which the
// signed-in install card (SelectOrgPage) shares.
//
// The artwork is Apple's and Google's, and neither may be altered — no recolor, no restyle, no
// corner rounding, no shadow, no cropping, and the wording ("Download on the App Store" / "Get it
// on Google Play") may not be paraphrased. So the rounded corner and the focus ring live on the
// <a>, never on the <img>. Both assets are tight lockups (Apple 119.66×40, Google 478×142 with
// only ~3px of corner antialiasing), so a shared 40px height renders them at equal visual weight
// with no compensation — which is itself a brand requirement when the two sit side by side. The
// gap satisfies Google's clear-space rule (¼ of badge height = 10px; gap-3 is 12px).
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
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href={IOS_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                <img
                  src={badgeAppStore}
                  alt="Download Doorline on the App Store"
                  width="120"
                  height="40"
                  loading="lazy"
                  decoding="async"
                  className="block h-10 w-auto"
                />
              </a>
              <a
                href={ANDROID_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                <img
                  src={badgeGooglePlay}
                  alt="Get Doorline on Google Play"
                  width="135"
                  height="40"
                  loading="lazy"
                  decoding="async"
                  className="block h-10 w-auto"
                />
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

        {/* Trademark credit for the two badges above. Both vendors require it where their marks
            appear; it sits down here rather than beside the badges, which must not carry adjacent
            text inside their clear space. */}
        <div className="mt-8 space-y-1.5">
          <p className="text-xs text-stone-500">© 2026 Doorline LLC</p>
          <p className="text-[11px] leading-relaxed text-stone-400">
            Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other
            countries. App Store is a service mark of Apple Inc. Google Play and the Google Play
            logo are trademarks of Google LLC.
          </p>
        </div>
      </div>
    </footer>
  );
}
