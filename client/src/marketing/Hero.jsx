import { Link } from 'react-router-dom';
import { demoMailto } from './contact.js';
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
function MiniPhone() {
  return (
    <div
      className="absolute -bottom-10 -right-3 z-10 hidden w-44 overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(28,25,23,0.22)] lg:block xl:w-52"
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
        <div className="grid grid-cols-1 items-center gap-12 py-12 sm:py-24 lg:grid-cols-[5fr_7fr] lg:gap-12">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">
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
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a
                href={demoMailto()}
                className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Request a demo
              </a>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-stone-400">
              Web console for the office · iOS &amp; Android app for the field
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
