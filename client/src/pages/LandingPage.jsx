import { useEffect } from 'react';
import MarketingNav from '../marketing/MarketingNav.jsx';
import Hero from '../marketing/Hero.jsx';
import FeatureGrid from '../marketing/FeatureGrid.jsx';
import HowItWorks from '../marketing/HowItWorks.jsx';
import MobileAppSection from '../marketing/MobileAppSection.jsx';
import CtaBand from '../marketing/CtaBand.jsx';
import MarketingFooter from '../marketing/MarketingFooter.jsx';

// Public marketing landing page for Doorline. Composes the marketing pieces
// in order; section ids (features / how / mobile) match the nav anchor hrefs.
export default function LandingPage() {
  useEffect(() => {
    document.title = 'Doorline — Door-to-door canvassing software';
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <main>
        <Hero />
        <FeatureGrid />
        <HowItWorks />
        <MobileAppSection />
        <CtaBand />
      </main>
      <MarketingFooter />
    </div>
  );
}
