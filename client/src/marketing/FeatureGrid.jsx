import {
  IconRouteCheck,
  IconUser,
  IconClipboard,
  IconBallot,
  IconLayers,
  IconVoters,
  IconPrinter,
  IconClock,
  IconDownload,
} from '../components/navIcons.jsx';

// Secondary feature grid — the rest of the operation, written for firms running many campaigns.
// Every blurb maps to a shipped feature (checked: docs/PROPOSAL_AAPC_LANDING.md → "Claim check"), and
// each icon is the one the console's own nav uses for that thing where one exists. Watch the words:
// people records, do-not-contact and the survey library are shared across an organization, so a
// campaign is not "walled off"; a lead runs a campaign day to day, but can't change its billing rules,
// unknock, or run the full backup, so not "full control".
const FEATURES = [
  {
    Icon: IconLayers,
    title: 'Many campaigns, one login',
    blurb: 'Each campaign gets its own team, books and reports. Run all of them from one account.',
  },
  {
    Icon: IconUser,
    title: 'Roles and team leads',
    blurb: 'Hand a lead one campaign to run day to day, and nothing else. Canvassers only see their own books.',
  },
  {
    Icon: IconRouteCheck,
    title: 'Passes and re-knocks',
    blurb: 'Each pass keeps its own status, so re-knocking not-homes never muddies your counts.',
  },
  {
    Icon: IconBallot,
    title: 'Early-vote tracking',
    blurb: 'Upload the voted list and fully-voted households drop off every book in that campaign.',
  },
  {
    Icon: IconClipboard,
    title: 'Surveys and scripts',
    blurb: 'Branching questions, read-aloud scripts and tags. Rename an option without breaking past counts.',
  },
  {
    Icon: IconVoters,
    title: 'Voter profiles',
    blurb: 'Household, contact history, answers and notes in one place, plus an org-wide do-not-contact list.',
  },
  {
    Icon: IconPrinter,
    title: 'Lit drops and walk packets',
    blurb: 'Run lit-drop programs in the same app, or print packets when you need paper.',
  },
  {
    Icon: IconClock,
    title: 'Per-campaign time zones',
    blurb: 'Run races in different states, each on its own clock.',
  },
  {
    Icon: IconDownload,
    title: 'Export Center',
    blurb: 'Export your voters, results, survey answers and notes any time, even while your account is paused.',
  },
];

// No id/scroll-mt on the section: nothing links here. The nav's four section links (MarketingNav
// SECTIONS) are the complete set.
export default function FeatureGrid() {
  return (
    <section className="bg-stone-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 lg:text-sm">
            And the rest of the operation
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
            Built for firms running many campaigns
          </h2>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, blurb }) => (
            <div key={title} className="h-full rounded-lg border border-stone-200 bg-white p-4 sm:p-5">
              {/* The icon sits beside the title on a phone and above it from sm up: nine stacked cards
                  were the page's tallest section at 390px. */}
              <div className="flex items-center gap-3 sm:block">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 sm:mb-3.5">
                  <Icon size={20} />
                </div>
                <h3 className="text-[15px] font-bold text-stone-900">{title}</h3>
              </div>
              <p className="mt-1.5 text-sm text-stone-500">{blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
