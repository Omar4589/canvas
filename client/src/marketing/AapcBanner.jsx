import { AAPC } from './aapc.js';

// The AAPC banner: a slim bar ABOVE the header. It is part of the page, not an overlay — it pushes
// everything down and never covers anything, so the hero's "Request a demo" stays on screen on a
// 390×844 phone. Both texts are always in the markup; <html data-aapc> (stamped before first paint —
// marketing/aapc.js) decides which one shows, or hides the bar outright (index.css).
//
// A plain <a>, not a <Link>: /aapc is its own prerendered document with its own head tags.
export default function AapcBanner() {
  return (
    <div className="aapc-banner bg-brand-600 text-white">
      <a
        href={AAPC.bannerHref}
        className="mx-auto flex w-full max-w-6xl items-center justify-center gap-1.5 px-4 py-2.5 text-center text-sm font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:px-6 lg:px-8"
      >
        <span className="aapc-before">At AAPC on Nov 17? Book 15 minutes with Omar</span>
        <span className="aapc-after">Saw us at AAPC? Book 15 minutes with Omar</span>
        <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
