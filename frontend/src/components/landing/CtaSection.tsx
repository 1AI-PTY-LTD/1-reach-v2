import { SignUpButton } from "@clerk/clerk-react"
import { Button } from "./Button"
import { ArrowRight } from "lucide-react"

export function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-[#0d0030] py-24">
      {/* Background accents */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 right-1/4 h-[300px] w-[300px] rounded-full bg-brand-purple/15 blur-[100px]" />
        <div className="absolute -bottom-20 left-1/4 h-[250px] w-[250px] rounded-full bg-brand-light-purple/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-white font-mono sm:text-4xl lg:text-5xl">
          Ready to{" "}
          <span style={{ background: "linear-gradient(135deg, #7400f6 0%, #9d30a0 50%, #048fb5 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>reach your audience?</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-white/70">
          Join thousands of businesses already using 1Reach to connect with their customers through SMS, MMS, and Email to SMS.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <SignUpButton mode="modal">
            <Button
              size="lg"
              className="gap-2 bg-white text-brand-navy hover:bg-white/90 px-8"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Button>
          </SignUpButton>
          <Button
            size="lg"
            asChild
            className="gap-2 border border-white/30 bg-transparent px-8 text-white hover:bg-white/10"
          >
            <a href="#contact">Talk to Sales</a>
          </Button>
        </div>
      </div>
    </section>
  )
}
