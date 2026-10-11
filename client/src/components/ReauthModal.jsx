import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getToken } from '../api/client.js';
import { REAUTH_TITLE, reauthBody, isPublicPath } from '../lib/sessionEnd.js';
import PasswordInput from './PasswordInput.jsx';
import Logo from './Logo.jsx';

// The password, in place. When a sign-in runs out the console does NOT navigate away: this prompt
// covers the page, and typing the password continues exactly where the person was — the same
// page, the same org, the same unsaved edits underneath (AuthContext.reauthenticate). The page
// copy matches the phone's word for word (lib/sessionEnd.js, with a parity test).
//
// Mounted once, at the app root (App.jsx), so it also covers select-org and change-password, which
// render outside Layout. It renders while the token it was raised for is still the stored one, or
// while no token is stored at all (another tab signed out); never on a public page. A different
// stored token is settled by AuthContext (the same person continues; anyone else goes to /login).
//
// It has to win against everything already on screen: drawers and modals portal to document.body
// at z-50 and close on Escape (ui/Overlay.jsx). So this portals to the body at z-[60], makes every
// other body child `inert`, and catches Escape and Tab on window in the capture phase — Escape
// never reaches a drawer underneath (which would throw its edits away), and Tab never leaves the
// prompt. Opaque, so a forgotten shared computer shows nothing behind it.
//
// See docs/PROPOSAL_SESSION_EXPIRY.md section E.
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

const ReauthDialog = ({ reauth }) => {
  const { reauthenticate, logout, touchReauth } = useAuth();
  const [email, setEmail] = useState(reauth.identity?.email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const passwordWrapRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    // Put focus back where it was (an open drawer's field, say) when the prompt closes.
    const restoreFocus = document.activeElement;
    // Everything else on the page — the app root and any open drawer — becomes inert. Elements
    // someone else already made inert are left to them.
    const others = [...document.body.children].filter((el) => el !== container && !el.hasAttribute('inert'));
    others.forEach((el) => el.setAttribute('inert', ''));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const start = reauth.identity?.email
      ? passwordWrapRef.current?.querySelector('input')
      : panel?.querySelector('input[type="email"]');
    (start || panel)?.focus?.();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Tab' && panel) {
        e.stopPropagation();
        const items = panel.querySelectorAll(FOCUSABLE);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      others.forEach((el) => el.removeAttribute('inert'));
      document.body.style.overflow = prevOverflow;
      if (restoreFocus?.isConnected) restoreFocus.focus?.();
    };
    // Mount-once: the dialog is keyed by the token it was raised for (see ReauthModal below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    touchReauth();
    try {
      await reauthenticate(email.trim(), password);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onNotYou = () => {
    logout();
    window.location.assign('/login');
  };

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-sunken px-4 py-12 sm:items-center"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-body"
        tabIndex={-1}
        className="w-full max-w-sm outline-none"
      >
        <div className="mb-8 flex flex-col items-center">
          <Logo size={40} />
        </div>
        <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 id="reauth-title" className="text-base font-semibold text-fg">
            {REAUTH_TITLE}
          </h1>
          <p id="reauth-body" className="mt-1 text-sm text-fg-muted">
            {reauthBody(reauth.reason)}
          </p>

          <label htmlFor="reauth-email" className="mt-5 block text-xs font-semibold text-fg-muted">
            Email address
          </label>
          <input
            id="reauth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />

          <label className="mt-4 block text-xs font-semibold text-fg-muted">Password</label>
          <div className="mt-1" ref={passwordWrapRef}>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-md bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="mt-4 flex items-center justify-between text-xs">
            {/* A new tab, so this page and its unsaved work stay put while the reset happens. */}
            <a
              href="/forgot-password"
              target="_blank"
              rel="noopener noreferrer"
              // The reset window runs from here: a password changed within half an hour keeps this
              // prompt (and the page under it) in place.
              onClick={touchReauth}
              className="font-semibold text-brand-accent hover:underline"
            >
              Forgot password?
            </a>
            <button type="button" onClick={onNotYou} className="text-fg-muted hover:underline">
              Not you? Sign out
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

const ReauthModal = () => {
  const { reauth } = useAuth();
  const location = useLocation();
  if (!reauth || isPublicPath(location.pathname)) return null;
  // Raised for the token still stored — or for a tab whose token another tab removed (a sign-out
  // or a password reset there): the prompt stays and keeps this tab's work until the person
  // decides. Hidden when a different token is stored, until AuthContext settles it (its storage
  // listener, or the backstop that runs on every page change).
  const stored = getToken();
  if (stored !== reauth.sentToken && stored !== null) return null;
  return <ReauthDialog key={reauth.sentToken} reauth={reauth} />;
};

export default ReauthModal;
