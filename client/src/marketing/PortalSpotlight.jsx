import BrowserFrame from './frames/BrowserFrame.jsx';
import shotPortal from '../assets/marketing/shot-portal.webp';

// Client-portal spotlight — the page's one bold band (soft brand wash). The
// no-login report link is the consultant-facing differentiator, so it gets its
// own section instead of a feature card.
//
// What a shared report contains is a published privacy claim (privacy.html, "report pages"), so this
// copy names only what the share link really returns — no "identity stripped" shorthand.
export default function PortalSpotlight() {
  return (
    <section id="reports" className="scroll-mt-16 border-y border-brand-100 bg-brand-50">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[5fr_6fr] lg:gap-20 lg:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 lg:text-sm">
            Reporting
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Send a report, not a spreadsheet
          </h2>
          <p className="mt-4 max-w-[54ch] text-base text-stone-600">
            Publish a report and the numbers freeze: doors knocked, contact rate, survey results and
            a map of the doors you&apos;ve covered. They change only when you refresh, and the report
            says when. Share one link and its password, and whoever needs to see it opens it. No
            accounts, no logins, no &ldquo;can you re-send the file&rdquo;.
          </p>
          <p className="mt-3 max-w-[54ch] text-base text-stone-600">
            <span className="font-semibold text-stone-900">No canvasser or voter names.</span> The map
            shows results by area — or, when you turn it on for a report, every home you&apos;ve knocked,
            with its address and answers, for the candidate or campaign manager who asks.
          </p>
          <p className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full border border-brand-200 bg-white px-4 py-1.5 text-xs text-stone-500">
            Share link · <code className="text-xs text-brand-600">doorline.app/r/kx84…</code> ·
            password-protected · expires · revocable
          </p>
        </div>
        <div>
          <BrowserFrame url="doorline.app/r/kx84…">
            <img
              src={shotPortal}
              alt="A published Doorline client report: doors knocked, surveys taken, connection rate, voter contact breakdown, and candidate support results"
              width="1600"
              height="1406"
              loading="lazy"
              decoding="async"
              className="block w-full"
            />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
