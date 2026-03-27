import { test, expect } from '@playwright/test'
import dayjs from 'dayjs'
import {
  authenticatePage,
  deleteContact, ensureContact,
  apiRequest, forceStatus, deleteSchedule,
} from './helpers'

const scheduleIds: number[] = []
let contact: { id: number }

const SCHEDULES = [
  { message: 'Hello Alice',   status: 'pending',   phone: '0414111111' },
  { message: 'Hello Bob',     status: 'sent',      phone: '0414222222' },
  { message: 'Hello Charlie', status: 'queued',    phone: '0414333333' },
  { message: 'Hello Diana',   status: 'retrying',  phone: '0414444444' },
  { message: 'Hello Eve',     status: 'delivered', phone: '0414555555' },
  { message: 'Hello Frank',   status: 'failed',    phone: '0414666666' },
]

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)

  contact = await ensureContact(page, { first_name: 'Schedule', last_name: 'Test', phone: '0414000000' })

  for (const s of SCHEDULES) {
    const schedule = await apiRequest(page, 'POST', '/api/sms/send/', {
      message: s.message,
      recipient: s.phone,
      contact_id: contact.id,
    })
    scheduleIds.push(schedule.schedule_id)
    await forceStatus(page, schedule.schedule_id, s.status)
  }

  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all(scheduleIds.map(id => deleteSchedule(page, id).catch(() => {})))
  if (contact?.id) await deleteContact(page, contact.id).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.describe('Schedule Page', () => {
  test('displays schedule table with messages', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Hello Bob').first()).toBeVisible()
  })

  test('shows current date', async ({ page }) => {
    await page.goto('/app/schedule')
    const today = dayjs().format('DD/MM/YYYY')
    await expect(page.getByText(today)).toBeVisible({ timeout: 10000 })
  })

  test('can navigate to previous day', async ({ page }) => {
    await page.goto('/app/schedule')
    const today = dayjs().format('DD/MM/YYYY')
    const dateButton = page.getByRole('button', { name: today })
    await expect(dateButton).toBeVisible({ timeout: 10000 })
    // Previous day arrow is the first button in the nav row
    const navRow = dateButton.locator('..').locator('..')
    await navRow.locator('button').first().click()
    const yesterday = dayjs().subtract(1, 'day').format('DD/MM/YYYY')
    await expect(page.getByRole('button', { name: yesterday })).toBeVisible({ timeout: 5000 })
  })

  test('can navigate to next day', async ({ page }) => {
    await page.goto('/app/schedule')
    const today = dayjs().format('DD/MM/YYYY')
    const dateButton = page.getByRole('button', { name: today })
    await expect(dateButton).toBeVisible({ timeout: 10000 })
    // Next day arrow is the last button in the nav row
    const navRow = dateButton.locator('..').locator('..')
    await navRow.locator('button').last().click({ timeout: 5000 })
    const tomorrow = dayjs().add(1, 'day').format('DD/MM/YYYY')
    await expect(page.getByRole('button', { name: tomorrow })).toBeVisible({ timeout: 5000 })
  })

  test('shows message status badges', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/pending/i).first()).toBeVisible()
    await expect(page.getByText(/sent/i).first()).toBeVisible()
  })

  test('shows async pipeline status badges — queued, retrying, delivered, failed', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Charlie').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/queued/i).first()).toBeVisible()
    await expect(page.getByText(/retrying/i).first()).toBeVisible()
    await expect(page.getByText(/delivered/i).first()).toBeVisible()
    await expect(page.getByText(/failed/i).first()).toBeVisible()
  })

  test('can expand a row to see message details', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })
    // Click the row to expand
    await page.getByText('Hello Alice').first().click()
    // Expanded detail row should appear with a colspan cell
    await expect(page.locator('td[colspan]').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows pagination info text', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Showing .* of .* results/i).first()).toBeVisible()
  })
})
