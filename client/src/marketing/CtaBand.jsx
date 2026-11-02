import DemoButton from './DemoButton.jsx';
import SampleReport from './SampleReport.jsx';

// CtaBand — brand-wash conversion band at the foot of the page: the demo, and the sample report once
// its link exists (with its password beside it). Sign in lives in the header and footer.
export default function CtaBand() {
  return (
    <section className="border-t border-brand-100 bg-brand-50">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="py-16 text-center sm:py-24">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 lg:text-sm">Get started</p>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-[2.6rem] sm:leading-tight">
            See Doorline run your next canvass
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-base text-stone-600">
            Bring a race you&apos;re working. We&apos;ll walk through the console and the field app on a
            live demo campaign, and set up yours the day you sign up.
          </p>
          {/* Same stack-then-row treatment as the hero, so the two CTA rows behave identically
              on a phone instead of one wrapping raggedly and the other centring. */}
          <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-start sm:justify-center sm:gap-3.5">
            <DemoButton className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto">
              Request a demo
            </DemoButton>
            <SampleReport variant="button" fallback={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
