import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { CONTACT_EMAIL } from './contact.js';
import { isValidEmail } from '../lib/validators.js';

// The demo request — the site's ONLY conversion action, and the single source of truth for it.
// All three "Request a demo" controls (nav, hero, cta band) call open() from useDemoRequest()
// rather than linking anywhere, the same way every auth CTA reads from useAuthCta(). Three
// buttons, one dialog, one form. The footer's "Contact" is deliberately NOT one of them — it
// stays a plain mailto, the escape hatch for someone who'd rather write their own email.
//
// It replaced a `mailto:`, which opened the visitor's mail client — and did VISIBLY NOTHING for
// anyone whose OS has no mail handler (webmail in a desktop browser, i.e. much of the audience
// this page is written for). A silent failure on the only way to buy.
//
// A dialog rather than a page: the CTAs sit at four different scroll depths, and sending someone
// to /demo from the footer would cost them the page they were reading. Nothing here navigates.

const DemoRequestContext = createContext(null);

/** open() — show the demo dialog. Used by every "Request a demo" control on the marketing site. */
export const useDemoRequest = () => {
  const ctx = useContext(DemoRequestContext);
  if (!ctx) throw new Error('useDemoRequest must be used inside <DemoRequestProvider>');
  return ctx;
};

const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

const FIELD_CLASS =
  'mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px] text-stone-900 ' +
  'placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-600 focus-visible:ring-offset-2';
const LABEL_CLASS = 'block text-sm font-semibold text-stone-900';

// Everything the dialog can be doing. `sending` disables submit; `sent` swaps the whole body for
// the confirmation, so the form is never re-submittable by a double click.
const IDLE = 'idle';
const SENDING = 'sending';
const SENT = 'sent';

const EMPTY = { name: '', email: '', organization: '', teamSize: '', message: '' };

const DemoDialog = ({ onClose }) => {
  const [values, setValues] = useState(EMPTY);
  const [status, setStatus] = useState(IDLE);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  // Honeypot + elapsed time are the whole bot defence, deliberately: a hosted captcha
  // (Turnstile/hCaptcha/reCAPTCHA) would be a new subprocessor, which under the signed DPA is a
  // customer-notice event rather than a code decision. The server applies both checks; these two
  // just supply the inputs.
  const honeypotRef = useRef(null);
  const openedAt = useRef(Date.now());

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const problem =
    !values.name.trim() ? 'name'
    : !isValidEmail(values.email) ? 'email'
    : !values.organization.trim() ? 'organization'
    : null;

  // Escape to close + a Tab loop that can't leave the dialog. Both listeners are removed on
  // unmount; the scroll lock restores whatever the body had rather than assuming 'visible'.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstFieldRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = priorOverflow;
    };
  }, [onClose]);

  // One in-flight submit at a time, aborted if the dialog closes mid-request — otherwise a
  // response can resolve into an unmounted dialog.
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (problem || status === SENDING) return;
    setError(null);
    setStatus(SENDING);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await api('/demo-request', {
        method: 'POST',
        public: true,
        signal: ctrl.signal,
        body: {
          name: values.name.trim(),
          email: values.email.trim(),
          organization: values.organization.trim(),
          teamSize: values.teamSize,
          message: values.message.trim(),
          company: honeypotRef.current?.value || '',
          elapsedMs: Date.now() - openedAt.current,
        },
      });
      setStatus(SENT);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(IDLE);
      setError(
        err.status === 429
          ? 'Too many requests from this network. Please email us directly.'
          : err.status === 400
            ? 'Please check the details above and try again.'
            : "We couldn't send that. Please email us directly."
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-stone-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-dialog-title"
        className="relative w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {status === SENT ? (
          <>
            <h2 id="demo-dialog-title" className="pr-10 text-2xl font-extrabold tracking-tight text-stone-900">
              Thanks — we&apos;ll be in touch.
            </h2>
            <p className="mt-3 text-[15px] text-stone-600">
              We usually reply the same day. We&apos;ll walk you through the console and the field
              app together, on a live demo campaign.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h2 id="demo-dialog-title" className="pr-10 text-2xl font-extrabold tracking-tight text-stone-900">
              See Doorline run your next canvass
            </h2>
            <p className="mt-2 text-[15px] text-stone-600">
              Tell us a little about your team and we&apos;ll set up a walkthrough.
            </p>

            <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
              {/* Honeypot. Hidden from sight AND from assistive tech, and never autofilled — a
                  person can't fill it, so anything in it came from a bot. */}
              <input
                ref={honeypotRef}
                type="text"
                name="company"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute left-[-9999px] h-px w-px opacity-0"
              />

              <div>
                <label htmlFor="demo-name" className={LABEL_CLASS}>Name</label>
                <input
                  ref={firstFieldRef}
                  id="demo-name"
                  name="name"
                  autoComplete="name"
                  value={values.name}
                  onChange={set('name')}
                  className={FIELD_CLASS}
                  placeholder="Dana Reyes"
                />
              </div>

              <div>
                <label htmlFor="demo-email" className={LABEL_CLASS}>Work email</label>
                <input
                  id="demo-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={set('email')}
                  className={FIELD_CLASS}
                  placeholder="you@campaign.org"
                />
                {touched && problem === 'email' && (
                  <p className="mt-1.5 text-[13px] text-brand-600">Please enter a valid email address.</p>
                )}
              </div>

              <div>
                <label htmlFor="demo-org" className={LABEL_CLASS}>Organization</label>
                <input
                  id="demo-org"
                  name="organization"
                  autoComplete="organization"
                  value={values.organization}
                  onChange={set('organization')}
                  className={FIELD_CLASS}
                  placeholder="Campaign, committee, or firm"
                />
              </div>

              <div>
                <label htmlFor="demo-team" className={LABEL_CLASS}>
                  Approx. team size <span className="font-normal text-stone-400">(optional)</span>
                </label>
                <select id="demo-team" name="teamSize" value={values.teamSize} onChange={set('teamSize')} className={FIELD_CLASS}>
                  <option value="">Select…</option>
                  {TEAM_SIZES.map((size) => (
                    <option key={size} value={size}>{size} canvassers</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="demo-message" className={LABEL_CLASS}>
                  Anything else? <span className="font-normal text-stone-400">(optional)</span>
                </label>
                <textarea
                  id="demo-message"
                  name="message"
                  rows={3}
                  value={values.message}
                  onChange={set('message')}
                  className={`${FIELD_CLASS} resize-y`}
                  placeholder="Races you're working, timeline, anything you want to see."
                />
              </div>

              {touched && problem && problem !== 'email' && (
                <p className="text-[13px] text-brand-600">Please fill in your {problem}.</p>
              )}
              {error && (
                <p className="rounded-lg bg-brand-50 px-3 py-2.5 text-[13px] text-brand-700">
                  {error}{' '}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline">
                    {CONTACT_EMAIL}
                  </a>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={status === SENDING}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  {status === SENDING ? 'Sending…' : 'Request a demo'}
                </button>
                {/* The address stays visible, not just as an error fallback: some people would
                    rather write their own email, and the old mailto CTA was the only way they
                    knew to reach us. */}
                <p className="text-[13px] text-stone-500">
                  or email{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="rounded font-semibold text-stone-700 underline transition-colors hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </p>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export const DemoRequestProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  // The control that opened the dialog, so focus goes back where it came from on close —
  // otherwise a keyboard user is dropped at the top of the document.
  const invoker = useRef(null);

  const openDialog = useCallback(() => {
    invoker.current = document.activeElement;
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    invoker.current?.focus?.();
    invoker.current = null;
  }, []);

  return (
    <DemoRequestContext.Provider value={{ open: openDialog }}>
      {children}
      {open && <DemoDialog onClose={closeDialog} />}
    </DemoRequestContext.Provider>
  );
};
