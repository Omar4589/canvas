import {
  IconGauge,
  IconRouteCheck,
  IconUser,
  IconClipboard,
  IconUpload,
  IconBallot,
  IconLayers,
  IconAlertShield,
  IconVoters,
} from '../components/navIcons.jsx';

// Secondary feature grid — the rest of the operation, written for consulting
// firms. Every blurb maps to a shipped feature, and each icon is the one the console's own nav
// uses for that thing where one exists (a gauge for performance, the voters card for profiles).
const FEATURES = [
  {
    Icon: IconUpload,
    title: 'Voter file import',
    blurb:
      'CSV or Excel from i360, L2, Data Trust or any vendor — map the columns once, save the profile, preview the diff before anything writes.',
  },
  {
    Icon: IconRouteCheck,
    title: 'Passes & re-knocks',
    blurb:
      'Each pass keeps its own status, so re-knocking not-homes never muddies your counts.',
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
    Icon: IconVoters,
    title: 'Voter profiles',
    blurb:
      "Every voter's history in one place: household, party, contact record, survey answers, and notes that follow them.",
  },
  {
    Icon: IconGauge,
    title: 'Canvasser insights',
    blurb:
      'Leaderboards, hour-by-hour output, and one table that ranks every canvasser.',
  },
  {
    Icon: IconAlertShield,
    title: 'Flagged entries',
    blurb:
      'Doors recorded far from the house, seconds after the last door, or several houses from one spot get flagged for review — and Doorline warns you before you publish a client report while fake-GPS flags are open.',
  },
];

// No id/scroll-mt on the section: `id="features"` was an anchor target nothing ever linked to, and
// scroll-mt-16 exists purely to clear the sticky header for a nav anchor. The nav's five section
// links (MarketingNav SECTIONS) are the complete set.
export default function FeatureGrid() {
  return (
    <section className="bg-stone-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 lg:text-sm">
            And the rest of the operation
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Built to run many campaigns at once
          </h2>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, blurb }) => (
            <div key={title} className="h-full rounded-lg border border-stone-200 bg-white p-5">
              <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon size={20} />
              </div>
              <h3 className="text-[15px] font-bold text-stone-900">{title}</h3>
              <p className="mt-1.5 text-sm text-stone-500">{blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
