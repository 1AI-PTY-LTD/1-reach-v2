const steps = [
  {
    step: "01",
    title: "Create Your Account",
    description:
      "Sign up in seconds and get instant access to the 1Reach dashboard. Start with a free trial to explore the platform.",
  },
  {
    step: "02",
    title: "Configure Your Channels",
    description:
      "Set up SMS, MMS, or Email to SMS. Import contacts, create templates, and configure your sender ID.",
  },
  {
    step: "03",
    title: "Send & Track",
    description:
      "Launch your messages and track delivery in real time. Monitor engagement, optimise campaigns, and scale effortlessly.",
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-[#0d0030] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-purple">How It Works</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white font-mono sm:text-4xl">
            Up and running{" "}
            <span style={{ background: "linear-gradient(135deg, #7400f6 0%, #9d30a0 50%, #048fb5 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>in minutes</span>
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-[#a99cc4]">
            Getting started with 1Reach is straightforward. Three simple steps to start reaching your audience.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {steps.map((item, index) => (
            <div key={item.step} className="relative flex flex-col items-center text-center">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="absolute left-1/2 top-8 hidden h-px w-full bg-white/10 md:block" />
              )}

              {/* Step number */}
              <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-brand-purple text-white">
                <span className="text-xl font-semibold font-mono">{item.step}</span>
              </div>

              <h3 className="mt-6 text-xl font-semibold text-white">{item.title}</h3>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#a99cc4]">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
