import ConsoleShot from './frames/ConsoleShot.jsx';
import shotTurfs from '../assets/marketing/shot-turfs.webp';
import shotTimeline from '../assets/marketing/shot-timeline.webp';
import shotPhoneBooks from '../assets/marketing/shot-phone-books.webp';
import shotPhoneSurvey from '../assets/marketing/shot-phone-survey.webp';

// Product tour — alternating copy + real screenshots for the three operating surfaces
// (turf cutting, the field app, live oversight), all captured from the seeded demo.
//
// `side` = which column the visual sits in ('left'|'right'). `bleed` runs the screenshot
// off that same page edge: the negative margin reaches the viewport edge exactly once the
// max-w-6xl container is at full width (≥ ~1152px): gap = (100vw − 1152)/2 + 32px padding
// = 50vw − 544px. Below that it degrades gracefully; the section's overflow-x-clip guards
// against sub-pixel scroll. Only on lg+, where the two-column layout exists.
// `footer` is an optional node under the bullets. Only the Field app row uses one: it is the
// single tour row the nav links to directly (#field), and until that link existed the section a
// visitor deliberately navigated to was a dead end with nothing clickable in it.
//
// Copy is left-aligned on purpose: justified text in a ~52ch column opened rivers of uneven word
// gaps, worst on a phone. Every claim here is checked against the code — "Words to avoid" in
// docs/MARKETING_SITE.md lists the phrasings that overstate it.
function TourRow({ id, tag, title, children, bullets, visual, footer, side = 'right', bleed = false }) {
  const left = side === 'left';
  const bleedClass = bleed ? (left ? 'lg:ml-[calc(544px-50vw)]' : 'lg:mr-[calc(544px-50vw)]') : '';
  return (
    <div
      id={id}
      className={`grid scroll-mt-16 grid-cols-1 items-center gap-10 py-14 sm:py-16 lg:gap-20 ${
        left ? 'lg:grid-cols-[7fr_5fr]' : 'lg:grid-cols-[5fr_7fr]'
      }`}
    >
      <div className={left ? 'lg:order-2' : ''}>
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-stone-500">{tag}</p>
        <h3 className="mt-2.5 text-[26px] font-bold tracking-tight text-stone-900 [text-wrap:balance] lg:text-[30px]">
          {title}
        </h3>
        <p className="mt-3 max-w-[52ch] text-base text-stone-500 lg:text-[17px]">{children}</p>
        <ul className="mt-5 grid gap-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-[14.5px] text-stone-900 lg:text-base">
              <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
        {footer}
      </div>
      <div className={`${left ? 'lg:order-1' : ''} ${bleedClass}`}>{visual}</div>
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
        className="relative z-10 w-[236px] shrink-0 sm:w-[296px]"
      />
      <PhoneShot
        src={shotPhoneSurvey}
        alt="The Doorline survey screen: a door script, the support question with read-aloud text, and conditional follow-up questions"
        className="-ml-14 mb-10 hidden w-[210px] shrink-0 sm:block sm:w-[260px]"
      />
    </div>
  );
}

export default function ProductTour() {
  return (
    <section id="turf" className="scroll-mt-16 overflow-x-clip bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
        <div className="max-w-2xl pt-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">The product</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            From voter file to field day, one pipeline
          </h2>
          <p className="mt-4 text-base text-stone-500">
            Everything between &ldquo;the client sent us the universe&rdquo; and &ldquo;here&apos;s
            what we knocked this week&rdquo; lives in one place.
          </p>
        </div>

        <TourRow
          bleed
          tag="§ Turf"
          title="Cut a universe into walkable books"
          bullets={[
            'Balanced geometric cuts with a target doors-per-book',
            'Attribute cuts by precinct, district, city, or zip',
            'Every book comes with a walk order',
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
          Import the voter file from i360, L2, Data Trust or any vendor, and every address Doorline
          can match lands on the map; the rest wait for you to place by hand. Cut books
          geometrically with balanced door counts, by precinct or district, or draw them by hand —
          then re-cut between passes without losing knock history.
        </TourRow>

        <TourRow
          id="field"
          side="left"
          tag="§ Field app"
          title="A field app your canvassers can't break"
          bullets={[
            "No signal? Doors and surveys save on the phone and send once there's signal",
            'Door scripts and surveys with conditional follow-ups',
            'Fully-voted households drop off once you upload the voted list',
          ]}
          visual={<FieldAppShots />}
          footer={
            // Tertiary on purpose. The section's job is to sell the field app to the BUYER, and
            // /app is the utility page for the canvasser they'll hand it to — worth reaching,
            // never worth competing with "Request a demo". A full page load: /app is an
            // Express-served static document, not a React route.
            <a
              href="/app"
              className="mt-5 inline-flex items-center gap-1.5 rounded text-[14.5px] font-semibold text-brand-600 transition-colors hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              How canvassers get the app
              <span aria-hidden="true">→</span>
            </a>
          }
        >
          Canvassers get an invite email, set a password and sign in — no separate app account. They
          open their assigned book and walk: pins change color as they go — survey, not home,
          refused, wrong address, no soliciting, restricted access — and every door recorded carries
          a GPS stamp with its distance to the house.
        </TourRow>

        <TourRow
          id="oversight"
          side="left"
          bleed
          tag="§ Oversight"
          title="Watch the day unfold, door by door"
          bullets={[
            'Live map that shows where each result was recorded from, with a line to its house',
            'Hour-by-hour knocks per canvasser, with overlapping knocks counted once',
            'Flags doors recorded far from the house, seconds after the last door, or several houses from one spot',
          ]}
          visual={
            <ConsoleShot
              url="doorline.app/campaigns/alvarez/timeline"
              src={shotTimeline}
              alt="The daily timeline in Doorline: knocks per canvasser by hour, with overlapping door visits reconciled"
              bleed="left"
              width="1600"
              height="1000"
            />
          }
        >
          The live map fills in as results come in. The daily timeline lays out knocks per
          canvasser, hour by hour — and when two walkers hit the same door, it counts once, so your
          totals stay honest. Doorline flags the knocks that don&apos;t add up for you to review, and
          warns you before you publish a client report while fake-GPS flags are still open.
        </TourRow>
      </div>
    </section>
  );
}
