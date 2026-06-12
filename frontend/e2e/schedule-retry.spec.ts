import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  apiRequest,
  deleteContact,
  deleteSchedule,
  ensureContact,
  forceStatus,
  setOrgBalance,
} from './helpers'

/**
 * Manual retry journey (previously untested end-to-end): a FAILED message is
 * retried from the schedule detail page and leaves the failed state.
 */

let scheduleId: number
let contact: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)

  // Retry re-checks billing and re-charges prepaid credits — make sure the
  // org can afford it.
  await setOrgBalance(page, 50)

  contact = await ensureContact(page, {
    first_name: 'Retry', last_name: 'Journey', phone: '0414909090',
  })
  const result = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: 'Retry journey message',
    recipients: [{ phone: '0414909090', contact_id: contact.id }],
  })
  scheduleId = result.schedule_id

  // Let the worker finish the original dispatch before forcing FAILED,
  // otherwise it may overwrite the forced status.
  await page.waitForTimeout(3000)
  await forceStatus(page, scheduleId, 'failed')
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

test('failed message can be retried from the schedule page', async ({ page }) => {
  await page.goto('/app/schedule')

  // Expand the failed message's row to reveal the inline detail panel
  const row = page.getByRole('row').filter({ hasText: 'Retry journey message' })
  await expect(row).toBeVisible()
  await row.click()

  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Retry this message?')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, retry' }).click()

  // The retry re-queues the message; the Retry button only renders for
  // status=failed, so it disappearing proves the schedule left FAILED.
  await expect(page.getByRole('button', { name: 'Retry' })).toBeHidden({ timeout: 15000 })

  // And the backend confirms a non-failed status
  await expect(async () => {
    const schedule = await apiRequest(page, 'GET', `/api/schedules/${scheduleId}/`)
    expect(['queued', 'processing', 'sent', 'delivered']).toContain(schedule.status)
  }).toPass({ timeout: 15000 })
})
