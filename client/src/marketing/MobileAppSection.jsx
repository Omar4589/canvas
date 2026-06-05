import { IconDot } from '../components/navIcons.jsx';
import PhoneMockup from './mockups/PhoneMockup.jsx';

// MobileAppSection — the field-app pitch. Copy + bullets left, phone mockup right.
const BULLETS = [
  'GPS-stamped knocks logged at every door you visit',
  'Walk your assigned books and passes on the map',
  'Run door surveys and scripts, capturing responses per voter',
  "Offline action queue that syncs to the dashboard the second you're back online",
];

export default function MobileAppSection() {
  return (
    <section id="mobile" className="scroll-mt-16 bg-gray-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 sm:py-20">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            {/* Copy column */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                Built for the doorstep, ready for no signal
              </h2>
              <p className="mt-4 text-base text-gray-600">
                The Doorline mobile app puts each canvasser's assigned walk list
                in their pocket. Every knock is GPS-stamped, every survey answer
                is captured at the door, and nothing is lost when the bars drop —
                actions queue offline and sync to the dashboard automatically the
                moment the connection comes back.
              </p>
              <ul className="mt-8 space-y-4">
                {BULLETS.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-brand-600">
                      <IconDot size={18} />
                    </span>
                    <span className="text-base text-gray-600">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Mockup column */}
            <div className="flex justify-center lg:justify-end">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
