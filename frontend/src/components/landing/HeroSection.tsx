import { SignUpButton } from "@clerk/clerk-react"
import { Button } from "./Button"
import { ArrowRight, MessageSquare, Send, Megaphone } from "lucide-react"
import { AnimatedMessagesBg } from "./AnimatedMessagesBg"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white dark:bg-[#0a0025]">
      {/* Animated floating messages background */}
      <AnimatedMessagesBg />

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(116,0,246,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(116,0,246,0.5) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* Colour wash glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 right-1/4 h-[500px] w-[500px] rounded-full bg-brand-purple/[0.04] dark:bg-brand-purple/10 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/4 h-[400px] w-[400px] rounded-full bg-brand-light-purple/[0.03] dark:bg-brand-light-purple/[0.08] blur-[100px]" />
        <div className="absolute top-1/2 left-0 h-[300px] w-[300px] rounded-full bg-brand-teal/[0.02] dark:bg-brand-teal/[0.06] blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-20 lg:pb-32 lg:pt-28">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-brand-purple/30 bg-brand-purple/10 px-4 py-1.5 text-sm text-brand-purple dark:text-[#c4a0ff]">
            <MessageSquare className="h-4 w-4 text-brand-purple" />
            <span>Enterprise-grade messaging platform</span>
          </div>

          {/* Heading */}
          <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-5xl lg:text-7xl font-mono">
            Every message,<br />
            <span style={{ background: "linear-gradient(135deg, #7400f6 0%, #9d30a0 50%, #048fb5 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>one platform</span>
          </h1>

          {/* Subheading */}
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-500 dark:text-[#a99cc4] lg:text-xl">
            Send SMS, MMS, and Email to SMS from a single, powerful platform.
            Reach your customers instantly with reliable, scalable messaging.
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <SignUpButton mode="modal">
              <Button size="lg" className="gap-2 bg-brand-purple px-8 text-white hover:bg-brand-purple/80">
                Free Trial
                <ArrowRight className="h-4 w-4" />
              </Button>
            </SignUpButton>
            <Button
              size="lg"
              asChild
              className="gap-2 border border-zinc-200 dark:border-white/20 bg-transparent px-8 text-zinc-950 dark:text-white hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              <a href="#how-it-works">
                See How It Works
              </a>
            </Button>
          </div>

          {/* Feature highlights */}
          <div className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 dark:border-white/5 bg-white shadow-sm dark:bg-white/[0.03] dark:shadow-none p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/15">
                <MessageSquare className="h-6 w-6 text-brand-purple" />
              </div>
              <span className="text-sm font-semibold text-zinc-950 dark:text-white">SMS & MMS</span>
              <span className="text-xs text-zinc-500 dark:text-[#a99cc4]">Text and rich media</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 dark:border-white/5 bg-white shadow-sm dark:bg-white/[0.03] dark:shadow-none p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-light-purple/15">
                <Megaphone className="h-6 w-6 text-brand-light-purple" />
              </div>
              <span className="text-sm font-semibold text-zinc-950 dark:text-white">Campaigns</span>
              <span className="text-xs text-zinc-500 dark:text-[#a99cc4]">Targeted bulk messaging</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 dark:border-white/5 bg-white shadow-sm dark:bg-white/[0.03] dark:shadow-none p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-teal/15">
                <Send className="h-6 w-6 text-brand-teal" />
              </div>
              <span className="text-sm font-semibold text-zinc-950 dark:text-white">Email to SMS</span>
              <span className="text-xs text-zinc-500 dark:text-[#a99cc4]">Convert emails to texts</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
