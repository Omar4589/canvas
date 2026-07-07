import BrowserFrame from './frames/BrowserFrame.jsx';
import { Reveal } from './useReveal.jsx';
import shotPortal from '../assets/marketing/shot-portal.webp';

// Client-portal spotlight — the page's one bold band (soft brand wash). The
// no-login report link is the consultant-facing differentiator, so it gets its
// own section instead of a feature card.
export default function PortalSpotlight() {
  return (
    <section id="reports" className="scroll-mt-16 border-y border-brand-100 bg-brand-50">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[5fr_6fr] lg:gap-20 lg:px-8">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            Reporting
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Send a report, not a spreadsheet
          </h2>
          <p className="mt-4 max-w-[54ch] text-base text-stone-600 text-justify">
            Publish a weekly report and the numbers freeze — coverage, contact rates, survey
            results, and a door-status map with all canvasser and voter identity stripped out.
            Share one link and whoever needs to see it just opens it. No accounts, no logins,
            no &ldquo;can you re-send the file&rdquo;.
          </p>
          <p className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full border border-brand-200 bg-white px-4 py-1.5 text-[12px] text-stone-500">
            Share link · <code className="text-[11.5px] text-brand-600">doorline.app/r/kx84…</code> ·
            optional password · revocable
          </p>
        </Reveal>
        <Reveal delay={120}>
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
        </Reveal>
      </div>
    </section>
  );
}
