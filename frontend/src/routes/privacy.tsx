import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal/LegalPage'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="12 June 2026">
      <p>
        1Reach ("we", "us") provides a multi-tenant SMS/MMS messaging platform at
        1reach.net. This policy explains what personal information we collect, how we
        use it, and the choices you have. We handle personal information in accordance
        with the Australian Privacy Act 1988 (Cth) and the Australian Privacy
        Principles.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — your name, email address, and
          organisation details, collected through our authentication provider (Clerk)
          when you sign up.
        </li>
        <li>
          <strong>Contact data you upload</strong> — names, phone numbers, and email
          addresses of message recipients that your organisation adds to the platform.
          Your organisation controls this data; we process it on your organisation's
          behalf to deliver messages.
        </li>
        <li>
          <strong>Message content and delivery records</strong> — the messages your
          organisation composes and sends, and their delivery status.
        </li>
        <li>
          <strong>Billing information</strong> — payment details are collected and
          processed by Stripe; we store transaction records and balances but never
          your card number.
        </li>
        <li>
          <strong>Usage and technical data</strong> — log data such as IP addresses,
          request identifiers, and error reports used to operate and secure the
          service.
        </li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To provide, operate, and support the service</li>
        <li>To deliver SMS/MMS messages via our carrier partners</li>
        <li>To process payments, credits, and invoices</li>
        <li>To monitor, debug, and secure the platform</li>
        <li>To comply with our legal obligations, including the Spam Act 2003 (Cth)</li>
      </ul>

      <h2>Third parties we share data with</h2>
      <ul>
        <li><strong>Clerk</strong> — authentication and subscription management</li>
        <li><strong>Stripe</strong> — payment processing and invoicing</li>
        <li><strong>Welcorp</strong> — SMS/MMS carrier delivery (recipient numbers and message content)</li>
        <li><strong>Microsoft Azure</strong> — cloud hosting (data stored in Azure regions)</li>
        <li><strong>Sentry</strong> — error monitoring (technical data only)</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2>Opt-outs</h2>
      <p>
        Message recipients can opt out of receiving messages at any time. Once a
        recipient has opted out, the platform blocks further sends to their number by
        any user in the sending organisation.
      </p>

      <h2>Retention and security</h2>
      <p>
        We retain account and billing records for as long as your organisation has an
        account and as required by law. Contact data can be deleted by your
        organisation's administrators at any time. Data is encrypted in transit, and
        access is restricted to authenticated members of your organisation.
      </p>

      <h2>Your rights</h2>
      <p>
        You may request access to, or correction of, the personal information we hold
        about you. If you are a message recipient and your information was uploaded by
        one of our customers, we will refer your request to that organisation where
        appropriate.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or complaints about privacy can be sent to{' '}
        <a href="mailto:privacy@1reach.net">privacy@1reach.net</a>. If you are not
        satisfied with our response, you may contact the Office of the Australian
        Information Commissioner (oaic.gov.au).
      </p>
    </LegalPage>
  )
}
