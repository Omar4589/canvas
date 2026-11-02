import { useEffect } from 'react';
import { DemoRequestProvider } from '../marketing/DemoRequest.jsx';
import { stampAapc, unstampAapc } from '../marketing/aapc.js';
import MarketingNav from '../marketing/MarketingNav.jsx';
import MarketingFooter from '../marketing/MarketingFooter.jsx';
import NumbersStrip from '../marketing/NumbersStrip.jsx';
import DemoButton from '../marketing/DemoButton.jsx';
import SampleReport from '../marketing/SampleReport.jsx';
import AapcMockupCard from '../marketing/AapcMockupCard.jsx';

// /aapc — the printed AAPC ad's own page (the owner's addendum 2 §4). The homepage banner links here
// with ?src=home-banner; a request from this page carries that tag, or 'aapc' when the URL has none
// (DemoRequestProvider defaultSource). Every control here books a meeting: the form asks When? and
// offers a mobile number, because there's no table at the event — Omar emails or texts to set a time.
//
// Prerendered with its own head and noindex (client/src/entry-prerender.jsx). The founder line
// switches on Nov 18 by <html data-aapc-event> (marketing/aapc.js) — both lines are in the HTML,
// never chosen during render. It stays up after the banner ends, with the after-event line.

// The ad's three bullets, word for word.
const AD_BULLETS = [
  'GPS-stamped knocks, live on web and phone',
  'Numbers by pass, book and canvasser',
  'Client reports shared by private link',
];

// Three short blocks in the homepage's claim-checked words (docs/PROPOSAL_AAPC_LANDING.md → "Claim
// check"), each linking to the homepage section that says more.
const BLOCKS = [
  {
    title: 'Proof',
    body: "Every door recorded in the app carries a GPS stamp and its distance to the house. Doorline flags the knocks that don't add up — far from the house, seconds after the last door, several from one spot, or a fake-GPS app on Android — on your Audit page within seconds of syncing.",
    href: '/#proof',
    link: 'How Doorline checks a door',
  },
  {
    title: 'Client reports',
    body: 'Publish a report and the numbers freeze until you refresh. Send it as a password-protected link that expires on its own and can be revoked, or as a PDF. No canvasser or voter names.',
    href: '/#reports',
    link: 'What your client sees',
  },
  {
    title: 'Many campaigns',
    body: 'Each campaign gets its own team, books and reports, and you run all of them from one account. Hand a lead one campaign to run day to day, and nothing else.',
    href: '/#setup',
    link: 'From voter file to knocking',
  },
];

const PRIMARY =
  'inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto';
const SECONDARY =
  'inline-flex w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition-colors hover:border-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto';

const AapcPage = () => {
  useEffect(() => {
    document.title = 'Doorline at the AAPC Election Post-Mortem';
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('marketing');
    stampAapc(root);
    return () => {
      root.classList.remove('marketing');
      unstampAapc(root);
    };
  }, []);

  return (
    <div className="theme-light min-h-screen bg-white text-stone-900">
      <DemoRequestProvider defaultSource="aapc" askWhen>
        <MarketingNav base="/" />
        <main>
          <section className="relative overflow-hidden bg-white">
            <div
              className="pointer-events-none absolute -right-36 -top-32 h-[640px] w-[640px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.09), transparent 62%)' }}
              aria-hidden="true"
            />
            <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:py-20 lg:grid-cols-[6fr_5fr] lg:gap-16 lg:px-8">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-600 lg:text-[13px]">
                  AAPC Election Post-Mortem · Nov 17
                </p>
                <h1 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-tight text-stone-900 [text-wrap:balance] sm:text-5xl">
                  Every door. Every pass. <em className="not-italic text-brand-600">Every number.</em>
                </h1>
                <p className="mt-5 max-w-[46ch] text-lg text-stone-600">
                  Simple for your canvassers. Total visibility for you.
                </p>
                <ul className="mt-6 grid gap-2.5">
                  {AD_BULLETS.map((b) => (
                    <li key={b} className="flex gap-2.5 text-[15px] text-stone-900 sm:text-base">
                      <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex items-start gap-3.5 rounded-xl border border-stone-200 bg-stone-50 p-4">
                  {/* A monogram until there's a photo — never a stock face. */}
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-extrabold text-brand-700"
                    aria-hidden="true"
                  >
                    OZ
                  </span>
                  <div className="text-[15px] text-stone-700">
                    {/* Both lines are in the HTML; <html data-aapc-event> shows one (index.css). No
                        display utilities on these two: the CSS restores their natural display. */}
                    <p className="aapc-ev-before">
                      I&apos;ll be at the Post-Mortem in person. Grab 15 minutes, or book a demo for after the event.
                    </p>
                    <p className="aapc-ev-after">Missed me at AAPC? Book 15 minutes and I&apos;ll walk you through it.</p>
                    <p className="mt-1 text-sm font-semibold text-stone-900">Omar Zumaya, Founder, Doorline</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-3.5">
                  <DemoButton className={PRIMARY}>Book 15 minutes with Omar</DemoButton>
                  <DemoButton className={SECONDARY}>Request a demo</DemoButton>
                </div>
              </div>
              <AapcMockupCard />
            </div>
          </section>

          <NumbersStrip />

          <section className="bg-white">
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-3.5 px-4 py-16 sm:px-6 sm:py-20 md:grid-cols-3 lg:px-8">
              {BLOCKS.map((b) => (
                <div key={b.title} className="flex flex-col rounded-lg border border-stone-200 bg-stone-50 p-6">
                  <h2 className="text-lg font-bold text-stone-900">{b.title}</h2>
                  <p className="mt-2 flex-1 text-sm text-stone-600">{b.body}</p>
                  <a
                    href={b.href}
                    className="mt-4 inline-flex items-center gap-1.5 self-start rounded text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {b.link}
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
              ))}
            </div>
          </section>

          <section className="border-t border-brand-100 bg-brand-50">
            <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-stone-900 [text-wrap:balance] sm:text-4xl">
                Local races from $300 per campaign, per month.
              </h2>
              <p className="mt-3 text-base text-stone-600">Every canvasser and feature included.</p>
              <div className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-4 sm:max-w-none">
                <DemoButton className={PRIMARY}>Book 15 minutes with Omar</DemoButton>
                <SampleReport className="justify-center" />
              </div>
            </div>
          </section>
        </main>
        <MarketingFooter />
      </DemoRequestProvider>
    </div>
  );
};

export default AapcPage;
