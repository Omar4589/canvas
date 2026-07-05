import BrowserFrame from './frames/BrowserFrame.jsx';
import PhoneFrame from './frames/PhoneFrame.jsx';
import { Reveal } from './useReveal.jsx';
import shotTurfs from '../assets/marketing/shot-turfs.webp';
import shotTimeline from '../assets/marketing/shot-timeline.webp';

// Product tour — alternating copy + real screenshots for the three operating
// surfaces (turf cutting, the field app, live oversight). The field-app visual
// is a CSS-drawn walk list inside a phone shell until device captures land;
// swap it for an <img> when shot-phone-*.webp exists.
function TourRow({ id, tag, title, children, bullets, visual, flip = false }) {
  return (
    <div
      id={id}
      className={`grid scroll-mt-16 grid-cols-1 items-center gap-10 py-14 sm:py-16 lg:gap-16 ${
        flip ? 'lg:grid-cols-[7fr_5fr]' : 'lg:grid-cols-[5fr_7fr]'
      }`}
    >
      <Reveal className={flip ? 'lg:order-2' : ''}>
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
      <Reveal delay={120} className={flip ? 'lg:order-1' : ''}>
        {visual}
      </Reveal>
    </div>
  );
}

// Interim field-app visual (real product colors + real demo addresses).
function FieldAppSketch() {
  const rows = [
    { dot: 'bg-green-500', addr: '3812 38th Street', meta: '3 voters · surveyed' },
    { dot: 'bg-blue-500', addr: '3816 38th Street', meta: '2 voters · not home' },
    { dot: 'bg-gray-400', addr: '3820 38th Street', meta: '4 voters', knock: true },
    { dot: 'bg-gray-400', addr: '2711 Franklin Avenue', meta: '1 voter' },
  ];
  return (
    <PhoneFrame className="mx-auto w-[290px]">
      <div role="img" aria-label="The Doorline field app: a walk list of doors with status colors, a Knock button, and an offline sync indicator">
        <div className="flex items-center justify-between border-b border-stone-200 px-2 pb-2.5 pt-1 text-[12.5px] font-bold text-stone-900">
          Book 7 <span className="font-semibold text-stone-500">Pass 1</span>
        </div>
        {rows.map((r) => (
          <div key={r.addr} className="flex items-center justify-between gap-2 border-b border-stone-100 px-2 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.dot}`} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-stone-900">{r.addr}</div>
                <div className="text-[11px] text-stone-500">{r.meta}</div>
              </div>
            </div>
            {r.knock && (
              <span className="shrink-0 rounded-md bg-brand-600 px-2.5 py-1 text-[11.5px] font-bold text-white">
                Knock
              </span>
            )}
          </div>
        ))}
        <div className="mx-2 my-3 rounded-full bg-stone-100 px-2.5 py-1.5 text-center text-[11px] text-stone-500">
          Offline — 4 actions queued, will sync automatically
        </div>
      </div>
    </PhoneFrame>
  );
}

export default function ProductTour() {
  return (
    <section id="turf" className="scroll-mt-16 bg-white">
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
          tag="§ Turf"
          title="Cut a universe into walkable books in minutes"
          bullets={[
            'Balanced geometric cuts with a target doors-per-book',
            'Attribute cuts by precinct, district, city, or zip',
            'Walk order optimized inside every book',
          ]}
          visual={
            <BrowserFrame url="doorline.app/campaigns/alvarez/turfs">
              <img
                src={shotTurfs}
                alt="Turf cutting in Doorline: 21 color-coded walkable books cut from 1,142 doors, with per-book door counts and assigned canvassers"
                width="1600"
                height="1000"
                loading="lazy"
                decoding="async"
                className="block w-full"
              />
            </BrowserFrame>
          }
        >
          Import the voter file and every door lands on the map, geocoded and deduped. Cut books
          geometrically with balanced door counts, by precinct or district, or draw them by hand —
          then re-cut between passes without losing a single knock of history.
        </TourRow>

        <TourRow
          id="field"
          flip
          tag="§ Field app"
          title="A field app your canvassers can't break"
          bullets={[
            'Offline-first: dead zones never cost you data',
            'Door scripts and surveys with conditional follow-ups',
            'Doors that already voted drop off the book automatically',
          ]}
          visual={<FieldAppSketch />}
        >
          Canvassers open their assigned book and walk. Pins recolor the instant an outcome is
          recorded — survey, not home, refused, wrong address — and every action carries a GPS
          stamp with distance to the door. No signal? Everything queues and syncs itself.
        </TourRow>

        <TourRow
          id="oversight"
          tag="§ Oversight"
          title="Watch the day unfold, door by door"
          bullets={[
            'Live map with canvasser locations and ping trails',
            'Hour-by-hour knock grid per canvasser, per day',
            'Per-canvasser quality signals: pace, distance-from-door, offline share',
          ]}
          visual={
            <BrowserFrame url="doorline.app/campaigns/alvarez/timeline">
              <img
                src={shotTimeline}
                alt="The daily timeline in Doorline: knocks per canvasser by hour, with overlap door-passes reconciled against real coverage"
                width="1600"
                height="1000"
                loading="lazy"
                decoding="async"
                className="block w-full"
              />
            </BrowserFrame>
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
