import ConsoleShot from './frames/ConsoleShot.jsx';
import { Reveal } from './useReveal.jsx';
import shotTurfs from '../assets/marketing/shot-turfs.webp';
import shotTimeline from '../assets/marketing/shot-timeline.webp';
import shotPhoneBooks from '../assets/marketing/shot-phone-books.webp';
import shotPhoneDoor from '../assets/marketing/shot-phone-door.webp';

// Product tour — alternating copy + real screenshots for the three operating surfaces
// (turf cutting, the field app, live oversight), all captured from the seeded demo.
//
// `side` = which column the visual sits in ('left'|'right'). `bleed` runs the screenshot
// off that same page edge: the negative margin reaches the viewport edge exactly once the
// max-w-6xl container is at full width (≥ ~1152px): gap = (100vw − 1152)/2 + 32px padding
// = 50vw − 544px. Below that it degrades gracefully; the section's overflow-x-clip guards
// against sub-pixel scroll. Only on lg+, where the two-column layout exists.
function TourRow({ id, tag, title, children, bullets, visual, side = 'right', bleed = false }) {
  const left = side === 'left';
  const bleedClass = bleed ? (left ? 'lg:ml-[calc(544px-50vw)]' : 'lg:mr-[calc(544px-50vw)]') : '';
  return (
    <div
      id={id}
      className={`grid scroll-mt-16 grid-cols-1 items-center gap-10 py-14 sm:py-16 lg:gap-16 ${
        left ? 'lg:grid-cols-[7fr_5fr]' : 'lg:grid-cols-[5fr_7fr]'
      }`}
    >
      <Reveal className={left ? 'lg:order-2' : ''}>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">{tag}</p>
        <h3 className="mt-2.5 text-[26px] font-bold tracking-tight text-stone-900 [text-wrap:balance]">
          {title}
        </h3>
        <p className="mt-3 max-w-[52ch] text-base text-stone-500">{children}</p>
        <ul className="mt-5 grid gap-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-[14.5px] text-stone-900">
              <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={120} className={`${left ? 'lg:order-1' : ''} ${bleedClass}`}>
        {visual}
      </Reveal>
    </div>
  );
}

// A real device screenshot in a minimal phone shell (the screenshot already carries
// the iOS status bar, so no extra notch). Rounded to mimic the screen corners.
function PhoneShot({ src, alt, className = '' }) {
  return (
    <div
      className={`overflow-hidden rounded-[2rem] border border-stone-200 bg-white p-2 shadow-[0_20px_60px_rgba(28,25,23,0.16)] ${className}`}
    >
      <img
        src={src}
        alt={alt}
        width="1206"
        height="2622"
        loading="lazy"
        decoding="async"
        className="block w-full rounded-[1.5rem]"
      />
    </div>
  );
}

// Field-app visual: two real screenshots — the live books map (front) and the door
// recording screen (behind, overlapping). One phone below sm to keep it clean on mobile.
function FieldAppShots() {
  return (
    <div className="flex items-end justify-center">
      <PhoneShot
        src={shotPhoneBooks}
        alt="The Doorline field app showing a canvasser's assigned book on a live map, with color-coded house pins and today's progress"
        className="relative z-10 w-[236px] shrink-0 sm:w-[264px]"
      />
      <PhoneShot
        src={shotPhoneDoor}
        alt="The Doorline door screen: the address, the voters there, and one-tap Not home, Wrong address, and Refused buttons"
        className="-ml-14 mb-10 hidden w-[210px] shrink-0 sm:block sm:w-[232px]"
      />
    </div>
  );
}

export default function ProductTour() {
  return (
    <section id="turf" className="scroll-mt-16 overflow-x-clip bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
        <Reveal className="max-w-2xl pt-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">The product</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            From voter file to field day, one pipeline
          </h2>
          <p className="mt-4 text-base text-stone-500">
            Everything between &ldquo;the client sent us the universe&rdquo; and &ldquo;here&apos;s
            what we knocked this week&rdquo; lives in one place.
          </p>
        </Reveal>

        <TourRow
          bleed
          tag="§ Turf"
          title="Cut a universe into walkable books in minutes"
          bullets={[
            'Balanced geometric cuts with a target doors-per-book',
            'Attribute cuts by precinct, district, city, or zip',
            'Walk order optimized inside every book',
          ]}
          visual={
            <ConsoleShot
              url="doorline.app/campaigns/alvarez/turfs"
              src={shotTurfs}
              alt="Turf cutting in Doorline: color-coded walkable books cut from 1,142 doors, with per-book door counts and assigned canvassers"
              bleed="right"
              width="1600"
              height="1000"
            />
          }
        >
          Import the voter file and every door lands on the map, geocoded and deduped. Cut books
          geometrically with balanced door counts, by precinct or district, or draw them by hand —
          then re-cut between passes without losing a single knock of history.
        </TourRow>

        <TourRow
          id="field"
          side="left"
          tag="§ Field app"
          title="A field app your canvassers can't break"
          bullets={[
            'Offline-first: dead zones never cost you data',
            'Door scripts and surveys with conditional follow-ups',
            'Doors that already voted drop off the book automatically',
          ]}
          visual={<FieldAppShots />}
        >
          Canvassers open their assigned book and walk. Pins recolor the instant an outcome is
          recorded — survey, not home, refused, wrong address — and every action carries a GPS
          stamp with distance to the door. No signal? Everything queues and syncs itself.
        </TourRow>

        <TourRow
          id="oversight"
          side="left"
          bleed
          tag="§ Oversight"
          title="Watch the day unfold, door by door"
          bullets={[
            'Live map with canvasser locations and ping trails',
            'Hour-by-hour knock grid per canvasser, per day',
            'Per-canvasser quality signals: pace, distance-from-door, offline share',
          ]}
          visual={
            <ConsoleShot
              url="doorline.app/campaigns/alvarez/timeline"
              src={shotTimeline}
              alt="The daily timeline in Doorline: knocks per canvasser by hour, with overlap door-passes reconciled against real coverage"
              bleed="left"
              width="1600"
              height="1000"
            />
          }
        >
          The live map shows every pin and every canvasser ping as it happens. The daily timeline
          lays out knocks per canvasser, hour by hour — and when two walkers hit the same door,
          the overlap is caught so your coverage numbers stay honest.
        </TourRow>
      </div>
    </section>
  );
}
