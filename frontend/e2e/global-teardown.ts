import { createClerkClient } from '@clerk/backend'
import fs from 'fs'

export default async function globalTeardown() {
  const stateFile = '/tmp/e2e-state.json'
  if (!fs.existsSync(stateFile)) return

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return

  const { clerkOrgId, clerkUserId } = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const clerk = createClerkClient({ secretKey })

  // Clerk-side cleanup only — no webhook delivery needed
  await Promise.all([
    clerkOrgId  ? clerk.organizations.deleteOrganization(clerkOrgId).catch(() => {})  : Promise.resolve(),
    clerkUserId ? clerk.users.deleteUser(clerkUserId).catch(() => {}) : Promise.resolve(),
  ])

  fs.unlinkSync(stateFile)
}
