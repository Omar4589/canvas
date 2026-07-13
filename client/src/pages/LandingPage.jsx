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
    // Matches index.html's <title> on purpose. The narrower "for political consultants" framing that
    // used to live here undersold the audience (campaigns and advocacy orgs buy directly too) — and a
    // store listing that reads as a niche, single-customer tool is what invites an App Store 4.2/3.2
    // "not for general distribution" rejection. Keep this in step with the privacy policy's customer
    // sentence and the store listing.
    document.title = 'Doorline — Door-to-door canvassing software for campaigns and causes';
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
