import { MessageSquare, Image, Mail, Megaphone, FileText, BarChart3 } from "lucide-react"

const features = [
  {
    icon: MessageSquare,
    title: "SMS Messaging",
    description:
      "Deliver text messages to any mobile number worldwide. Send individually or in bulk, with full delivery tracking and reporting.",
    color: "text-brand-purple",
    bgColor: "bg-brand-purple/10",
  },
  {
    icon: Image,
    title: "MMS Messaging",
    description:
      "Send rich media messages with images, videos, and attachments. Engage your audience with visual content that stands out.",
    color: "text-brand-light-purple",
    bgColor: "bg-brand-light-purple/10",
  },
  {
    icon: Mail,
    title: "Email to SMS",
    description:
      "Convert your emails directly to SMS messages. Perfect for teams already using email workflows who need SMS reach.",
    color: "text-brand-teal",
    bgColor: "bg-brand-teal/10",
  },
  {
    icon: Megaphone,
    title: "Campaigns",
    description:
      "Create and manage targeted messaging campaigns. Schedule sends, segment your audience, and maximise engagement at scale.",
    color: "text-brand-purple",
    bgColor: "bg-brand-purple/10",
  },
  {
    icon: FileText,
    title: "Templates",
    description:
      "Build reusable message templates with dynamic placeholders. Save time and ensure consistent communication across your team.",
    color: "text-brand-light-purple",
    bgColor: "bg-brand-light-purple/10",
  },
  {
    icon: BarChart3,
    title: "Analytics & Reporting",
    description:
      "Real-time delivery reports, engagement metrics, and campaign analytics. Make data-driven decisions with comprehensive insights.",
    color: "text-brand-teal",
    bgColor: "bg-brand-teal/10",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="bg-[#0a0025] py-24">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-purple">Features</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white font-mono sm:text-4xl">
            Everything you need to{" "}
            <span style={{ background: "linear-gradient(135deg, #7400f6 0%, #9d30a0 50%, #048fb5 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>reach your audience</span>
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-[#a99cc4]">
            One platform, multiple features. Send messages the way your customers want to receive them.
          </p>
        </div>

        {/* Feature cards */}
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-white/5 bg-white/[0.03] p-8 transition-all hover:border-brand-purple/30 hover:bg-white/[0.05]"
            >
              <div className={`inline-flex h-12 w-12 items-center justify-center rounded-lg ${feature.bgColor}`}>
                <feature.icon className={`h-6 w-6 ${feature.color}`} />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a99cc4]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
