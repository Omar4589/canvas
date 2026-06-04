// HowItWorks — three numbered steps from voter file to a live, mapped canvass.
const STEPS = [
  {
    n: 1,
    title: 'Import & cut turf',
    body:
      'Upload your voter file by CSV (with lat/long) and map your fields. Households drop onto the map, then you cut the area into walkable books — by door count, by district, or by drawing on the map.',
  },
  {
    n: 2,
    title: 'Assign & knock',
    body:
      'Assign books to canvassers across rounds and passes. In the field, your team works walk lists in the mobile app — GPS-stamping every knock and logging survey answers, even with no signal.',
  },
  {
    n: 3,
    title: 'Track your canvass',
    body:
      'Back in the console, watch your live map fill in as your team works — track coverage and door results, mark early and already-voted status, and re-cut turf for the next pass.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              How Doorline works
            </h2>
            <p className="mt-3 text-base text-gray-600">
              From raw voter file to a live map of your canvass in three steps.
            </p>
          </div>

          <ol className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {STEPS.map(({ n, title, body }) => (
              <li key={n}>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {n}
                </span>
                <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-gray-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
