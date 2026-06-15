import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal/LegalPage'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="12 June 2026">
      <p>
        These terms govern your use of the 1Reach SMS/MMS messaging platform at
        1reach.net (the "Service"). By creating an account or using the Service you
        agree to these terms on behalf of yourself and the organisation you represent.
      </p>

      <h2>The service</h2>
      <p>
        1Reach lets organisations manage contacts and send and schedule SMS/MMS
        messages. Message delivery depends on third-party carriers and is not
        guaranteed; delivery statuses shown in the platform reflect the best
        information available from our carrier partners.
      </p>

      <h2>Accounts</h2>
      <p>
        You are responsible for the activity of all users in your organisation and for
        keeping credentials secure. You must provide accurate account and billing
        information.
      </p>

      <h2>Acceptable use and messaging compliance</h2>
      <p>
        You are solely responsible for the content of your messages and for your
        compliance with all applicable laws, including the Spam Act 2003 (Cth) and
        ACMA rules. In particular, you must:
      </p>
      <ul>
        <li>Only message recipients who have consented to receive your messages</li>
        <li>Clearly identify your organisation as the sender</li>
        <li>Honour opt-out requests promptly — the platform blocks sends to numbers that have opted out, and you must not attempt to circumvent this</li>
        <li>Only use alphanumeric sender IDs that are registered to your organisation under the ACMA SMS Sender ID Register</li>
        <li>Not send unlawful, deceptive, fraudulent, or harmful content</li>
      </ul>
      <p>
        We may suspend or terminate accounts that breach these requirements or that
        cause carrier complaints, and we may cooperate with regulators where required.
      </p>

      <h2>Billing</h2>
      <p>
        Prepaid credits are charged when messages are committed for sending and
        automatically refunded when a send fails. Credit purchases and subscriptions
        are processed by Stripe and Clerk. Except where required by law (including the
        Australian Consumer Law), unused prepaid credits are not redeemable for cash.
        Overdue subscription or invoice payments may result in sending being suspended
        until payment is made.
      </p>

      <h2>Your data</h2>
      <p>
        You retain ownership of the contact data and message content you upload. You
        grant us the rights needed to operate the Service (storing, processing, and
        transmitting that data to carriers). Our handling of personal information is
        described in the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Availability and liability</h2>
      <p>
        The Service is provided "as is". To the maximum extent permitted by law, we
        exclude all implied warranties, and our total liability for any claim arising
        out of the Service is limited to the amounts you paid us in the three months
        preceding the claim. Nothing in these terms excludes rights that cannot be
        excluded under the Australian Consumer Law.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service and close your account at any time. We may
        suspend or terminate access for breach of these terms, for non-payment, or
        where required to protect the Service or comply with law.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms from time to time. Material changes will be notified
        through the platform or by email; continued use after a change takes effect
        constitutes acceptance.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of South Australia, Australia, and the
        courts of South Australia have non-exclusive jurisdiction.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms can be sent to{' '}
        <a href="mailto:support@1reach.net">support@1reach.net</a>.
      </p>
    </LegalPage>
  )
}
