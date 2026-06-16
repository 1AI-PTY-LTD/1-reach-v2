/**
 * Real async send pipeline — asserts a message goes QUEUED -> SENT through the
 * REAL Celery worker and the REAL Welcorp provider (sending to Welcorp's free
 * test number), with NO force-status.
 *
 * This is the spec that would have caught the incident where the deployed
 * worker/beat ran gunicorn instead of celery: with no worker consuming the
 * queue, the message never leaves QUEUED and this test fails (instead of a
 * forced status making it pass green).
 *
 * Requires Clerk auth + a running celery worker/beat + real Welcorp creds in the
 * backend env (all present in CI and local docker-compose). Skipped otherwise.
 */
import { test, expect } from '@playwright/test'
import {
  authenticatePage, apiRequest, ensureContact, deleteContact, deleteSchedule,
  setOrgBalance,
} from './helpers'

// Local form of +61447119283 — Welcorp's free, non-charged test number.
const PHONE = '0447119283'

let contact: { id: number }
const scheduleIds: number[] = []

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await setOrgBalance(page, 100)
  contact = await ensureContact(page, { first_name: 'Real', last_name: 'Pipeline', phone: PHONE })
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

test('send reaches SENT through the real worker (no force-status)', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'requires Clerk + celery worker + Welcorp creds')

  const r = await apiRequest(page, 'POST', '/api/sms/send/', {
    message: 'E2E real pipeline send',
    recipients: [{ phone: PHONE, contact_id: contact.id }],
  })
  expect(r.schedule_id).toBeTruthy()
  scheduleIds.push(r.schedule_id)

  // No forceStatus: the worker must dequeue the task and the real Welcorp job
  // must be accepted for this to reach a terminal SENT/DELIVERED state.
  await expect(async () => {
    const s = await apiRequest(page, 'GET', `/api/schedules/${r.schedule_id}/`)
    expect(['sent', 'delivered']).toContain(s.status)
  }).toPass({ timeout: 30000, intervals: [1000] })
})

test('insufficient balance is rejected before the message is ever queued', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'requires Clerk + celery worker + Welcorp creds')

  await setOrgBalance(page, 0)
  try {
    let status = 0
    try {
      await apiRequest(page, 'POST', '/api/sms/send/', {
        message: 'should be blocked',
        recipients: [{ phone: PHONE, contact_id: contact.id }],
      })
    } catch (e: any) {
      status = Number((e.message.match(/→ (\d+)/) || [])[1])
    }
    // The prepaid gate blocks at HTTP time before anything is queued or sent.
    // The single-send view raises ValidationError on an insufficient balance, so
    // the client sees 400 (402 is used by the separate retry endpoint).
    expect(status).toBe(400)
  } finally {
    await setOrgBalance(page, 100)
  }
})
