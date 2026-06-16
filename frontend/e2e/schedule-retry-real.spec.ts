/**
 * Manual retry journey driven by a REAL failure (no force-status): a real Welcorp
 * send is failed via a simulated FAIL delivery receipt to the real webhook, then
 * the message is retried from the schedule page and a real re-dispatch leaves the
 * FAILED state. Requires Clerk + celery worker + Welcorp creds.
 */
import { test, expect } from '@playwright/test'
import {
  authenticatePage, apiRequest, ensureContact, deleteContact, deleteSchedule,
  setOrgBalance, postDeliveryReceipt, waitForProviderMessageId,
} from './helpers'

const PHONE = '0447119283' // +61447119283, Welcorp's free test number
// Must not be a superstring of any other spec's message filter (e.g. the legacy
// schedule-retry.spec.ts filters on 'Retry journey message').
const MESSAGE = 'E2E real-pipeline retry check'

let scheduleId: number
let contact: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await setOrgBalance(page, 50)
  contact = await ensureContact(page, { first_name: 'Retry', last_name: 'Real', phone: PHONE })

  // Real send → wait for the worker's provider_message_id → simulate a FAIL DLR.
  const r = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: MESSAGE, recipients: [{ phone: PHONE, contact_id: contact.id }],
  })
  scheduleId = r.schedule_id
  const providerMessageId = await waitForProviderMessageId(page, scheduleId)
  await postDeliveryReceipt(page, { provider_message_id: providerMessageId, status_code: 'FAIL' })

  // Wait for the real callback to land the schedule in FAILED before the test runs.
  await expect(async () => {
    const s = await apiRequest(page, 'GET', `/api/schedules/${scheduleId}/`)
    expect(s.status).toBe('failed')
  }).toPass({ timeout: 20000, intervals: [1000] })
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  if (scheduleId) await deleteSchedule(page, scheduleId).catch(() => {})
  if (contact?.id) await deleteContact(page, contact.id).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test('a really-failed message can be retried and leaves FAILED via the worker', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'requires Clerk + celery worker + Welcorp creds')

  await page.goto('/app/schedule')

  const row = page.getByRole('row').filter({ hasText: MESSAGE })
  await expect(row).toBeVisible()
  await row.click()

  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Retry this message?')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, retry' }).click()

  // The Retry button only renders for status=failed; its disappearance proves
  // the schedule left FAILED — and the backend confirms a real re-dispatch.
  await expect(page.getByRole('button', { name: 'Retry' })).toBeHidden({ timeout: 15000 })
  await expect(async () => {
    const s = await apiRequest(page, 'GET', `/api/schedules/${scheduleId}/`)
    expect(['queued', 'processing', 'sent', 'delivered']).toContain(s.status)
  }).toPass({ timeout: 20000, intervals: [1000] })
})
