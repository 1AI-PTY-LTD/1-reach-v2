import { createClerkClient } from '@clerk/backend'
import fs from 'fs'

export default async function globalTeardown() {
  const stateFile = '/tmp/e2e-state.json'
  if (!fs.existsSync(stateFile)) return

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return

  const { clerkOrgId, clerkUserId } = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const clerk = createClerkClient({ secretKey })

  // Delete org first, then user (Clerk-side cleanup only — no webhook delivery needed)
  if (clerkOrgId)  await clerk.organizations.deleteOrganization(clerkOrgId).catch(() => {})
  if (clerkUserId) await clerk.users.deleteUser(clerkUserId).catch(() => {})

  fs.unlinkSync(stateFile)
}
