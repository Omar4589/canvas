import {
  IconPin,
  IconScissors,
  IconRouteCheck,
  IconUser,
  IconClipboard,
  IconUpload,
  IconBallot,
  IconLayers,
} from '../components/navIcons.jsx';

// FeatureGrid — eight capability cards. Every blurb maps to a shipped feature.
const FEATURES = [
  {
    Icon: IconPin,
    title: 'Live canvasser map',
    blurb:
      'Turf, households, and canvasser pings on one live, auto-refreshing map — color-coded by status so you can watch coverage fill in as your team works.',
  },
  {
    Icon: IconScissors,
    title: 'Turf cutting',
    blurb:
      'Draw and split territory into walkable books right on the map — by door count, by precinct or district, or by hand.',
  },
  {
    Icon: IconRouteCheck,
    title: 'Walk lists, rounds & passes',
    blurb:
      'Organize the work into rounds and passes, assign canvassers to each book, and re-cut between passes without losing knock history.',
  },
  {
    Icon: IconUser,
    title: 'Voter directory & profiles',
    blurb:
      'Search every voter in your organization and open a full profile — household, party, contact history, and survey status.',
  },
  {
    Icon: IconClipboard,
    title: 'Surveys & door scripts',
    blurb:
      'Build the questions and scripts canvassers ask at the door, then collect responses per voter that flow straight back to the dashboard.',
  },
  {
    Icon: IconUpload,
    title: 'CSV voter import',
    blurb:
      'Bring your voter file in by CSV (with lat/long columns) and map your fields. Households land on the map, ready to cut into turf and walk.',
  },
  {
    Icon: IconBallot,
    title: 'Early-vote & voted tracking',
    blurb:
      'Mark who has voted early or already voted so your team stops knocking doors that are done and focuses where it counts.',
  },
  {
    Icon: IconLayers,
    title: 'Offline-ready sync',
    blurb:
      'Knocks and survey answers queue safely offline and sync to your dashboards the moment signal returns — nothing lost in a dead zone.',
  },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-16 bg-gray-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Everything you need to run a canvass
            </h2>
            <p className="mt-3 text-base text-gray-600">
              One platform for cutting turf, sending canvassers to the door, and
              watching the results land on your map as your team works.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, blurb }) => (
              <div
                key={title}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <Icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-gray-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-gray-600">{blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
