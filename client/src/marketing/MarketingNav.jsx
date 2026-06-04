import { useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { demoMailto } from './contact.js';

// Sticky top nav for the public marketing site. Anchor links scroll to the
// in-page sections; the auth control adapts to whether someone is signed in.
// Below md the section links collapse into a disclosure menu so mobile users
// can still jump to sections.
const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#mobile', label: 'Mobile app' },
];

export default function MarketingNav() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-2">
          <Link
            to="/"
            aria-label="Doorline home"
            className="flex shrink-0 items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            <Logo size={28} />
          </Link>

          <nav
            aria-label="Primary"
            className="hidden items-center gap-8 md:flex"
          >
            {SECTIONS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="rounded text-sm text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Auth control. Hidden until auth resolves so logged-in visitors
                don't see a "Sign in" flash that swaps to "Go to dashboard". */}
            {!loading &&
              (user ? (
                <Link
                  to="/admin"
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:px-4"
                >
                  <span className="sm:hidden">Dashboard</span>
                  <span className="hidden sm:inline">Go to dashboard</span>
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="hidden rounded text-sm text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:inline-flex"
                >
                  Sign in
                </Link>
              ))}
            <a
              href={demoMailto()}
              className="inline-flex items-center justify-center rounded-md bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:px-4"
            >
              <span className="sm:hidden">Demo</span>
              <span className="hidden sm:inline">Request a demo</span>
            </a>

            {/* Mobile section menu toggle */}
            <button
              type="button"
              aria-label="Toggle navigation menu"
              aria-expanded={open}
              aria-controls="marketing-mobile-menu"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {open ? (
                  <path d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path d="M3 6h18M3 12h18M3 18h18" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile disclosure panel — section anchors only */}
      {open && (
        <nav
          id="marketing-mobile-menu"
          aria-label="Sections"
          className="border-t border-gray-200 bg-white md:hidden"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6 lg:px-8">
            <ul className="flex flex-col">
              {SECTIONS.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-2 py-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {label}
                  </a>
                </li>
              ))}
              {!user && (
                <li className="sm:hidden">
                  <Link
                    to="/login"
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-2 py-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    Sign in
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </nav>
      )}
    </header>
  );
}
