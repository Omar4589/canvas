import { SAMPLE_REPORT } from './siteFacts.js';

// "Open a sample report" — the demo campaign's published report, with its password printed beside
// it (a report link always has one). A new tab, so the page stays where the visitor left it.
//
//   variant="button"  a secondary button (the hero, the final CTA). Before the link exists it's "See
//                     how it works", to the Proof section (`proofHref`: '#proof' on the homepage,
//                     '/#proof' elsewhere) — or nothing, with fallback={false}.
//   variant="link"    a text link (the Reports section, /aapc, the final CTA). Renders nothing until
//                     the link exists.
const SECONDARY =
  'inline-flex w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto';

const Password = ({ className = '' }) => (
  <span className={`text-[13px] text-stone-500 ${className}`}>
    Password: <span className="font-mono font-semibold text-stone-700">{SAMPLE_REPORT.password}</span>
  </span>
);

const SampleReport = ({ variant = 'link', proofHref = '#proof', fallback = true, className = '' }) => {
  const ready = Boolean(SAMPLE_REPORT.url && SAMPLE_REPORT.password);

  if (variant === 'button') {
    if (!ready) {
      if (!fallback) return null;
      return (
        <a href={proofHref} className={`${SECONDARY} ${className}`}>
          See how it works
        </a>
      );
    }
    return (
      <span className={`flex flex-col items-center gap-1.5 sm:items-start ${className}`}>
        <a href={SAMPLE_REPORT.url} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
          Open a sample report
        </a>
        <Password />
      </span>
    );
  }

  if (!ready) return null;
  return (
    <p className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${className}`}>
      <a
        href={SAMPLE_REPORT.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded text-[15px] font-semibold text-brand-700 transition-colors hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
      >
        Open a sample report
        <span aria-hidden="true">→</span>
      </a>
      <Password />
    </p>
  );
};

export default SampleReport;
