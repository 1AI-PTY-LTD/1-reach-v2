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

  // Persist IDs for authenticatePage (reads clerkUserId) and global-teardown
  fs.writeFileSync('/tmp/e2e-state.json', JSON.stringify({
    clerkUserId: user.id,
    clerkOrgId: org.id,
    userEmail: `e2e-${ts}@test.1reach.com`,
  }))

  // Wait for Clerk to deliver webhooks via Svix tunnel → backend processes them
  await new Promise(r => setTimeout(r, 5000))
}
