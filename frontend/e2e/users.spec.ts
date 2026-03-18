/**
 * E2E tests for the Users page.
 *
 * Self-contained: creates its own Clerk admin user + org + member + inactive
 * user in beforeAll via the real Clerk API. Clerk fires real webhooks via the
 * Svix tunnel → Django processes them → backend records appear.
 *
 * No synthetic webhooks, no mocked endpoints.
 */

import { test, expect } from '@playwright/test'
import { createClerkClient } from '@clerk/backend'
import { authenticatePage, apiRequest } from './helpers'

let adminUserId: string
let memberUserId: string
let inactiveUserId: string
let specOrgId: string
let ts: number

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  ts = Date.now()
  const slug = `e2e-users-${ts}`

  // Create admin user + org (Clerk auto-creates admin membership)
  const adminUser = await clerk.users.createUser({
    emailAddress: [`admin-${ts}@test.1reach.com`],
    firstName: 'E2E',
    lastName: 'Admin',
    skipPasswordRequirement: true,
  })
  adminUserId = adminUser.id
  const org = await clerk.organizations.createOrganization({
    name: `E2E Users Org ${slug}`,
    slug,
    createdBy: adminUserId,
  })
  specOrgId = org.id

  // Create member user + add to org
  const memberUser = await clerk.users.createUser({
    emailAddress: [`member-${ts}@test.1reach.com`],
    firstName: 'Member',
    lastName: 'User',
    skipPasswordRequirement: true,
  })
  memberUserId = memberUser.id
  await clerk.organizations.createOrganizationMembership({
    organizationId: specOrgId,
    userId: memberUserId,
    role: 'org:member',
  })

  // Create inactive user + add to org, then remove from org (Clerk fires membership.deleted)
  const inactiveUser = await clerk.users.createUser({
    emailAddress: [`inactive-${ts}@test.1reach.com`],
    firstName: 'Inactive',
    lastName: 'User',
    skipPasswordRequirement: true,
  })
  inactiveUserId = inactiveUser.id
  await clerk.organizations.createOrganizationMembership({
    organizationId: specOrgId,
    userId: inactiveUserId,
    role: 'org:member',
  })
  await clerk.organizations.deleteOrganizationMembership({
    organizationId: specOrgId,
    userId: inactiveUserId,
  })

  // Poll backend (as admin) until all users appear — webhooks may take a moment
  const page = await browser.newPage()
  await authenticatePage(page, adminUserId)
  await expect(async () => {
    const users = await apiRequest(page, 'GET', '/api/users/?limit=50')
    const emails = (users.results ?? []).map((u: any) => u.email)
    expect(emails).toContain(`member-${ts}@test.1reach.com`)
    expect(emails).toContain(`inactive-${ts}@test.1reach.com`)
  }).toPass({ timeout: 15000, intervals: [1000] })
  await page.close()
})

test.afterAll(async () => {
  if (!process.env.CLERK_SECRET_KEY) return
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  // Delete org first → fires organization.deleted (cascades memberships in Django)
  if (specOrgId) await clerk.organizations.deleteOrganization(specOrgId).catch(() => {})
  await Promise.all([
    memberUserId   ? clerk.users.deleteUser(memberUserId).catch(() => {})   : Promise.resolve(),
    inactiveUserId ? clerk.users.deleteUser(inactiveUserId).catch(() => {}) : Promise.resolve(),
    adminUserId    ? clerk.users.deleteUser(adminUserId).catch(() => {})    : Promise.resolve(),
  ])
  // Wait for deletion webhooks to be processed
  await new Promise(r => setTimeout(r, 3000))
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page, adminUserId)
})

test.describe('Users Page', () => {
  test('displays users table after loading', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Inactive User').first()).toBeVisible()
  })

  test('shows table headers', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Organisation' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
  })

  test('shows role and status badges', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Member').first()).toBeVisible()
    await expect(page.getByText('Active').first()).toBeVisible()
    await expect(page.getByText('Inactive').first()).toBeVisible()
  })

  test('shows Invite User button', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Invite User' })).toBeVisible()
  })

  test('shows action buttons for non-self users', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Make Admin' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Deactivate' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Re-invite' })).toBeVisible()
  })

  test('can open invite user dialog', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByText('Invite User', { exact: false }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send Invite' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('can submit invite user form', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible({ timeout: 5000 })
    await page.getByPlaceholder('user@example.com').fill(`invite-${ts}@test.1reach.com`)
    await page.getByRole('button', { name: 'Send Invite' }).click()
    await expect(page.getByPlaceholder('user@example.com')).not.toBeVisible({ timeout: 5000 })
  })

  test('can close invite dialog with cancel', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByPlaceholder('user@example.com')).not.toBeVisible({ timeout: 5000 })
  })

  test('Make Admin button triggers role update without error', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Make Admin' }).first().click()
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })

  test('Deactivate button triggers status update without error', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Deactivate' }).first().click()
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })

  test('Re-invite button triggers re-invitation without error', async ({ page }) => {
    await page.goto('/app/users')
    await expect(page.getByText('Member User').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Re-invite' }).click()
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })
})
