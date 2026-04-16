import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom does not implement matchMedia
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

// Mock Clerk components used by landing page
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn(), isSignedIn: false, isLoaded: true }),
  useUser: () => ({ user: null, isLoaded: true, isSignedIn: false }),
  useOrganization: () => ({ organization: null, isLoaded: true }),
  useOrganizationList: () => ({ organizationList: [], isLoaded: true, setActive: vi.fn() }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: () => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => children,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => null,
}))

import { Navbar } from '../landing/Navbar'
import { HeroSection } from '../landing/HeroSection'
import { FeaturesSection } from '../landing/FeaturesSection'
import { HowItWorksSection } from '../landing/HowItWorksSection'
import { PricingSection } from '../landing/PricingSection'
import { CtaSection } from '../landing/CtaSection'
import { Footer } from '../landing/Footer'
import { LandingPage } from '../landing/LandingPage'

describe('LandingPage', () => {
  it('renders all sections', () => {
    render(<LandingPage />)
    expect(screen.getByText('Enterprise-grade messaging platform')).toBeInTheDocument()
    expect(screen.getByText(/Everything you need to/)).toBeInTheDocument()
    expect(screen.getByText(/Up and running/)).toBeInTheDocument()
    expect(screen.getByText(/Simple,/)).toBeInTheDocument()
    expect(screen.getByText(/Ready to/)).toBeInTheDocument()
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument()
  })
})

describe('Navbar', () => {
  it('renders navigation links', () => {
    render(<Navbar />)
    expect(screen.getAllByText('Features')[0]).toBeInTheDocument()
    expect(screen.getAllByText('How It Works')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Pricing')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Contact')[0]).toBeInTheDocument()
  })

  it('has light mode background classes with dark mode variants', () => {
    const { container } = render(<Navbar />)
    const header = container.querySelector('header')
    expect(header?.className).toContain('bg-white/90')
    expect(header?.className).toContain('dark:bg-[#0a0025]/90')
    expect(header?.className).toContain('border-zinc-200')
    expect(header?.className).toContain('dark:border-white/10')
  })

  it('has light mode text colors with dark mode variants', () => {
    render(<Navbar />)
    const featuresLink = screen.getAllByText('Features')[0]
    expect(featuresLink.className).toContain('text-zinc-500')
    expect(featuresLink.className).toContain('dark:text-[#a99cc4]')
  })

  it('toggles mobile menu', async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    const menuButton = screen.getByLabelText('Open menu')
    await user.click(menuButton)
    const closeButton = screen.getByLabelText('Close menu')
    expect(closeButton).toBeInTheDocument()
  })
})

describe('HeroSection', () => {
  it('renders heading and subheading', () => {
    render(<HeroSection />)
    expect(screen.getByText(/Every message,/)).toBeInTheDocument()
    expect(screen.getByText(/Send SMS, MMS, and Email to SMS/)).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<HeroSection />)
    const section = container.querySelector('section')
    expect(section?.className).toContain('bg-white')
    expect(section?.className).toContain('dark:bg-[#0a0025]')
  })

  it('has light mode text colors with dark mode variants', () => {
    render(<HeroSection />)
    const subheading = screen.getByText(/Send SMS, MMS, and Email to SMS/)
    expect(subheading.className).toContain('text-zinc-500')
    expect(subheading.className).toContain('dark:text-[#a99cc4]')
  })

  it('renders feature highlight cards with light/dark styles', () => {
    render(<HeroSection />)
    const smsCard = screen.getByText('SMS & MMS').closest('div[class*="rounded-xl"]')
    expect(smsCard?.className).toContain('bg-white')
    expect(smsCard?.className).toContain('shadow-sm')
    expect(smsCard?.className).toContain('dark:bg-white/[0.03]')
    expect(smsCard?.className).toContain('border-zinc-200')
    expect(smsCard?.className).toContain('dark:border-white/5')
  })

  it('renders gradient text span', () => {
    render(<HeroSection />)
    const gradientSpan = screen.getByText('one platform')
    expect(gradientSpan.style.background).toContain('linear-gradient')
  })
})

describe('FeaturesSection', () => {
  it('renders all six feature cards', () => {
    render(<FeaturesSection />)
    expect(screen.getByText('SMS Messaging')).toBeInTheDocument()
    expect(screen.getByText('MMS Messaging')).toBeInTheDocument()
    expect(screen.getByText('Email to SMS')).toBeInTheDocument()
    expect(screen.getByText('Campaigns')).toBeInTheDocument()
    expect(screen.getByText('Templates')).toBeInTheDocument()
    expect(screen.getByText('Analytics & Reporting')).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<FeaturesSection />)
    const section = container.querySelector('section')
    expect(section?.className).toContain('bg-white')
    expect(section?.className).toContain('dark:bg-[#0a0025]')
  })

  it('feature cards have light/dark styles', () => {
    render(<FeaturesSection />)
    const card = screen.getByText('SMS Messaging').closest('div[class*="rounded-xl"]')
    expect(card?.className).toContain('bg-white')
    expect(card?.className).toContain('shadow-sm')
    expect(card?.className).toContain('dark:bg-white/[0.03]')
  })
})

describe('HowItWorksSection', () => {
  it('renders all three steps', () => {
    render(<HowItWorksSection />)
    expect(screen.getByText('Create Your Account')).toBeInTheDocument()
    expect(screen.getByText('Configure Your Channels')).toBeInTheDocument()
    expect(screen.getByText('Send & Track')).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<HowItWorksSection />)
    const section = container.querySelector('section')
    expect(section?.className).toContain('bg-gray-50')
    expect(section?.className).toContain('dark:bg-[#0d0030]')
  })
})

describe('PricingSection', () => {
  it('renders all three pricing plans', () => {
    render(<PricingSection />)
    expect(screen.getByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Professional')).toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<PricingSection />)
    const section = container.querySelector('section')
    expect(section?.className).toContain('bg-white')
    expect(section?.className).toContain('dark:bg-[#0a0025]')
  })

  it('featured card has Most Popular badge', () => {
    render(<PricingSection />)
    expect(screen.getByText('Most Popular')).toBeInTheDocument()
  })

  it('non-featured cards have light/dark border styles', () => {
    render(<PricingSection />)
    const starterCard = screen.getByText('Starter').closest('div[class*="rounded-xl"]')
    expect(starterCard?.className).toContain('border-zinc-200')
    expect(starterCard?.className).toContain('dark:border-white/5')
    expect(starterCard?.className).toContain('bg-white')
    expect(starterCard?.className).toContain('shadow-sm')
  })

  it('featured card has brand purple border and dark bg variant', () => {
    render(<PricingSection />)
    const proCard = screen.getByText('Professional').closest('div[class*="rounded-xl"]')
    expect(proCard?.className).toContain('border-brand-purple/50')
    expect(proCard?.className).toContain('dark:bg-white/[0.05]')
  })
})

describe('CtaSection', () => {
  it('renders heading and description', () => {
    render(<CtaSection />)
    expect(screen.getByText(/reach your audience\?/)).toBeInTheDocument()
    expect(screen.getByText(/Join thousands of businesses/)).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<CtaSection />)
    const section = container.querySelector('section')
    expect(section?.className).toContain('bg-gray-50')
    expect(section?.className).toContain('dark:bg-[#0d0030]')
  })

  it('primary CTA is purple in light mode and white in dark mode', () => {
    render(<CtaSection />)
    const ctaButton = screen.getByText('Start Free Trial').closest('button')
    expect(ctaButton?.className).toContain('bg-brand-purple')
    expect(ctaButton?.className).toContain('dark:bg-white')
    expect(ctaButton?.className).toContain('dark:text-brand-navy')
  })
})

describe('Footer', () => {
  it('renders brand name and copyright', () => {
    render(<Footer />)
    expect(screen.getByText('1Reach')).toBeInTheDocument()
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument()
  })

  it('has light mode background with dark mode variant', () => {
    const { container } = render(<Footer />)
    const footer = container.querySelector('footer')
    expect(footer?.className).toContain('bg-gray-100')
    expect(footer?.className).toContain('dark:bg-[#080020]')
    expect(footer?.className).toContain('border-zinc-200')
    expect(footer?.className).toContain('dark:border-white/5')
  })

  it('renders privacy link with light/dark text', () => {
    render(<Footer />)
    const privacyLink = screen.getByText('Privacy')
    expect(privacyLink.className).toContain('text-zinc-500')
    expect(privacyLink.className).toContain('dark:text-[#a99cc4]')
  })
})
