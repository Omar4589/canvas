// The detail pages' section shell (Person / Voter / User / Org detail). Extracted after it was
// found byte-identical in two pages with two more on the way.
export default function Section({ title, right, children }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
