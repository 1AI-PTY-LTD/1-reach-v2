import { SignUpButton } from "@clerk/clerk-react"
import { Button } from "./Button"
import { Check, MessageSquare, Users, Building2 } from "lucide-react"

const plans = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    credit: "$50 credit included",
    icon: MessageSquare,
    iconColor: "text-brand-teal",
    iconBg: "bg-brand-teal/10",
    description: "Get started with messaging basics and a generous credit to explore the platform.",
    features: [
      "$50 free credit",
      "10c per SMS part",
      "50c per MMS part",
      "SMS & MMS",
      "Campaigns",
      "Templates",
      "Admin role",
      "Email support",
    ],
    cta: "Start Free Trial",
    ctaHref: "/sign-up",
    featured: false,
  },
  {
    name: "Professional",
    price: "$300",
    period: "/mo",
    credit: "$50 credit included",
    icon: Users,
    iconColor: "text-brand-purple",
    iconBg: "bg-brand-purple/10",
    description: "For growing teams that need multiple roles, users, and more control.",
    features: [
      "10c per SMS part",
      "50c per MMS part",
      "SMS, MMS & Email to SMS",
      "Campaigns",
      "Templates",
      "Multiple roles & users",
      "Advanced analytics",
      "Priority support",
    ],
    cta: "Start Free Trial",
    ctaHref: "/sign-up",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    credit: "Volume-based pricing",
    icon: Building2,
    iconColor: "text-brand-light-purple",
    iconBg: "bg-brand-light-purple/10",
    description: "For organisations with high-volume messaging and custom requirements.",
    features: [
      "Custom SMS & MMS rates",
      "All channels included",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
      "Multiple roles & users",
      "Advanced analytics",
      "24/7 phone support",
    ],
    cta: "Talk to Sales",
    ctaHref: "#contact",
    featured: false,
  },
]

export function PricingSection() {
  return (
    <section id="pricing" className="bg-[#0a0025] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-purple">Pricing</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white font-mono sm:text-4xl">
            Simple,{" "}
            <span style={{ background: "linear-gradient(135deg, #7400f6 0%, #9d30a0 50%, #048fb5 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>transparent pricing</span>
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-[#a99cc4]">
            No hidden fees. No lock-in contracts. Scale up or down as your needs change.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-xl border p-8 transition-all ${
                plan.featured
                  ? "border-brand-purple/50 bg-white/[0.05] shadow-xl shadow-brand-purple/10 ring-1 ring-brand-purple/20"
                  : "border-white/5 bg-white/[0.03] hover:border-brand-purple/30"
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-purple px-4 py-1 text-xs font-semibold text-white">
                  Most Popular
                </div>
              )}

              {/* Plan icon */}
              <div className={`inline-flex h-11 w-11 items-center justify-center rounded-lg ${plan.iconBg}`}>
                <plan.icon className={`h-5 w-5 ${plan.iconColor}`} />
              </div>

              <h3 className="mt-4 h-7 text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-2 h-[5rem] text-sm leading-relaxed text-[#a99cc4]">{plan.description}</p>

              <div className="mt-8 flex h-12 items-end gap-1">
                <span className="text-4xl font-semibold leading-none text-white font-mono">{plan.price}</span>
                {plan.period && (
                  <span className="mb-1 text-sm text-[#a99cc4]">{plan.period}</span>
                )}
              </div>
              <p className="mt-2 h-5 text-xs font-medium text-brand-purple">{plan.credit}</p>

              <ul className="mt-8 flex flex-1 flex-col gap-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm text-[#a99cc4]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-purple" />
                    {feature}
                  </li>
                ))}
              </ul>

              {plan.ctaHref.startsWith('#') ? (
                <Button
                  className="mt-8 w-full border border-white/20 bg-transparent text-white hover:bg-white/5"
                  asChild
                >
                  <a href={plan.ctaHref}>{plan.cta}</a>
                </Button>
              ) : (
                <SignUpButton mode="modal">
                  <Button
                    className={`mt-8 w-full ${
                      plan.featured
                        ? "bg-brand-purple text-white hover:bg-brand-purple/80"
                        : "border border-white/20 bg-transparent text-white hover:bg-white/5"
                    }`}
                  >
                    {plan.cta}
                  </Button>
                </SignUpButton>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
