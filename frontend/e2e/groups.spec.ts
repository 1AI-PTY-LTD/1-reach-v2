import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  deleteContact, ensureContact,
  createGroup, addMembers, deleteGroup,
} from './helpers'

let contact1: { id: number }, contact2: { id: number }
let group: { id: number; name: string }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  ;[contact1, contact2] = await Promise.all([
    ensureContact(page, { first_name: 'Alice', last_name: 'Smith', phone: '0413111111' }),
    ensureContact(page, { first_name: 'Bob',   last_name: 'Jones', phone: '0413222222' }),
  ])
  group = await createGroup(page, { name: 'VIP Customers' })
  await addMembers(page, group.id, [contact1.id, contact2.id])
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  if (group?.id)    await deleteGroup(page, group.id).catch(() => {})
  if (contact1?.id) await deleteContact(page, contact1.id).catch(() => {})
  if (contact2?.id) await deleteContact(page, contact2.id).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.describe('Groups Page', () => {
  test('displays groups list', async ({ page }) => {
    await page.goto('/app/groups')
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
  })

  test('shows group detail when clicking a group', async ({ page }) => {
    await page.goto('/app/groups')
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await page.locator(`a[href*="/app/groups/${group?.id}"]`).first().click()
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/member/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows member count for groups', async ({ page }) => {
    await page.goto('/app/groups')
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('2').first()).toBeVisible()
  })

  test('can open create group modal', async ({ page }) => {
    await page.goto('/app/groups')
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()
      await expect(page.getByText(/group name|create group|new group/i).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('can fill and submit the create group form', async ({ page }) => {
    await page.goto('/app/groups')
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()
      await expect(page.getByText(/group name|create group|new group/i).first()).toBeVisible({ timeout: 5000 })
      const nameInput = page.getByLabel(/group name/i).or(page.getByPlaceholder(/group name/i)).first()
      await nameInput.fill('Temp E2E Group')
      await page.getByRole('button', { name: 'Create Group' }).click()
      await expect(page.getByText('Create New Group')).not.toBeVisible({ timeout: 5000 })
    }
  })

  test('shows group contacts tab with members', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await page.locator('[role="tab"][aria-controls="tabpanel-users"]').click()
    await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Smith').first()).toBeVisible()
    await expect(page.getByText('Bob').first()).toBeVisible()
    await expect(page.getByText('Jones').first()).toBeVisible()
  })

  test('can open add contacts modal within a group', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await page.locator('[role="tab"][aria-controls="tabpanel-users"]').click()
    await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15000 })
    await page.locator('[role="tabpanel"] button:not([aria-label])').last().click()
    await expect(page.getByText('Select Contacts To Add').first()).toBeVisible({ timeout: 5000 })
  })
})
