import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  ensureContact, deleteContact,
  deleteSchedule,
  apiRequest,
  setOrgBalance,
  createConfig, deleteConfig,
} from './helpers'

let contact: { id: number }
const scheduleIds: number[] = []
let configId: number | null = null

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)

  // Ensure balance for sending
  await setOrgBalance(page, 100)

  // Create a contact and send an SMS to generate stats
  contact = await ensureContact(page, { first_name: 'Summary', last_name: 'Test', phone: '0413111111' })
  const res = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: 'Summary stats test',
    recipient: '0413111111',
    contact_id: contact.id,
  })
  if (res?.schedule_id) scheduleIds.push(res.schedule_id)

  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all(scheduleIds.map(id => deleteSchedule(page, id).catch(() => {})))
  await deleteContact(page, contact.id).catch(() => {})
  if (configId) await deleteConfig(page, configId).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.describe('Summary Page', () => {
  test('displays monthly spend heading', async ({ page }) => {
    await page.goto('/app/summary')
    await expect(page.getByText(/Monthly spend:/)).toBeVisible({ timeout: 10000 })
  })

  test('shows stats table headers', async ({ page }) => {
    await page.goto('/app/summary')
    await expect(page.getByText('Month').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('SMS Sent').first()).toBeVisible()
    await expect(page.getByText('SMS Message Parts').first()).toBeVisible()
    await expect(page.getByText('MMS Total').first()).toBeVisible()
    await expect(page.getByText('Pending').first()).toBeVisible()
    await expect(page.getByText('Errored').first()).toBeVisible()
  })

  test('displays at least one month row', async ({ page }) => {
    await page.goto('/app/summary')
    await expect(page.getByText(/Monthly spend:/).first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })

  test('shows monthly limit when set', async ({ page }) => {
    try {
      const config = await createConfig(page, { name: 'monthly_limit', value: '500.00' })
      configId = config.id
      await page.goto('/app/summary')
      await expect(page.getByText(/\$500\.00 limit/)).toBeVisible({ timeout: 10000 })
    } finally {
      if (configId) {
        await deleteConfig(page, configId).catch(() => {})
        configId = null
      }
    }
  })
})
