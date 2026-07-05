import { Reveal } from './useReveal.jsx';

// Product-truth strip under the hero — honest credibility devices in place of
// the customer logos / usage stats we don't have yet. Every claim is a shipped,
// verifiable behavior.
const TRUTHS = [
  {
    title: 'Every knock GPS-stamped',
    body: "Distance-to-door recorded on every contact, flagged when it's off.",
  },
  {
    title: 'Works with zero signal',
    body: 'Actions queue on the phone and sync the moment coverage returns.',
  },
  {
    title: 'Billing-grade counts',
    body: 'One knock per door per round — numbers clean enough to invoice from.',
  },
  {
    title: "Reports that can't drift",
    body: 'Client reports freeze when published; the numbers never change under you.',
  },
];

export default function CredibilityStrip() {
  return (
    <div className="border-y border-stone-200 bg-stone-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="grid grid-cols-1 gap-8 py-9 sm:grid-cols-2 lg:grid-cols-4">
          {TRUTHS.map((t) => (
            <div key={t.title} className="text-[13.5px] leading-snug text-stone-500">
              <span className="mb-1 block text-sm font-bold text-stone-900">{t.title}</span>
              {t.body}
            </div>
          ))}
        </Reveal>
      </div>
    </div>
  );
}
