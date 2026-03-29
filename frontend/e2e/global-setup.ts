import { clerkSetup } from '@clerk/testing/playwright'
import { createClerkClient } from '@clerk/backend'
import { type FullConfig } from '@playwright/test'
import fs from 'fs'

export default async function globalSetup(_config: FullConfig) {
  const secretKey = process.env.CLERK_SECRET_KEY

  if (!secretKey) {
    // Local dev without credentials — skip real setup.
    // Tests will skip auth (authenticatePage returns early when secretKey is missing).
    return
  }

  await clerkSetup()

  const clerk = createClerkClient({ secretKey })
  const ts    = Date.now()

  // 1. Create a fresh Clerk user for this CI run
  const user = await clerk.users.createUser({
    emailAddress: [`e2e-${ts}@test.1reach.com`],
    firstName: 'E2E',
    lastName: 'Test',
    skipPasswordRequirement: true,
  })

  // 2. Create a fresh Clerk org (user becomes admin member automatically)
  const slug = `e2e-${ts}`
  const org  = await clerk.organizations.createOrganization({
    name: `E2E Test Org ${slug}`,
    slug,
    createdBy: user.id,
  })

  // Persist IDs for auth.setup.ts and global-teardown
  const email = `e2e-${ts}@test.1reach.com`
  fs.writeFileSync('/tmp/e2e-state.json', JSON.stringify({
    clerkUserId: user.id,
    clerkOrgId: org.id,
    userEmail: email,
  }))

  // Seed Django DB by posting simulated webhook events directly to the backend.
  // In TEST mode the backend skips Svix signature verification.
  const apiBase = process.env.E2E_API_BASE_URL || 'http://localhost:8000'
  const webhookUrl = `${apiBase}/api/webhooks/clerk/`
  const post = async (body: object) => {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Webhook seed failed (${res.status}): ${text}`)
    }
  }

  // Seed user + org in parallel, then membership (which references both)
  await Promise.all([
    post({
      type: 'user.created',
      data: {
        id: user.id,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: email }],
        first_name: 'E2E',
        last_name: 'Test',
      },
    }),
    post({
      type: 'organization.created',
      data: { id: org.id, name: `E2E Test Org ${slug}`, slug },
    }),
  ])

  await post({
    type: 'organizationMembership.created',
    data: {
      organization: { id: org.id },
      public_user_data: { user_id: user.id },
      role: 'org:admin',
    },
  })
}
