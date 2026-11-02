import DemoButton from './DemoButton.jsx';
import SampleReport from './SampleReport.jsx';
import BrowserFrame from './frames/BrowserFrame.jsx';
import shotMap from '../assets/marketing/shot-map.webp';
import shotPhoneBooks from '../assets/marketing/shot-phone-books.webp';

// Hero — owns the page's single <h1>. Copy left; right is a real screenshot of the live campaign
// map (cropped to the map itself — client/scripts/optimizeShots.js) in browser chrome, with a
// miniature field-app card overlapping it (the "console and field app on the same map" story in one
// composition). Phones get one full-size phone screenshot instead. Background texture is a faint
// scatter of door-status dots — the product's own map vocabulary, colors mirroring lib/statusColors.js.
//
// Nothing here animates in. The hero is the first paint (and, prerendered, the whole page before
// any JavaScript runs), so it must never start invisible.
function DoorDots() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 640"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="#22C55E" opacity="0.35">
        <circle cx="80" cy="90" r="3" /><circle cx="180" cy="200" r="3" /><circle cx="90" cy="340" r="3" />
        <circle cx="300" cy="560" r="3" /><circle cx="1130" cy="80" r="3" /><circle cx="1010" cy="560" r="3" />
      </g>
      <g fill="#3B82F6" opacity="0.3">
        <circle cx="240" cy="70" r="3" /><circle cx="60" cy="490" r="3" /><circle cx="380" cy="620" r="3" />
        <circle cx="1160" cy="300" r="3" />
      </g>
      <g fill="#9CA3AF" opacity="0.35">
        <circle cx="150" cy="560" r="3" /><circle cx="320" cy="140" r="3" /><circle cx="40" cy="230" r="3" />
        <circle cx="1090" cy="180" r="3" /><circle cx="1170" cy="470" r="3" />
      </g>
    </svg>
  );
}

// A 1×1 transparent GIF. Phones are handed this instead of the map screenshot (see the <picture>
// below), so a phone on conference Wi-Fi never downloads ~200 KB for an image it can't see.
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Phones lead with ONE readable phone screenshot right under the CTAs. On a 390px screen the console
// composition rendered at ~16% scale and its overlapping phone at 82px wide, so both read as texture
// — below sm the composition is replaced, not shrunk. Same file as MiniPhone, so a wider screen that
// hides this still downloads it only once.
function PhoneHero() {
  return (
    <div className="mx-auto w-[260px] overflow-hidden rounded-[2rem] border border-stone-200 bg-white p-2 shadow-[0_20px_60px_rgba(28,25,23,0.16)] sm:hidden">
      <img
        src={shotPhoneBooks}
        alt="The Doorline field app: a canvasser's assigned book on a live map, with color-coded house pins and today's progress"
        width="1206"
        height="2622"
        fetchpriority="high"
        className="block w-full rounded-[1.5rem]"
      />
    </div>
  );
}

// A real field-app screenshot (the books map) peeking over the console map's corner — the "console
// and field app on the same map" story. Decorative, so hidden from assistive tech (the map image
// carries the descriptive alt). From sm up only: phones get PhoneHero instead.
function MiniPhone() {
  return (
    <div
      className="absolute -bottom-8 -right-2 z-10 w-32 overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(28,25,23,0.22)] lg:-bottom-10 lg:-right-3 lg:w-44 xl:w-52"
      aria-hidden="true"
    >
      <img
        src={shotPhoneBooks}
        alt=""
        width="1206"
        height="2622"
        className="block w-full rounded-[1.2rem]"
      />
    </div>
  );
}

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute -right-36 -top-32 h-[640px] w-[640px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.09), transparent 62%)' }}
        aria-hidden="true"
      />
      <DoorDots />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-10 pb-16 pt-8 sm:gap-12 sm:py-24 lg:grid-cols-[5fr_7fr]">
          <div>
            {/* One line from lg up: the copy column is ~380px at 1024 and ~433px from 1280. */}
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-600 lg:text-[13px]">
              For canvassing firms and campaigns
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-tight text-stone-900 [text-wrap:balance] sm:text-5xl xl:text-[3.4rem]">
              Cut the turf. Walk the doors.{' '}
              <em className="not-italic text-brand-600">Know exactly what happened.</em>
            </h1>
            {/* Leads with the printed AAPC ad's own subhead, word for word, so a QR scan lands on
                the sentence it just read. */}
            <p className="mt-5 max-w-[46ch] text-lg text-stone-600">
              Simple for your canvassers. Total visibility for you: every door GPS-stamped,
              suspicious knocks flagged, and every result live on one map.
            </p>
            {/* Stacked full-width below sm, side by side above, so both get a full-width tap target on a
                phone. Sign in lives in the header and footer only: the hero's second button shows the
                product — a real published report, or the Proof section until that link exists. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-3.5">
              <DemoButton className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto">
                Request a demo
              </DemoButton>
              <SampleReport variant="button" />
            </div>
            {/* The LOCAL-RACE starting price, and only that. A local race is the volume buyer and
                shops on budget, so hiding the number reads as "enterprise, can't afford it" and
                loses the lead before it exists. The tier card (District/Federal) stays an
                account-manager document — a published ceiling only anchors the races worth
                negotiating. Says "per campaign" because that IS the unit: a firm running three
                races pays three times, and "$300/month" would be the kind of surprise that sours a
                first invoice. "Every canvasser and feature included" must stay true — the printed
                AAPC ad promises "everything included", so nothing priced separately may appear
                anywhere on the site. Tracks DEFAULT_RATE_CENTS in server/src/services/billing/rate.js. */}
            <p className="mt-4 text-sm text-stone-500">
              <span className="font-semibold text-stone-700">Local races from $300 per campaign, per month.</span>{' '}
              Every canvasser and feature included.
            </p>
            {/* The app half of the sentence is a real link now — this line was the only place
                above the footer that mentioned iOS/Android, and it pointed nowhere. It is also
                the hero's whole nod to the field app: the download CTA belongs on /app, not in a
                third hero button aimed at someone who can't create an account. */}
            <p className="mt-1.5 text-sm text-stone-500">
              Web console for the office ·{' '}
              <a
                href="/app"
                className="rounded font-semibold text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 hover:decoration-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                iOS &amp; Android app for the field
              </a>
            </p>
          </div>

          <PhoneHero />

          <div className="relative hidden sm:mx-auto sm:block sm:w-full sm:max-w-xl lg:max-w-none">
            <BrowserFrame url="doorline.app/campaigns/alvarez/map">
              {/* The source only matches from sm up, where this composition shows; below that the
                  <img> keeps its blank placeholder and the screenshot is never fetched. */}
              <picture>
                <source media="(min-width: 640px)" srcSet={shotMap} />
                <img
                  src={BLANK_GIF}
                  alt="Doorline's live campaign map: color-coded house pins along real streets, each one a door and its latest result"
                  width="1400"
                  height="1042"
                  fetchpriority="high"
                  className="block w-full"
                />
              </picture>
            </BrowserFrame>
            <div
              className="absolute -left-5 top-10 z-10 hidden items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-semibold text-stone-900 shadow-[0_10px_30px_rgba(28,25,23,0.14)] lg:inline-flex"
              aria-hidden="true"
            >
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Survey recorded · synced
            </div>
            <MiniPhone />
          </div>
        </div>
      </div>
    </section>
  );
}
