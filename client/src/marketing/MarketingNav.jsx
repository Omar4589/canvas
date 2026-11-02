import { useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuthCta } from './useAuthCta.js';
import DemoButton from './DemoButton.jsx';

// Sticky top nav for the public marketing site. Anchor links scroll to the homepage's sections; the
// auth control adapts to whether someone is signed in. Below lg the section links collapse into a
// disclosure menu so phone and tablet users can still jump to sections.
//
// `base` is '' on the homepage, so a link is a plain '#proof' (a '/#proof' would reload a tagged
// '/?src=…' and lose the tag), and '/' on other pages (/aapc), where the sections live elsewhere.
const SECTIONS = [
  { id: 'proof', label: 'Proof' },
  { id: 'reports', label: 'Reports' },
  { id: 'setup', label: 'Setup' },
  { id: 'faq', label: 'FAQ' },
];

export default function MarketingNav({ base = '' }) {
  const cta = useAuthCta();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
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
            className="hidden items-center gap-8 lg:flex"
          >
            {SECTIONS.map(({ id, label }) => (
              <a
                key={id}
                href={`${base}#${id}`}
                className="rounded text-sm text-stone-600 transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Auth control. Invisible until auth resolves so logged-in visitors don't see a
                "Sign in" flash that swaps to "Go to dashboard" — invisible, not absent, so it holds
                its place: the prerendered page paints before JavaScript runs, and a button that
                appeared later would shove the header sideways.

                ONE treatment in both states — an outline button. It used to be a bare text link
                when signed out and a button when signed in, so the nav gained and lost a button
                depending on who was looking. And it was `hidden sm:inline-flex`, which put the
                only way back in behind the hamburger on a phone: for a product whose users are
                provisioned-only returning traffic, hiding sign-in is the wrong trade. It is
                ~90px wide and there is room. */}
            <Link
              to={cta.to}
              aria-hidden={cta.loading || undefined}
              tabIndex={cta.loading ? -1 : undefined}
              className={`inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:px-4 ${
                cta.loading ? 'invisible' : ''
              }`}
            >
              {cta.authed ? (
                <>
                  <span className="sm:hidden">Dashboard</span>
                  <span className="hidden sm:inline">Go to dashboard</span>
                </>
              ) : (
                'Sign in'
              )}
            </Link>
            <DemoButton className="inline-flex items-center justify-center rounded-md bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:px-4">
              <span className="sm:hidden">Demo</span>
              <span className="hidden sm:inline">Request a demo</span>
            </DemoButton>

            {/* Mobile section menu toggle */}
            <button
              type="button"
              aria-label="Toggle navigation menu"
              aria-expanded={open}
              aria-controls="marketing-mobile-menu"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-900 shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 lg:hidden"
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
          className="border-t border-stone-200 bg-white lg:hidden"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6 lg:px-8">
            <ul className="flex flex-col">
              {SECTIONS.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`${base}#${id}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-2 py-3 text-sm text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {label}
                  </a>
                </li>
              ))}
              {/* No "Sign in" row here any more — the header's auth control is visible at every
                  width now, so this was a second copy of the same link one tap deeper. */}
            </ul>
          </div>
        </nav>
      )}
    </header>
  );
}
