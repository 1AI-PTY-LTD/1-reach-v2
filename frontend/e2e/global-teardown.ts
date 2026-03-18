import { createClerkClient } from '@clerk/backend'
import fs from 'fs'

export default async function globalTeardown() {
  const stateFile = '/tmp/e2e-state.json'
  if (!fs.existsSync(stateFile)) return

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return

  const { clerkOrgId, clerkUserId } = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const clerk = createClerkClient({ secretKey })

  // Delete org first → fires organization.deleted webhook (cascades memberships in Django)
  if (clerkOrgId)  await clerk.organizations.deleteOrganization(clerkOrgId).catch(() => {})
  // Delete user → fires user.deleted webhook
  if (clerkUserId) await clerk.users.deleteUser(clerkUserId).catch(() => {})

  // Wait for deletion webhooks to be delivered via Svix and processed by Django
  await new Promise(r => setTimeout(r, 3000))

  fs.unlinkSync(stateFile)
}
