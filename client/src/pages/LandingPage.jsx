import { useEffect } from 'react';
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
    document.title = 'Doorline — Door-to-door canvassing platform for political consultants';
  }, []);

  return (
    // `theme-light` re-pins light tokens so the public site stays light even when
    // the app's dark theme is saved globally; bg-white masks the dark body.
    <div className="theme-light min-h-screen bg-white text-stone-900">
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
    </div>
  );
}
