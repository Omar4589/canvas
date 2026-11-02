import BrowserFrame from './frames/BrowserFrame.jsx';
import PhoneShot from './frames/PhoneShot.jsx';
import shotTurfs from '../assets/marketing/shot-turfs.webp';
import shotPhoneBooks from '../assets/marketing/shot-phone-books.webp';

// Setup — from the voter file to the first knock: the office side (import and turf) and the field
// side (the app). "Often the same day" until a measured report backs "usually" (PROPOSAL_AAPC_LANDING
// decision 5). Doorline never obtains a voter file for anyone — it connects them with a vendor.
// `#turf`, `#field` and `#how` stay as aliases: the static pages link to them from before this
// section existed.
const SetupSection = () => (
  <section id="setup" className="scroll-mt-16 bg-white">
    <span id="turf" className="block scroll-mt-16" aria-hidden="true" />
    <span id="how" className="block scroll-mt-16" aria-hidden="true" />
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">§ Setup</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
          From voter file to knocking, often the same day
        </h2>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-12 sm:mt-12 sm:gap-14 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col">
          <h3 className="text-[22px] font-bold tracking-tight text-stone-900">Bring any voter file</h3>
          <p className="mt-3 max-w-[56ch] text-base text-stone-600">
            Upload the CSV or Excel file from i360, L2, Data Trust, the state or your client. Doorline
            recognizes their columns, shows what will change before anything is written, and maps every
            address it can match; the rest wait for you to place by hand. Cut balanced books to the size
            you want, by precinct or district, or draw them by hand. Re-cut between passes without losing
            knock history.
          </p>
          <p className="mt-3 text-base font-semibold text-stone-900">
            Need a voter file? We&apos;ll connect you with a vendor.
          </p>
          <BrowserFrame url="doorline.app/campaigns/alvarez/turfs" className="mt-8">
            <img
              src={shotTurfs}
              alt="Turf cutting in Doorline: color-coded walkable books cut from 1,142 doors, with per-book door counts and assigned canvassers"
              width="1600"
              height="1000"
              loading="lazy"
              decoding="async"
              className="block w-full"
            />
          </BrowserFrame>
        </div>
        <div id="field" className="flex scroll-mt-16 flex-col">
          <h3 className="text-[22px] font-bold tracking-tight text-stone-900">A field app your canvassers can&apos;t break</h3>
          <p className="mt-3 max-w-[56ch] text-base text-stone-600">
            Canvassers get an invite email, set a password and sign in, with no separate app account. They
            open their book and knock: pins change color as they go, scripts and surveys follow your logic,
            and fully-voted households drop off once you upload the voted list. No signal? Doors and
            surveys save on the phone and send as soon as there&apos;s signal again.
          </p>
          {/* Tertiary on purpose: /app is the canvasser's install page, never a rival to "Request a
              demo". A full page load — /app is a static document, not a React route. */}
          <a
            href="/app"
            className="mt-4 inline-flex items-center gap-1.5 self-start rounded text-[15px] font-semibold text-brand-700 transition-colors hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            How canvassers get the app
            <span aria-hidden="true">→</span>
          </a>
          {/* From sm up only: on a phone the hero already shows this same screenshot full size. */}
          <PhoneShot
            src={shotPhoneBooks}
            alt="The Doorline field app: a canvasser's assigned book on a live map, with color-coded house pins and today's progress"
            className="mx-auto mt-8 hidden w-[270px] sm:block"
          />
        </div>
      </div>
    </div>
  </section>
);

export default SetupSection;
