import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { CONTACT_EMAIL } from './contact.js';
import { isValidEmail } from '../lib/validators.js';
import { ROLES, TEAM_SIZES, HEARD_ABOUT, WHEN_AT_AAPC, WHEN_AFTER, SOURCE_PATTERN } from './demoOptions.js';
import { aapcEventPhase } from './aapc.js';

// The demo request — the site's ONLY conversion action, and the single source of truth for it.
// Every "Request a demo" control (nav, hero, cta band, /aapc) is a DemoButton (DemoButton.jsx), which
// calls open() from useDemoRequest() — the same way every auth CTA reads from useAuthCta(). Many
// buttons, one dialog, one form. The footer's "Contact" is deliberately NOT one of them — it stays a
// plain mailto, the escape hatch for someone who'd rather write their own email.
//
// It replaced a `mailto:`, which opened the visitor's mail client — and did VISIBLY NOTHING for
// anyone whose OS has no mail handler (webmail in a desktop browser, i.e. much of the audience
// this page is written for). A silent failure on the only way to buy.
//
// A dialog rather than a page: the CTAs sit at different scroll depths, and sending someone to /demo
// from the footer would cost them the page they were reading. Nothing here navigates.
//
// Every request is saved on the server as well as emailed (server/src/routes/public/demoRequest.js),
// with the ?src= tag and path of the page it came from — the Website page in the super-admin console
// lists them.

const DemoRequestContext = createContext(null);

/**
 * open(options) — show the demo dialog. Used by every "Request a demo" control on the marketing site.
 *   · source: an attribution tag for this one control. The page's own ?src= tag always wins over it,
 *     and it wins over the provider's defaultSource ('aapc' on /aapc).
 *   · askWhen: also ask "When?" (and offer a mobile number) — /aapc's "15 minutes at the event or
 *     after". Defaults to the provider's askWhen, so /aapc's controls ask unless one says otherwise
 *     (its Request a demo passes askWhen: false).
 */
export const useDemoRequest = () => {
  const ctx = useContext(DemoRequestContext);
  if (!ctx) throw new Error('useDemoRequest must be used inside <DemoRequestProvider>');
  return ctx;
};

// What the form promises (the owner's choice, Nov 2026). One place, so the intro and the thank-you
// can't disagree. SCHEDULING_URL adds a "Pick a time now" link to the thank-you once there is one.
const OWNER = 'Omar';
const REPLY_WINDOW = 'within one business day';
const WALKTHROUGH = '20-minute';
const SCHEDULING_URL = null;
// A booking (any dialog that asks When?) is a 15-minute meeting, at the event or after. There's no
// table at AAPC, so Omar emails or texts to set the time — hence the optional mobile number.
const MEETING = '15 minutes';

// The dialog's words, in two voices: about Omar on the homepage, and Omar's own on /aapc, whose page he
// signs (the provider's voice="first"; the owner's addendum 3 §7).
const WORDS = {
  third: {
    bookTitle: `Book ${MEETING} with ${OWNER}`,
    bookIntro: `Book ${MEETING} with ${OWNER}, at the event or after. He'll email or text you to set a time.`,
    demoIntro: `Tell us about your team. ${OWNER} will reply ${REPLY_WINDOW} to set up a ${WALKTHROUGH} walkthrough.`,
    bookThanks: `${OWNER} will email or text you to set a time.`,
    demoThanks: `${OWNER} will email you ${REPLY_WINDOW}.`,
  },
  first: {
    bookTitle: `Book ${MEETING} with me`,
    bookIntro: `Book ${MEETING} with me, at the event or after. I'll email or text you to set a time.`,
    demoIntro: `Tell me about your team and I'll reply ${REPLY_WINDOW} to set up a ${WALKTHROUGH} walkthrough.`,
    bookThanks: `I'll email or text you to set a time.`,
    demoThanks: `I'll email you ${REPLY_WINDOW}.`,
  },
};

// Neutral focus on the fields: a red ring reads as an error on a form. Buttons keep the brand ring.
const FIELD_CLASS =
  'mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px] text-stone-900 ' +
  'placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-300';
const LABEL_CLASS = 'block text-sm font-semibold text-stone-900';
const OPTIONAL = <span className="font-normal text-stone-500">(optional)</span>;

// Everything the dialog can be doing. `sending` disables submit; `sent` swaps the whole body for
// the confirmation, so the form is never re-submittable by a double click.
const IDLE = 'idle';
const SENDING = 'sending';
const SENT = 'sent';

const EMPTY = { name: '', email: '', organization: '', role: '', teamSize: '', heardAbout: '', when: '', phone: '', message: '' };

// The page's own ?src= tag, if it carries a valid one (the AAPC banner links /aapc?src=home-banner).
const pageSource = () => {
  try {
    const src = (new URLSearchParams(window.location.search).get('src') || '').trim().toLowerCase();
    return SOURCE_PATTERN.test(src) ? src : null;
  } catch {
    return null;
  }
};

// A number someone can be texted on: 7 to 15 digits, with the usual separators. Optional — blank passes.
// The server applies the same rule (routes/public/demoRequest.js).
const phoneProblem = (raw) => {
  const v = raw.trim();
  if (!v) return false;
  const digits = v.replace(/\D/g, '');
  return /[^0-9+().\-\s]/.test(v) || digits.length < 7 || digits.length > 15;
};

const Select = ({ id, label, value, onChange, options, display = (o) => o }) => (
  <div>
    <label htmlFor={id} className={LABEL_CLASS}>
      {label} {OPTIONAL}
    </label>
    <select id={id} name={id} value={value} onChange={onChange} className={FIELD_CLASS}>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o} value={o}>{display(o)}</option>
      ))}
    </select>
  </div>
);

const DemoDialog = ({ options, onClose }) => {
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

  // "At AAPC, Nov 17" is offered through the event day itself — the event's own clock, not the banner's
  // window (marketing/aapc.js aapcEventPhase).
  const whenOptions = aapcEventPhase() === 'before' ? [WHEN_AT_AAPC, WHEN_AFTER] : [WHEN_AFTER];
  const booking = options.askWhen;
  const words = WORDS[options.voice] || WORDS.third;

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const problem =
    !values.name.trim() ? 'name'
    : !isValidEmail(values.email) ? 'email'
    : !values.organization.trim() ? 'organization'
    : booking && phoneProblem(values.phone) ? 'phone'
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
    // Focus goes into the dialog either way (keyboard and screen-reader users land inside it), but
    // only a mouse-and-keyboard device gets the name field: on a phone, focusing a field throws the
    // keyboard up over the form before the person has read it.
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    if (finePointer) firstFieldRef.current?.focus();
    else dialogRef.current?.focus();
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
          role: values.role,
          teamSize: values.teamSize,
          heardAbout: values.heardAbout,
          when: booking ? values.when : '',
          phone: booking ? values.phone.trim() : '',
          message: values.message.trim(),
          // A tagged arrival (/aapc?src=home-banner) always wins; then this control's own tag; then the
          // page's default ('aapc' on /aapc).
          source: pageSource() || options.source || options.defaultSource || '',
          page: window.location.pathname,
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

  const firstName = values.name.trim().split(/\s+/)[0];

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
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-2xl focus:outline-none sm:rounded-2xl sm:p-7"
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
              Thanks, {firstName}.
            </h2>
            <p className="mt-3 text-[15px] text-stone-600">
              {booking ? words.bookThanks : words.demoThanks}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {SCHEDULING_URL && (
                <a
                  href={SCHEDULING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Pick a time now
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className={
                  SCHEDULING_URL
                    ? 'inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2'
                    : 'inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2'
                }
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="demo-dialog-title" className="pr-10 text-2xl font-extrabold tracking-tight text-stone-900">
              {booking ? words.bookTitle : 'See Doorline run your next canvass'}
            </h2>
            <p className="mt-2 text-[15px] text-stone-600">
              {booking ? words.bookIntro : words.demoIntro}
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
                  placeholder="you@yourfirm.com"
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
                  placeholder="Firm, campaign, or committee"
                />
              </div>

              <Select id="demo-role" label="You are" value={values.role} onChange={set('role')} options={ROLES} />
              <Select
                id="demo-team"
                label="Team size"
                value={values.teamSize}
                onChange={set('teamSize')}
                options={TEAM_SIZES}
                display={(size) => (size === 'Just me' ? size : `${size} canvassers`)}
              />
              <Select
                id="demo-heard"
                label="How did you hear about us?"
                value={values.heardAbout}
                onChange={set('heardAbout')}
                options={HEARD_ABOUT}
              />
              {booking && (
                <>
                  <Select id="demo-when" label="When?" value={values.when} onChange={set('when')} options={whenOptions} />
                  <div>
                    <label htmlFor="demo-phone" className={LABEL_CLASS}>
                      Mobile number (for a text) {OPTIONAL}
                    </label>
                    <input
                      id="demo-phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={values.phone}
                      onChange={set('phone')}
                      className={FIELD_CLASS}
                    />
                    {touched && problem === 'phone' && (
                      <p className="mt-1.5 text-[13px] text-brand-600">Please enter a number we can text, or leave it blank.</p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label htmlFor="demo-message" className={LABEL_CLASS}>
                  Anything else? {OPTIONAL}
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

              {touched && problem && problem !== 'email' && problem !== 'phone' && (
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

// defaultSource: the tag a request from this page carries when its URL has none ('aapc' on /aapc).
// askWhen: whether the page's controls book a meeting (When? + mobile number) unless one says otherwise —
// /aapc. voice: 'third' (about Omar, the homepage) or 'first' (Omar's own words, /aapc).
export const DemoRequestProvider = ({ children, defaultSource = null, askWhen = false, voice = 'third' }) => {
  // null = closed; otherwise the options open() was called with.
  const [openWith, setOpenWith] = useState(null);
  // The control that opened the dialog, so focus goes back where it came from on close —
  // otherwise a keyboard user is dropped at the top of the document.
  const invoker = useRef(null);

  // Buttons pass their click event straight in (onClick={demo.open}), so anything that isn't a plain
  // options object is treated as "no options".
  const openDialog = useCallback(
    (opts) => {
      invoker.current = document.activeElement;
      const o = opts && typeof opts === 'object' && !('nativeEvent' in opts) ? opts : {};
      setOpenWith({ source: o.source || null, defaultSource, askWhen: o.askWhen ?? askWhen, voice });
    },
    [defaultSource, askWhen, voice]
  );

  const closeDialog = useCallback(() => {
    setOpenWith(null);
    invoker.current?.focus?.();
    invoker.current = null;
  }, []);

  return (
    <DemoRequestContext.Provider value={{ open: openDialog }}>
      {children}
      {openWith && <DemoDialog options={openWith} onClose={closeDialog} />}
    </DemoRequestContext.Provider>
  );
};
