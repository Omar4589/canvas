import BrowserFrame from './frames/BrowserFrame.jsx';
import shotAudit from '../assets/marketing/shot-audit.webp';
import shotLocations from '../assets/marketing/shot-locations.webp';

// Proof — the reason a firm switches: every door recorded in the app is checked against its house,
// and the knocks that don't add up are flagged. A light band on purpose: the brief drew it dark, and
// Doorline's brand is light with a red accent (the owner, 2026-11-01).
//
// Every line is checked against the code (docs/PROPOSAL_AAPC_LANDING.md → "Claim check"). Watch:
//   · "every LIVE count" — a published client report keeps its numbers until someone refreshes it;
//   · fake-GPS detection is Android only (iOS reports nothing);
//   · the publish warning counts open fake-GPS flags only;
//   · billing counts by month, hence "each month".
// `#oversight` stays as an alias: the static pages (privacy, terms, app, delete-account, 404) link to
// it from before this section existed.
const BULLETS = [
  'Flags doors recorded far from the house, seconds after the last door, or several houses from one spot',
  'Catches fake-GPS apps on Android',
  'Warns you before you publish a client report with fake-GPS flags still open',
  'Hour-by-hour knocks per canvasser, with overlapping knocks counted once',
  'Shows where each result was recorded from, with a line to its house',
  'Numbers by pass, book and canvasser',
  'A door count you can invoice from: once per door per pass each month, with unknocked entries removed',
];

const ProofSection = () => (
  <section id="proof" className="scroll-mt-16 border-y border-stone-200 bg-stone-100">
    <span id="oversight" className="block scroll-mt-16" aria-hidden="true" />
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-10 px-4 py-16 sm:gap-12 sm:px-6 sm:py-24 lg:grid-cols-[5fr_6fr] lg:gap-16 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 lg:text-sm">§ Proof</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
          Catch fake knocks before anyone pays for them
        </h2>
        <p className="mt-4 max-w-[54ch] text-base text-stone-600">
          Every door recorded in the app carries a GPS stamp and its distance to the house. Doorline
          flags the knocks that don&apos;t add up and puts them on your Audit page within seconds of
          syncing. Review them, fix them, or unknock them; an unknocked entry drops out of every live
          count, and out of a client report when you refresh it.
        </p>
        <ul className="mt-6 grid gap-2.5">
          {BULLETS.map((b) => (
            <li key={b} className="flex gap-2.5 text-[14.5px] text-stone-900 lg:text-base">
              <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
      </div>
      {/* Both shots from sm up; a phone gets the map alone (the dense Audit table reads as texture at 360px). */}
      <div className="grid gap-5">
        <BrowserFrame url="doorline.app/campaigns/alvarez/audit" className="hidden sm:block">
          <img
            src={shotAudit}
            alt="Doorline's Audit page: flagged door results with the reason for each flag, ready to review"
            width="1600"
            height="1209"
            loading="lazy"
            decoding="async"
            className="block w-full"
          />
        </BrowserFrame>
        <BrowserFrame url="doorline.app/campaigns/alvarez/map">
          <img
            src={shotLocations}
            alt="The live map with canvasser locations on: where each result was recorded from, with a line to its house"
            width="1600"
            height="1209"
            loading="lazy"
            decoding="async"
            className="block w-full"
          />
        </BrowserFrame>
      </div>
    </div>
  </section>
);

export default ProofSection;
