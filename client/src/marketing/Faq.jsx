// FAQ — answers the objections a buyer actually raises before a demo call. Each one folds (the owner,
// Nov 15: ten open answers made the page long): a native <details>, so it works on the prerendered page
// before any JavaScript, every answer stays in the HTML for search engines, and `name` makes it one open at a
// time where browsers support it. Each answer is checked against the code; docs/MARKETING_SITE.md →
// "Words to avoid" lists the phrasings that overstate it.
const ITEMS = [
  {
    q: 'How fast can we be knocking doors?',
    // "Often", until a measured report backs "usually". No prospect's voter file is loaded before they
    // sign up — the demo uses the demo campaign.
    a: "Often the same day. Send your voter file in any vendor's format; once it's imported and cut, your crews install the app and walk. We walk you through it on a demo campaign, and set up yours the day you sign up.",
  },
  {
    q: 'What do we need to get started?',
    // Advice only: Doorline connects them with a vendor and never obtains or handles the file itself.
    a: "A voter file with addresses and state voter IDs, as CSV or Excel, from any major vendor. Don't have one? We'll connect you with a vendor.",
  },
  {
    q: 'What happens when a canvasser loses signal?',
    a: "They keep knocking. Doors and surveys save on the phone and send as soon as there's signal again. Anything recorded offline is marked so you can audit it.",
  },
  {
    q: "How do you catch canvassers who don't actually knock?",
    a: 'Every door is GPS-stamped with its distance to the house. Doorline flags doors recorded far from the house, seconds after the last door, or several from one spot, plus fake-GPS apps. Flags land on your Audit page within seconds of syncing, and Doorline warns you before you publish a client report with fake-GPS flags still open.',
  },
  {
    // The answer to a live-tracking assumption, and a published promise (privacy.html: location is
    // collected only when an action is recorded, never continuously or in the background). "Someone":
    // a lead's pin move stores the lead's position as the new pin.
    q: 'Do you track canvassers all day?',
    a: "No. Location is recorded only when someone saves something at a door — that's what gets verified. Nothing is tracked between doors.",
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
    // the printed AAPC ad promises it, so no add-on may ever appear on the site. "Setup is free, and
    // billing starts with your first knock. New to Doorline? Ask about a free trial." are the hero's, the
    // closing band's and /aapc's sentences word for word (the trial is client by client, so never promised): a campaign first out since Nov 5, 2026 bills from the day of its first field visit and
    // renews on that date (docs/BILLING.md); it said "the month of" while campaigns used calendar months.
    q: 'What does it cost?',
    a: 'A flat monthly rate per campaign, sized to the race. Local races start at $300 per campaign, per month, with every canvasser, feature and door included. No per-seat fees, per-door charges or add-ons. Setup is free, and billing starts with your first knock. New to Doorline? Ask about a free trial. Request a demo and we\'ll quote your race.',
  },
];

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 bg-stone-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            Common questions
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">
            Before you ask
          </h2>
        </div>
        <div className="mt-8 grid max-w-3xl gap-2 sm:mt-10 sm:gap-2.5">
          {ITEMS.map((item) => (
            <details key={item.q} name="faq" className="group rounded-lg border border-stone-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:p-5 [&::-webkit-details-marker]:hidden">
                <h3 className="text-[15.5px] font-bold text-stone-900">{item.q}</h3>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  className="shrink-0 text-stone-400 transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </summary>
              <p className="-mt-1 px-4 pb-4 text-sm text-stone-500 sm:-mt-1.5 sm:px-5 sm:pb-5">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
