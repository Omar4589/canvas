import { useEffect } from 'react';
import { DemoRequestProvider } from '../marketing/DemoRequest.jsx';
import AapcBanner from '../marketing/AapcBanner.jsx';
import { AAPC, aapcPhase } from '../marketing/aapc.js';
import MarketingNav from '../marketing/MarketingNav.jsx';
import Hero from '../marketing/Hero.jsx';
import CredibilityStrip from '../marketing/CredibilityStrip.jsx';
import ProblemStrip from '../marketing/ProblemStrip.jsx';
import ProductTour from '../marketing/ProductTour.jsx';
import PortalSpotlight from '../marketing/PortalSpotlight.jsx';
import FeatureGrid from '../marketing/FeatureGrid.jsx';
import HowItWorks from '../marketing/HowItWorks.jsx';
import Faq from '../marketing/Faq.jsx';
import CtaBand from '../marketing/CtaBand.jsx';
import MarketingFooter from '../marketing/MarketingFooter.jsx';

// Public marketing landing page for Doorline, aimed at political consulting
// firms. Section ids (turf / field / oversight / reports / how) match the nav
// anchors. Screenshots come from the seeded demo campaign (see
// server/src/utils/seedDemoOrg.js + client/scripts/optimizeShots.js).
export default function LandingPage() {
  useEffect(() => {
    // Matches index.html's <title> on purpose. The narrower "for political consultants" framing that
    // used to live here undersold the audience (campaigns and advocacy orgs buy directly too) — and a
    // store listing that reads as a niche, single-customer tool is what invites an App Store 4.2/3.2
    // "not for general distribution" rejection. Keep this in step with the privacy policy's customer
    // sentence and the store listing.
    document.title = 'Doorline — Door-to-door canvassing software for campaigns and causes';
  }, []);

  // `html.marketing` paints <html> and <body> white (index.css). The theme script in index.html adds
  // `dark` to <html> on a dark-mode device, so without this the dark console background showed as a
  // band on Mac and iPhone overscroll behind this light page. Removed on the way out, so the console
  // keeps its own background.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('marketing');
    // Which AAPC banner text shows (marketing/aapc.js). The prerendered page already has it from an
    // inline <head> script; this covers the page rendered in the browser (a client-side visit, dev).
    root.setAttribute('data-aapc', aapcPhase());
    return () => {
      root.classList.remove('marketing');
      root.removeAttribute('data-aapc');
    };
  }, []);

  return (
    // `theme-light` re-pins light tokens so the public site stays light even when
    // the app's dark theme is saved globally; bg-white masks the dark body.
    <div className="theme-light min-h-screen bg-white text-stone-900">
      {/* Wraps the whole page because the "Request a demo" controls that open the dialog sit in
          three different sections (nav, hero, cta band) at three different scroll depths. */}
      <DemoRequestProvider>
        {/* Above the header, part of the page flow — it pushes the page down, never covers it. */}
        {AAPC.pageLive && <AapcBanner />}
        <MarketingNav />
        <main>
          <Hero />
          <CredibilityStrip />
          <ProblemStrip />
          <ProductTour />
          <PortalSpotlight />
          <FeatureGrid />
          <HowItWorks />
          <Faq />
          <CtaBand />
        </main>
        <MarketingFooter />
      </DemoRequestProvider>
    </div>
  );
}
