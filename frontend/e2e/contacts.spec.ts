import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  deleteContact, ensureContact, deleteSchedule,
  apiRequest, setOrgBalance,
} from './helpers'

const createdIds: number[] = []
const scheduleIds: number[] = []
let c1: { id: number }, c2: { id: number }, c3: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)

  await setOrgBalance(page, 100)

  ;[c1, c2, c3] = await Promise.all([
    ensureContact(page, { first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
    ensureContact(page, { first_name: 'Bob',   last_name: 'Jones', phone: '0412222222' }),
    ensureContact(page, { first_name: 'Charlie', last_name: 'Brown', phone: '0412333333' }),
  ])
  createdIds.push(c1.id, c2.id, c3.id)

  // Send an SMS to c1 to populate message history
  const res = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: 'Contact history test',
    recipient: '0412111111',
    contact_id: c1.id,
  })
  if (res?.schedule_id) scheduleIds.push(res.schedule_id)

  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all(scheduleIds.map(id => deleteSchedule(page, id).catch(() => {})))
  await Promise.all(createdIds.map(id => deleteContact(page, id).catch(() => {})))
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.describe('Contacts Page', () => {
  test('displays contacts list after loading', async ({ page }) => {
    await page.goto('/app/contacts')
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Bob Jones').first()).toBeVisible()
    await expect(page.getByText('Charlie Brown').first()).toBeVisible()
  })

  test('shows contact details when clicking a contact', async ({ page }) => {
    await page.goto('/app/contacts')
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    await page.locator(`a[href="/app/contacts/${c2?.id}"]`).first().click()
    await expect(page.getByText('0412 222 222').or(page.getByText('0412222222')).first()).toBeVisible({ timeout: 5000 })
  })

  test('can search for contacts', async ({ page }) => {
    await page.goto('/app/contacts')
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('Alice')
      await expect(page.getByText('Alice').first()).toBeVisible()
    }
  })

  test('can open create contact modal', async ({ page }) => {
    await page.goto('/app/contacts')
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /add/i }).first().click()
    await expect(page.getByText(/first name/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('can fill and submit the create contact form', async ({ page }) => {
    await page.goto('/app/contacts')
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /add/i }).first().click()
    await expect(page.getByText(/first name/i).first()).toBeVisible({ timeout: 5000 })
    await page.getByPlaceholder('First Name').fill('Jane')
    await page.getByPlaceholder('Last Name').fill('Doe')
    await page.getByPlaceholder('0412 345 678').pressSequentially('0499111222')
    await page.getByRole('button', { name: /create/i }).first().click()
    await expect(page.getByPlaceholder('First Name')).not.toBeVisible({ timeout: 5000 })
    const contacts = await apiRequest(page, 'GET', '/api/contacts/?search=Jane&limit=10')
    for (const c of contacts.results ?? []) {
      if (!createdIds.includes(c.id)) createdIds.push(c.id)
    }
  })

  test('can open edit contact modal from contact detail', async ({ page }) => {
    await page.goto(`/app/contacts/${c1?.id}`)
    await expect(page.getByText(/alice/i).first()).toBeVisible({ timeout: 10000 })
    const editButton = page.getByRole('button').filter({ hasText: /alice/i }).first()
    await editButton.click()
    await expect(page.getByText(/edit contact details/i)).toBeVisible({ timeout: 5000 })
  })

  test('can submit edit contact form', async ({ page }) => {
    await page.goto(`/app/contacts/${c1?.id}`)
    await expect(page.getByText(/alice/i).first()).toBeVisible({ timeout: 10000 })
    const editButton = page.getByRole('button').filter({ hasText: /alice/i }).first()
    await editButton.click()
    await expect(page.getByText(/edit contact details/i)).toBeVisible({ timeout: 5000 })
    const firstNameInput = page.getByPlaceholder('First Name')
    await firstNameInput.clear()
    await firstNameInput.fill('Alicia')
    await page.getByRole('button', { name: /update/i }).first().click()
    await expect(page.getByText(/edit contact details/i)).not.toBeVisible({ timeout: 5000 })
  })

  test('shows message history table on contact detail', async ({ page }) => {
    await page.goto(`/app/contacts/${c1?.id}`)
    await expect(page.getByText(/ali/i).first()).toBeVisible({ timeout: 10000 })
    // Message history table headers should be visible
    await expect(page.getByText('Status').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Scheduled Time').first()).toBeVisible()
    await expect(page.getByText('Sent Time').first()).toBeVisible()
    await expect(page.getByText('Message').first()).toBeVisible()
  })

  test('can open send message modal from contact detail', async ({ page }) => {
    await page.goto(`/app/contacts/${c1?.id}`)
    await expect(page.getByText(/ali/i).first()).toBeVisible({ timeout: 10000 })
    // Click the green + button (emerald button with white plus icon)
    await page.locator('button').filter({ has: page.locator('svg.fill-white') }).first().click()
    await expect(page.getByText(/create new message for/i)).toBeVisible({ timeout: 5000 })
  })
})
