import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/index.js';
import { GOT_IT, GUIDE_TITLE, HELP_LINE, HELP_PATH, PHONE_STEPS, STEPS } from './howItWorksCopy.js';

// How it works (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §B): a light card at the top of the reports
// card, above the tabs — on an empty page it stands where "No reports yet" would. Three numbered steps,
// Got it, and the Help Center's client-reports guide; phones (below 640 px, Tailwind's `sm`) get the
// short lines and no Help line. The words live in howItWorksCopy.js, which the Help Center quotes.
//
// Got it is a per-viewer convenience kept in the operator's own browser, per user:
// localStorage['doorline.clientReports.howItWorks.<userId>'] = '1' (a UI flag, no personal data —
// PRIVACY_VERIFICATION item 38's device storage). Every read and write is in try/catch: a private
// window or blocked site data simply shows the guide again next time.

/** Where one person's Got it is kept. */
export const howItWorksKey = (userId) => `doorline.clientReports.howItWorks.${userId || 'anonymous'}`;

const readDismissed = (key) => {
  try {
    return globalThis.localStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeDismissed = (key, dismissed) => {
  try {
    if (dismissed) globalThis.localStorage?.setItem(key, '1');
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage blocked: Got it still hides the guide for this visit; it shows again next time.
  }
};

/**
 * Whether the guide shows for this person: until they press Got it; How it works brings it back (and
 * keeps it until Got it again). Re-read when the person changes.
 */
export const useHowItWorks = (userId) => {
  const key = howItWorksKey(userId);
  const [state, setState] = useState(() => ({ key, open: !readDismissed(key) }));
  const open = state.key === key ? state.open : !readDismissed(key);
  const dismiss = () => {
    writeDismissed(key, true);
    setState({ key, open: false });
  };
  const reopen = () => {
    writeDismissed(key, false);
    setState({ key, open: true });
  };
  return { open, dismiss, reopen };
};

/** The guide. `focusAt` changes when How it works is pressed: the guide is brought into view and focused. */
const HowItWorks = ({ onDismiss, focusAt = 0 }) => {
  const headingRef = useRef(null);
  useEffect(() => {
    if (!focusAt) return;
    headingRef.current?.scrollIntoView?.({ block: 'nearest' });
    headingRef.current?.focus?.();
  }, [focusAt]);
  return (
    <section aria-labelledby="client-reports-how-it-works" className="mb-4 rounded-lg border border-border bg-sunken/60 p-4">
      <h2 id="client-reports-how-it-works" ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-fg focus:outline-none">
        {GUIDE_TITLE}
      </h2>
      <ol className="mt-2 hidden list-decimal space-y-1.5 pl-5 text-sm text-fg-muted marker:font-semibold marker:text-fg sm:block">
        {STEPS.map((s) => (
          <li key={s.title}>
            <span className="font-semibold text-fg">{s.title}</span> — {s.body}
          </li>
        ))}
      </ol>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-muted marker:font-semibold marker:text-fg sm:hidden">
        {PHONE_STEPS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <Link to={HELP_PATH} className="hidden text-sm font-semibold text-brand-accent hover:underline sm:inline">
          {HELP_LINE}
        </Link>
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          {GOT_IT}
        </Button>
      </div>
    </section>
  );
};

export default HowItWorks;
