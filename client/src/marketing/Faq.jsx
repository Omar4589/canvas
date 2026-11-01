// FAQ — answers the objections a buyer actually raises before a demo call.
// Static (no accordion): short answers read faster than clicks. Each answer is checked against the
// code; docs/MARKETING_SITE.md → "Words to avoid" lists the phrasings that overstate it.
const ITEMS = [
  {
    q: 'How fast can we be knocking doors?',
    a: "Usually the same day. Send your voter file in any vendor's format; once it's imported and cut, your crews install the app and walk. We set up your first campaign with you on the demo call.",
  },
  {
    q: 'What do we need to get started?',
    a: "A voter file with addresses and state voter IDs, as CSV or Excel, from i360, L2, Data Trust, the state or your client. Don't have one? We'll help you get one.",
  },
  {
    q: 'What happens when a canvasser loses signal?',
    a: "They keep knocking. Doors and surveys save on the phone and send as soon as there's signal again. Anything recorded offline is marked so you can audit it.",
  },
  {
    q: "How do you catch canvassers who don't actually knock?",
    a: 'Every door is GPS-stamped with its distance to the house. Doorline flags doors recorded far from the house, seconds after the last door, or several from one spot, plus fake-GPS apps on Android. Flags land on your Audit page within seconds of syncing, and Doorline warns you before you publish a client report with fake-GPS flags still open.',
  },
  {
    // The answer to a live-tracking assumption, and a published promise (privacy.html: location is
    // collected only when an action is recorded, never continuously or in the background).
    q: 'Do you track canvassers all day?',
    a: "No. Location is recorded only when a canvasser records a door. That's what gets verified; nothing is tracked between doors.",
  },
  {
    // The map is by area unless the report's house-level map is turned on — an opt-in, behind a warning,
    // for when the candidate or campaign manager wants to see every home (owner ruling, 2026-11-01).
    q: "What's in a shared report?",
    a: "Only what you publish: doors, contact rate, survey results and a map. The map shows results by area, unless you turn on the house-level map for that report — then whoever has the link sees every home you've knocked, with its address and answers. No canvasser or voter names. Links are password-protected, expire on their own and can be revoked.",
  },
  {
    q: 'Can different teams work the same campaign?',
    a: "Yes. Split it into walk lists, each with its own crew, passes and survey. Every door belongs to one list, so teams don't double-knock each other.",
  },
  {
    // A BUYER's objection ("am I about to spend a week doing IT support for 40 people?"), not a
    // canvasser's question — which is why it belongs here rather than in the Help Center, whose
    // articles are login-walled and written for people who already have an account.
    q: 'How do canvassers get set up?',
    a: "Add them in the console. They get an email, set a password, install the app and sign in; there's no separate app account. The link is good for 72 hours, and you can resend it or set a temporary password.",
  },
  {
    // The fuller answer behind the hero's price line. "Sized to the race" is deliberate: it
    // signals bigger races cost more without publishing the tier table, which belongs in the
    // account manager's proposal. What everything-included buys us is the comparison — the
    // per-seat/support/storage/dashboard add-ons a consultant is used to pricing separately — and
    // the printed AAPC ad promises it, so no add-on may ever appear on the site.
    q: 'What does it cost?',
    a: 'A flat monthly rate per campaign, sized to the race. Local races start at $300 per campaign, per month, with every canvasser, feature and door included. No per-seat fees, per-door charges or add-ons. Setup is free, and billing starts the month of your first knock. Request a demo and we\'ll quote your race.',
  },
];

export default function Faq() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            Common questions
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">
            Before you ask
          </h2>
        </div>
        <div className="mt-10 grid max-w-3xl gap-2.5">
          {ITEMS.map((item) => (
            <div key={item.q} className="rounded-lg border border-stone-200 bg-stone-50 p-5">
              <h3 className="text-[15.5px] font-bold text-stone-900">{item.q}</h3>
              <p className="mt-1.5 text-sm text-stone-500">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
