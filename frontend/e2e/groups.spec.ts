import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  deleteContact, ensureContact,
  createGroup, addMembers, deleteGroup,
} from './helpers'

let contact1: { id: number }, contact2: { id: number }, contact3: { id: number }
let group: { id: number; name: string }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  ;[contact1, contact2, contact3] = await Promise.all([
    ensureContact(page, { first_name: 'Alice', last_name: 'Smith', phone: '0413111111' }),
    ensureContact(page, { first_name: 'Bob',   last_name: 'Jones', phone: '0413222222' }),
    ensureContact(page, { first_name: 'Removable', last_name: 'Member', phone: '0413333333' }),
  ])
  group = await createGroup(page, { name: 'VIP Customers' })
  await addMembers(page, group.id, [contact1.id, contact2.id, contact3.id])
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all([
    group?.id    ? deleteGroup(page, group.id).catch(() => {})    : Promise.resolve(),
    contact1?.id ? deleteContact(page, contact1.id).catch(() => {}) : Promise.resolve(),
    contact2?.id ? deleteContact(page, contact2.id).catch(() => {}) : Promise.resolve(),
    contact3?.id ? deleteContact(page, contact3.id).catch(() => {}) : Promise.resolve(),
  ])
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
    await expect(page.getByText('3').first()).toBeVisible()
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

  test('can edit group name via edit modal', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    // Click the pencil/edit button (outline button with the group name)
    const editButton = page.getByRole('button').filter({ hasText: /VIP Customers/i }).first()
    await editButton.click()
    await expect(page.getByText('Edit Group')).toBeVisible({ timeout: 5000 })
    const nameInput = page.getByPlaceholder('Group name')
    await nameInput.clear()
    await nameInput.fill('VIP Customers')
    await page.getByRole('button', { name: 'Update Group' }).click()
    await expect(page.getByText('Edit Group')).not.toBeVisible({ timeout: 5000 })
  })

  test('shows messages tab with table headers', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    // Messages tab is the default tab — verify headers
    await expect(page.getByText('Scheduled For').first()).toBeVisible({ timeout: 5000 })
  })

  test('can open group schedule modal from messages tab', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    // Click the green + button on the messages tab
    const addButton = page.locator('[role="tabpanel"] button').filter({ has: page.locator('svg') }).filter({ hasNotText: /./  }).last()
    await addButton.click()
    // GroupScheduleModal should open
    await expect(page.getByText(/schedule.*message|create.*message|new.*message/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('can remove a member from contacts tab', async ({ page }) => {
    await page.goto(`/app/groups/${group?.id}`)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await page.locator('[role="tab"][aria-controls="tabpanel-users"]').click()
    await expect(page.getByText('Removable').first()).toBeVisible({ timeout: 15000 })
    // Click remove button for Removable Member
    await page.getByRole('button', { name: /Remove Removable Member from group/i }).click()
    // Confirm in the dialog
    await expect(page.getByText('Remove Member').first()).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Remove Member' }).click()
    // Dialog should close
    await expect(page.getByText('Are you sure you want to remove').first()).not.toBeVisible({ timeout: 5000 })
  })
})
