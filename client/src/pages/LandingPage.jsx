import { useEffect } from 'react';
import { DemoRequestProvider, OpenDemoFromLink } from '../marketing/DemoRequest.jsx';
import MarketingNav from '../marketing/MarketingNav.jsx';
import Hero from '../marketing/Hero.jsx';
import NumbersStrip from '../marketing/NumbersStrip.jsx';
import ProblemStrip from '../marketing/ProblemStrip.jsx';
import ProofSection from '../marketing/ProofSection.jsx';
import PortalSpotlight from '../marketing/PortalSpotlight.jsx';
import SetupSection from '../marketing/SetupSection.jsx';
import FeatureGrid from '../marketing/FeatureGrid.jsx';
import FounderNote from '../marketing/FounderNote.jsx';
import Faq from '../marketing/Faq.jsx';
import CtaBand from '../marketing/CtaBand.jsx';
import MarketingFooter from '../marketing/MarketingFooter.jsx';

// The homepage — prerendered (client/scripts/prerender.js), so it must render the same on the build
// and in the browser (docs/MARKETING_SITE.md → "Hydration rules"). Section order and backgrounds
// follow the AAPC brief §7: white, stone-50, white, stone-100 (Proof — light, not the brief's dark),
// brand-50, white, stone-100, white, stone-50, brand-50.
export default function LandingPage() {
  useEffect(() => {
    document.title = 'Doorline — Door-to-door canvassing software for campaigns and causes';
  }, []);

  // `marketing` paints <html> and <body> white (index.css); the prerendered page carries it from the
  // first byte, and this covers a client-side navigation onto the page.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('marketing');
    return () => root.classList.remove('marketing');
  }, []);

  return (
    <div className="theme-light min-h-screen bg-white text-stone-900">
      {/* Wraps the whole page because the "Request a demo" controls that open the dialog sit in
          three different sections (nav, hero, cta band) at three different scroll depths. */}
      <DemoRequestProvider>
        {/* The static pages' Request a demo lands here as /#demo and opens the dialog. */}
        <OpenDemoFromLink />
        <MarketingNav />
        <main>
          <Hero />
          <NumbersStrip />
          <ProblemStrip />
          <ProofSection />
          <PortalSpotlight />
          <SetupSection />
          <FeatureGrid />
          <FounderNote />
          <Faq />
          <CtaBand />
        </main>
        <MarketingFooter />
      </DemoRequestProvider>
    </div>
  );
}
