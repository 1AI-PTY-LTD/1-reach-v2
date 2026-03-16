import { clerkSetup } from '@clerk/testing/playwright'
import { type FullConfig } from '@playwright/test'

export default async function globalSetup(_config: FullConfig) {
  // Only run Clerk setup when credentials are available (e.g. CI).
  // In local dev without credentials, authenticatePage() returns early gracefully.
  if (process.env.CLERK_SECRET_KEY || process.env.CLERK_TESTING_TOKEN) {
    await clerkSetup()
  }
}
