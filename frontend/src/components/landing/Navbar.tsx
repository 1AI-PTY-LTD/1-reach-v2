import { useState } from "react"
import { SignInButton, SignUpButton } from "@clerk/clerk-react"
import { Button } from "./Button"
import { Menu, X } from "lucide-react"

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-white/10 bg-white/90 dark:bg-[#0a0025]/90 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-purple">
            <span className="text-lg font-semibold text-white font-mono">1</span>
          </div>
          <span className="text-xl font-semibold text-zinc-950 dark:text-white font-mono tracking-tight">1Reach</span>
        </a>

        {/* Desktop navigation */}
        <div className="hidden items-center gap-8 md:flex">
          <a href="#features" className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white">
            Features
          </a>
          <a href="#how-it-works" className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white">
            How It Works
          </a>
          <a href="#pricing" className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white">
            Pricing
          </a>
          <a href="#contact" className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white">
            Contact
          </a>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <SignInButton mode="modal">
            <Button size="sm" className="bg-transparent text-zinc-500 dark:text-[#a99cc4] hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-950 dark:hover:text-white">
              Sign In
            </Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button size="sm" className="bg-brand-purple text-white hover:bg-brand-purple/80">
              Get Started
            </Button>
          </SignUpButton>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-2 text-zinc-950 dark:text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile navigation */}
      {mobileOpen && (
        <div className="border-t border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0025] px-6 pb-6 pt-4 md:hidden">
          <div className="flex flex-col gap-4">
            <a
              href="#features"
              className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              How It Works
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              Pricing
            </a>
            <a
              href="#contact"
              className="text-sm font-medium text-zinc-500 dark:text-[#a99cc4] transition-colors hover:text-zinc-950 dark:hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              Contact
            </a>
            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-200 dark:border-white/10">
              <SignInButton mode="modal">
                <Button size="sm" className="justify-start bg-transparent text-zinc-500 dark:text-[#a99cc4] hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-950 dark:hover:text-white">
                  Sign In
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm" className="bg-brand-purple text-white hover:bg-brand-purple/80">
                  Get Started
                </Button>
              </SignUpButton>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
