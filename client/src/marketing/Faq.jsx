import { Reveal } from './useReveal.jsx';

// FAQ — answers the objections a consultant actually raises before a demo call.
// Static (no accordion): four short answers read faster than four clicks.
const ITEMS = [
  {
    q: 'How fast can we be knocking doors?',
    a: "Same day. Send us your voter file in any vendor's format — once it's imported and cut, your crews download the app and walk. We set up your first campaign with you on the demo call.",
  },
  {
    q: 'What happens when a canvasser loses signal?',
    a: 'Nothing bad. Every knock and survey queues on the phone and syncs automatically the moment coverage returns — flagged as an offline submission so you can audit it later.',
  },
  {
    q: "How do you catch canvassers who don't actually knock?",
    a: "Every knock is GPS-stamped, so Doorline flags the ones that don't add up — recorded far from the house, logged too fast to have walked between doors, or all entered from one spot. You review each flag and mark it resolved, so bad data never quietly lands in a client report.",
  },
  {
    q: 'What shows up in a shared report?',
    a: 'Only what you publish: a frozen weekly report with coverage, results, and a door-status map. Canvasser identities and voter names are stripped by design. Links are revocable and can be password-protected.',
  },
  {
    q: 'Can different teams work the same campaign?',
    a: "Yes — split a campaign into walk lists with separate crews, passes, and even different surveys, without ever double-knocking each other's doors.",
  },
];

export default function Faq() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600 lg:text-sm">
            Common questions
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl">
            Before you ask
          </h2>
        </Reveal>
        <div className="mt-10 grid max-w-3xl gap-2.5">
          {ITEMS.map((item, i) => (
            <Reveal key={item.q} delay={i * 70}>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-5">
                <h3 className="text-[15.5px] font-bold text-stone-900">{item.q}</h3>
                <p className="mt-1.5 text-sm text-stone-500">{item.a}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
