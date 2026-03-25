import { Navbar } from './Navbar'
import { HeroSection } from './HeroSection'
import { FeaturesSection } from './FeaturesSection'
import { HowItWorksSection } from './HowItWorksSection'
import { PricingSection } from './PricingSection'
import { CtaSection } from './CtaSection'
import { Footer } from './Footer'

export function LandingPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <CtaSection />
      <Footer />
    </main>
  )
}
