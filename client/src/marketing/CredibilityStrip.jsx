// Product-truth strip under the hero — honest credibility devices in place of
// the customer logos / usage stats we don't have yet. Every claim is a shipped,
// verifiable behavior.
const TRUTHS = [
  {
    title: 'Every knock GPS-stamped',
    body: 'Every door recorded in the app carries its distance to the house, and the far ones get flagged.',
  },
  {
    title: 'Works with zero signal',
    body: "Doors and surveys save on the phone and send as soon as there's signal again.",
  },
  {
    title: 'Counts you can trust',
    body: 'One knock per door per pass — no double-counting, no guesswork.',
  },
  {
    title: "Reports that can't drift",
    body: 'Client reports freeze when published. Numbers change only when you refresh them, and the report says when.',
  },
];

export default function CredibilityStrip() {
  return (
    <div className="border-y border-stone-200 bg-stone-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 py-9 sm:grid-cols-2 lg:grid-cols-4">
          {TRUTHS.map((t) => (
            <div key={t.title} className="text-sm leading-snug text-stone-500 lg:text-[14.5px]">
              <span className="mb-1 block text-[15px] font-bold text-stone-900 lg:text-base">{t.title}</span>
              {t.body}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
