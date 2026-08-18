/**
 * Two-way SMS conversations (Inbox) — real pipeline.
 *
 * Outbound sends are REAL Welcorp two-way jobs to the free test number (this
 * also live-validates the WELCORP_TWO_WAY_JOB_TYPE literal against the real
 * API). Replies are simulated by POSTing the documented reply-callback form
 * payload to the real webhook (Welcorp can't reach the non-public CI/local
 * backend) — the same convention send-real-pipeline.spec.ts uses for DLRs.
 *
 * Requires Clerk auth + a running celery worker + real Welcorp creds. Skipped
 * otherwise. Inbound rows have no delete API, so every reply text carries a
 * per-run token and assertions target that token, never global counts.
 */
import { test, expect } from '@playwright/test'
import {
  authenticatePage, apiRequest, ensureContact, deleteSchedule, setOrgBalance,
  createConfig, deleteConfig,
  postDeliveryReceipt, postInboundReply, waitForProviderMessageId,
  E2E_FREE_PHONE,
} from './helpers'

const TOKEN = `inbx${Date.now().toString(36)}`
const REQUIRED = !process.env.CLERK_SECRET_KEY

let contact: { id: number }
const scheduleIds: number[] = []

async function sendTwoWay(page, message: string): Promise<{ scheduleId: number; jobId: string }> {
  const r = await apiRequest(page, 'POST', '/api/sms/send/', {
    message,
    recipients: [{ phone: E2E_FREE_PHONE, contact_id: contact.id }],
    two_way: true,
  })
  expect(r.schedule_id).toBeTruthy()
  scheduleIds.push(r.schedule_id)
  const jobId = await waitForProviderMessageId(page, r.schedule_id)
  return { scheduleId: r.schedule_id, jobId }
}

/** Poll until the worker has stored a reply containing the given text. */
async function waitForInboundReply(page, text: string, timeoutMs = 20000) {
  await expect(async () => {
    const res = await apiRequest(page, 'GET', `/api/conversations/${contact.id}/thread/?limit=50`)
    const texts = res.results.filter((m) => m.direction === 'inbound').map((m) => m.text)
    expect(texts).toContain(text)
  }).toPass({ timeout: timeoutMs, intervals: [1000] })
}

/** Clear opt-out on every org contact holding the free number (STOP test cleanup). */
async function clearOptOut(page) {
  const res = await apiRequest(page, 'GET', `/api/contacts/?search=${E2E_FREE_PHONE}&limit=50`)
  for (const c of res.results) {
    if (c.opt_out) {
      await apiRequest(page, 'PUT', `/api/contacts/${c.id}/`, { ...c, opt_out: false })
    }
  }
}

test.beforeAll(async ({ browser }) => {
  if (REQUIRED) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await setOrgBalance(page, 100)
  contact = await ensureContact(page, {
    first_name: 'Inbox', last_name: 'Thread', phone: E2E_FREE_PHONE,
  })
  await clearOptOut(page)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (REQUIRED) return
  const page = await browser.newPage()
  await authenticatePage(page)
  for (const id of scheduleIds) await deleteSchedule(page, id).catch(() => {})
  await clearOptOut(page).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test('reply to a real two-way send appears in the Inbox and can be answered', async ({ page }) => {
  test.skip(REQUIRED, 'requires Clerk + celery worker + Welcorp creds')

  const replyText = `${TOKEN} yes please`
  const { jobId } = await sendTwoWay(page, `${TOKEN} reply YES to confirm`)

  await postInboundReply(page, { provider_message_id: jobId, response: replyText })
  await waitForInboundReply(page, replyText)

  // Nav badge shows unread replies (count is org-global, so assert presence
  // only). Checked from a non-inbox page: /app/inbox auto-opens the first
  // conversation, which marks it read and races the badge away.
  await page.goto('/app/schedule')
  await expect(page.getByTestId('inbox-unread-badge')).toBeVisible()

  // The conversation thread shows the inbound bubble.
  await page.goto(`/app/inbox/${contact.id}`)
  await expect(
    page.locator('[data-testid="bubble-inbound"]', { hasText: replyText })
  ).toBeVisible()

  // Reply back from the composer — a real two-way send through the pipeline.
  const answer = `${TOKEN} see you at 10`
  await page.getByLabel('Reply message').fill(answer)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(
    page.locator('[data-testid="bubble-outbound"]', { hasText: answer })
  ).toBeVisible({ timeout: 15000 })

  // Record the composer-created schedule for cleanup.
  const thread = await apiRequest(page, 'GET', `/api/conversations/${contact.id}/thread/?limit=50`)
  for (const m of thread.results) {
    if (m.direction === 'outbound' && m.text === answer) scheduleIds.push(m.id)
  }

  // Viewing the thread marked it read.
  await expect(async () => {
    const t = await apiRequest(page, 'GET', `/api/conversations/${contact.id}/thread/?limit=50`)
    const mine = t.results.find((m) => m.direction === 'inbound' && m.text === replyText)
    expect(mine.read_at).toBeTruthy()
  }).toPass({ timeout: 10000, intervals: [1000] })
})

test('hazard regression: a reply arriving before the DLR never fails the schedule', async ({ page }) => {
  test.skip(REQUIRED, 'requires Clerk + celery worker + Welcorp creds')

  const { scheduleId, jobId } = await sendTwoWay(page, `${TOKEN} hazard check`)

  // Reply FIRST (while the schedule is still SENT), DLR second — the order
  // that used to flip SENT → FAILED + refund before the parser guard.
  await postInboundReply(page, { provider_message_id: jobId, response: `${TOKEN} quick reply` })
  await waitForInboundReply(page, `${TOKEN} quick reply`)

  let s = await apiRequest(page, 'GET', `/api/schedules/${scheduleId}/`)
  expect(s.status).not.toBe('failed')

  await postDeliveryReceipt(page, { provider_message_id: jobId, status_code: 'SENT' })
  await expect(async () => {
    s = await apiRequest(page, 'GET', `/api/schedules/${scheduleId}/`)
    expect(s.status).toBe('delivered')
  }).toPass({ timeout: 15000, intervals: [1000] })
})

test('a STOP reply opts the contact out and blocks further sends', async ({ page }) => {
  test.skip(REQUIRED, 'requires Clerk + celery worker + Welcorp creds')

  const { jobId } = await sendTwoWay(page, `${TOKEN} stop test`)

  try {
    await postInboundReply(page, { provider_message_id: jobId, response: 'STOP' })

    // The worker flips opt_out for every org contact with the replier's number.
    await expect(async () => {
      const c = await apiRequest(page, 'GET', `/api/contacts/${contact.id}/`)
      expect(c.opt_out).toBe(true)
    }).toPass({ timeout: 15000, intervals: [1000] })

    // Composer is disabled for opted-out contacts.
    await page.goto(`/app/inbox/${contact.id}`)
    await expect(page.getByTestId('composer-opted-out')).toBeVisible()

    // And the send API refuses the recipient outright.
    let status = 0
    try {
      await apiRequest(page, 'POST', '/api/sms/send/', {
        message: `${TOKEN} should be blocked`,
        recipients: [{ phone: E2E_FREE_PHONE, contact_id: contact.id }],
        two_way: true,
      })
    } catch (e) {
      status = Number(((e as Error).message.match(/→ (\d+)/) || [])[1])
    }
    expect(status).toBe(400)
  } finally {
    await clearOptOut(page)
  }
})

test('Allow replies checkbox and Sender ID hard-disable each other', async ({ page }) => {
  test.skip(REQUIRED, 'requires Clerk auth')

  const config = await createConfig(page, {
    name: 'allowed_alphanumeric_senders',
    value: '["E2EBRAND"]',
  })
  try {
    await page.goto('/app/send')
    const checkbox = page.getByRole('checkbox', { name: 'Allow replies' })
    const senderSelect = page.locator('select', {
      has: page.locator('option', { hasText: 'None (random number)' }),
    })

    // The form auto-selects the first sender → checkbox disabled.
    await expect(senderSelect).toHaveValue('E2EBRAND')
    await expect(checkbox).toHaveAttribute('aria-disabled', 'true')

    // Selecting None releases the checkbox; checking it locks the select.
    await senderSelect.selectOption('')
    await expect(checkbox).not.toHaveAttribute('aria-disabled', 'true')
    await checkbox.click()
    await expect(senderSelect).toBeDisabled()
  } finally {
    await deleteConfig(page, config.id).catch(() => {})
  }
})
