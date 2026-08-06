import { Link } from 'react-router-dom';
import { useDemoRequest } from './DemoRequest.jsx';
import { useAuthCta } from './useAuthCta.js';
import BrowserFrame from './frames/BrowserFrame.jsx';
import { Reveal } from './useReveal.jsx';
import shotMap from '../assets/marketing/shot-map.webp';
import shotPhoneBooks from '../assets/marketing/shot-phone-books.webp';

// Hero — owns the page's single <h1>. Copy left; right is a real screenshot of
// the live campaign map in browser chrome with a miniature field-app card
// overlapping it (the "console and field app on the same map" story in one
// composition). Background texture is a faint scatter of door-status dots —
// the product's own map vocabulary, colors mirroring lib/statusColors.js.
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

// A real field-app screenshot (the books map) peeking over the console map's corner
// — the "console and field app on the same map" story. Decorative, so hidden from
// assistive tech (the map image carries the descriptive alt).
//
// Visible at EVERY width. It used to be lg-only, which meant a buyer evaluating a mobile
// canvassing product on their own phone saw no phone in the hero at all — the one audience
// most likely to want the field-app half of the story got only the console half.
function MiniPhone() {
  return (
    <div
      className="absolute -bottom-6 -right-2 z-10 w-24 overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(28,25,23,0.22)] sm:-bottom-8 sm:w-32 lg:-bottom-10 lg:-right-3 lg:w-44 xl:w-52"
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
  const cta = useAuthCta();
  const demo = useDemoRequest();
  return (
    <section className="relative overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute -right-36 -top-32 h-[640px] w-[640px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.09), transparent 62%)' }}
        aria-hidden="true"
      />
      <DoorDots />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 pb-16 pt-8 sm:py-24 lg:grid-cols-[5fr_7fr] lg:gap-12">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
              Canvassing software for campaigns and causes
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-tight text-stone-900 [text-wrap:balance] sm:text-5xl xl:text-[3.4rem]">
              Cut the turf. Walk the doors.{' '}
              <em className="not-italic text-brand-600">Know exactly what happened.</em>
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg text-stone-600">
              Doorline takes a voter file to walkable turf, puts a GPS-stamped, offline-first app
              in every canvasser&apos;s hand, and lands every door and every result on one live map
              — no clipboards, no spreadsheet.
            </p>
            {/* Stacked full-width below sm, side by side above. The row used to be a bare
                `flex flex-wrap`, which at 320-375px wrapped the second button into a ragged
                orphan against the left edge — signed in ("Go to dashboard") that happens on any
                phone, since the pair is wider than the container. Stacking is deliberate rather
                than accidental, and gives both a full-width tap target. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-3.5">
              <button
                type="button"
                onClick={demo.open}
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto"
              >
                Request a demo
              </button>
              <Link
                to={cta.to}
                className="inline-flex w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto"
              >
                {cta.label}
              </Link>
            </div>
            {/* The STARTING price, and only that. A local race is the volume buyer and shops on
                budget, so hiding the number reads as "enterprise, can't afford it" and loses the
                lead before it exists. The tier card (District/Federal) stays an account-manager
                document — a published ceiling only anchors the races worth negotiating. Says
                "per campaign" because that IS the unit: a firm running three races pays three
                times, and "$300/month" would be the kind of surprise that sours a first invoice.
                Tracks DEFAULT_RATE_CENTS in server/src/services/billing/rate.js. */}
            <p className="mt-4 text-[13px] text-stone-500">
              Starts at{' '}
              <span className="font-semibold text-stone-700">$300 per campaign, per month</span> —
              everything included.
            </p>
            {/* The app half of the sentence is a real link now — this line was the only place
                above the footer that mentioned iOS/Android, and it pointed nowhere. It is also
                the hero's whole nod to the field app: the download CTA belongs on /app, not in a
                third hero button aimed at someone who can't create an account. */}
            <p className="mt-1.5 text-[13px] text-stone-500">
              Web console for the office ·{' '}
              <a
                href="/app"
                className="rounded font-semibold text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 hover:decoration-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                iOS &amp; Android app for the field
              </a>
            </p>
          </Reveal>

          <Reveal delay={120} className="relative">
            <BrowserFrame url="doorline.app/campaigns/alvarez/map">
              <img
                src={shotMap}
                alt="Doorline's live campaign map: color-coded house pins along real streets, canvasser locations, and live survey results"
                width="2200"
                height="1375"
                fetchpriority="high"
                className="block w-full"
              />
            </BrowserFrame>
            <div
              className="absolute -left-5 top-10 z-10 hidden items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-semibold text-stone-900 shadow-[0_10px_30px_rgba(28,25,23,0.14)] lg:inline-flex"
              aria-hidden="true"
            >
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Survey recorded · synced
            </div>
            <MiniPhone />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
