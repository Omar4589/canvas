import {
  IconPin,
  IconScissors,
  IconRouteCheck,
  IconUser,
  IconClipboard,
  IconUpload,
  IconBallot,
  IconLayers,
  IconAlertShield,
} from '../components/navIcons.jsx';
import { Reveal } from './useReveal.jsx';

// Secondary feature grid — the rest of the operation, written for consulting
// firms. Every blurb maps to a shipped feature.
const FEATURES = [
  {
    Icon: IconUpload,
    title: 'Voter file import',
    blurb:
      'CSV or Excel from any vendor — map the columns once, save the profile, preview the diff before anything writes.',
  },
  {
    Icon: IconRouteCheck,
    title: 'Passes & re-knocks',
    blurb:
      'Each pass through the turf keeps its own status — re-knock not-homes without corrupting your coverage.',
  },
  {
    Icon: IconBallot,
    title: 'Early-vote tracking',
    blurb:
      "Upload the county's voted file; fully-voted doors drop off books so crews stop knocking finished houses.",
  },
  {
    Icon: IconClipboard,
    title: 'Surveys & scripts',
    blurb:
      'Question logic, read-aloud scripts, and tags — rename options freely without breaking historical counts.',
  },
  {
    Icon: IconLayers,
    title: 'Many campaigns, one login',
    blurb:
      'Every campaign is walled off with its own team, turf, and reports — run all of them from one account.',
  },
  {
    Icon: IconUser,
    title: 'Roles & team leads',
    blurb:
      'Give a lead full control of their campaign and nothing else. Canvassers only ever see their own books.',
  },
  {
    Icon: IconPin,
    title: 'Voter profiles',
    blurb:
      "Every voter's history in one place: household, party, contact record, survey answers, and notes that follow them.",
  },
  {
    Icon: IconScissors,
    title: 'Canvasser insights',
    blurb:
      'Leaderboards, hour-by-hour output, and side-by-side comparisons of every canvasser.',
  },
  {
    Icon: IconAlertShield,
    title: 'Flagged entries',
    blurb:
      'Doors marked far from the house, logged too fast to have walked, or all from one spot get flagged for you to review — and clear before you publish.',
  },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-16 bg-stone-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            And the rest of the operation
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Built to run many campaigns at once
          </h2>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, blurb }, i) => (
            <Reveal key={title} delay={(i % 3) * 70}>
              <div className="h-full rounded-lg border border-stone-200 bg-white p-5">
                <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={20} />
                </div>
                <h3 className="text-[15px] font-bold text-stone-900">{title}</h3>
                <p className="mt-1.5 text-[13px] text-stone-500">{blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
