/**
 * Real failure path — sends a real Welcorp message to the free test number, then
 * simulates Welcorp's async delivery receipt (DLR) by POSTing the exact payload
 * to the REAL /api/webhooks/sms-delivery/ endpoint (Welcorp can't reach the
 * non-public test backend). This runs the genuine
 * validate_callback_request -> parse_delivery_callback -> process_delivery_event
 * -> refund code, asserting the schedule ends FAILED.
 *
 * Only the FAIL code is exercised in E2E: OPTO would mark the shared free number
 * opted-out and poison other specs, so OPTO propagation is a backend test
 * (tests/tasks/test_process_delivery.py). Requires Clerk + worker + Welcorp creds.
 */
import { test, expect } from '@playwright/test'
import {
  authenticatePage, apiRequest, ensureContact, deleteContact, deleteSchedule,
  setOrgBalance, postDeliveryReceipt, waitForProviderMessageId,
} from './helpers'

const PHONE = '0447119283' // +61447119283, Welcorp's free test number

let contact: { id: number }
const scheduleIds: number[] = []

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await setOrgBalance(page, 100)
  contact = await ensureContact(page, { first_name: 'Fail', last_name: 'Path', phone: PHONE })
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  for (const id of scheduleIds) await deleteSchedule(page, id).catch(() => {})
  if (contact?.id) await deleteContact(page, contact.id).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test('a FAIL delivery receipt drives the schedule to FAILED via the real callback path', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'requires Clerk + celery worker + Welcorp creds')

  // Real Welcorp send → worker dispatches → schedule reaches SENT with a job id.
  const r = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: 'E2E fail path',
    recipients: [{ phone: PHONE, contact_id: contact.id }],
  })
  scheduleIds.push(r.schedule_id)
  const providerMessageId = await waitForProviderMessageId(page, r.schedule_id)

  // Simulate Welcorp's async failure DLR against the real webhook (real token).
  await postDeliveryReceipt(page, { provider_message_id: providerMessageId, status_code: 'FAIL' })

  await expect(async () => {
    const s = await apiRequest(page, 'GET', `/api/schedules/${r.schedule_id}/`)
    expect(s.status).toBe('failed')
    expect(s.failure_category).toBeTruthy()
  }).toPass({ timeout: 20000, intervals: [1000] })
})
