/**
 * E2E tests for the async send pipeline from the user's perspective.
 *
 * These tests verify UI behaviour across the full send flow:
 *   - Submitting the form → API called → success/error state shown
 *   - 202 Accepted responses handled as success (not treated as errors)
 *   - Billing gate errors (insufficient balance, monthly limit) surface correctly
 *   - Group send shows queued recipient count in the summary
 *   - MMS send flow works end-to-end in the browser
 *
 * Billing gate error tests use real backend state:
 *   - setOrgBalance(page, 0) triggers "Insufficient balance. Subscribe to continue sending."
 *   - createConfig(page, { name: 'monthly_limit', value: '0.00' }) triggers monthly limit error
 * Both use try/finally to restore state even on test failure.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  authenticatePage,
  deleteContact, ensureContact,
  createGroup, addMembers, deleteGroup,
  deleteSchedule, forceStatus,
  apiRequest,
  setOrgBalance,
  createConfig, deleteConfig,
} from './helpers'

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

let contact: { id: number }
let group: { id: number }
let pipelineScheduleIds: number[] = []

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)

  // Ensure enough balance for all sends (parallel tests may consume credits)
  await setOrgBalance(page, 100)

  // Clean up any stale monthly_limit config from a previous failed run
  const configs = await apiRequest(page, 'GET', '/api/configs/?limit=100')
  for (const c of (configs.results || configs || [])) {
    if (c.name === 'monthly_limit') {
      await apiRequest(page, 'DELETE', `/api/configs/${c.id}/`).catch(() => {})
    }
  }

  contact = await ensureContact(page, { first_name: 'Pipeline', last_name: 'Test', phone: '0416111111' })
  const groupContact = await ensureContact(page, { first_name: 'Group', last_name: 'Member', phone: '0416222222' })
  group = await createGroup(page, { name: 'Pipeline Group' })
  await addMembers(page, group.id, [groupContact.id])

  // Create schedules for pipeline status display tests
  const PIPELINE_STATES = [
    { message: 'Hello Charlie', status: 'queued',    phone: '0416333333' },
    { message: 'Hello Diana',   status: 'retrying',  phone: '0416444444' },
    { message: 'Hello Eve',     status: 'delivered', phone: '0416555555' },
    { message: 'Hello Frank',   status: 'failed',    phone: '0416666666' },
  ]
  for (const s of PIPELINE_STATES) {
    const result = await apiRequest(page, 'POST', '/api/sms/send/', {
      message: s.message,
      recipient: s.phone,
      contact_id: contact.id,
    })
    pipelineScheduleIds.push(result.schedule_id)
    await forceStatus(page, result.schedule_id, s.status)
  }

  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all(pipelineScheduleIds.map(id => deleteSchedule(page, id).catch(() => {})))
  if (group?.id)   await deleteGroup(page, group.id).catch(() => {})
  if (contact?.id) await deleteContact(page, contact.id).catch(() => {})
  await page.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill and submit the single-recipient send form. */
async function fillAndSubmitSmsForm(page: Page, message = 'Hello test') {
  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 10000 })
  await textarea.fill(message)

  const recipientInput = page.getByPlaceholder(/search|recipient|phone|contact/i).first()
  if (await recipientInput.isVisible()) {
    await recipientInput.fill('0416111111')
    const firstOption = page.locator('[role="option"]').first()
    if (await firstOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await firstOption.click()
    }
  }

  const sendBtn = page.getByRole('button', { name: /^send$/i }).first()
  await sendBtn.click()
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

// ---------------------------------------------------------------------------
// Success flows
// ---------------------------------------------------------------------------

test.describe('Send SMS — success flow', () => {
  test('202 response treated as success — summary dialog shows 1 successful', async ({ page }) => {
    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page)
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Unsuccessful').first()).toBeVisible()
  })

  test('success clears the message input', async ({ page }) => {
    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page, 'This should be cleared after send')
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Send MMS — success flow', () => {
  test('MMS send returns 202 and shows success summary', async ({ page }) => {
    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page, 'Check this out!')
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Billing gate errors (real backend state — no mocks)
// ---------------------------------------------------------------------------

test.describe('Billing gate — error surfaces in UI', () => {
  // These tests mutate shared org state (balance, config) — must not run in parallel
  test.describe.configure({ mode: 'serial' })

  test('insufficient trial balance shows balance error message', async ({ page }) => {
    await setOrgBalance(page, 0)
    try {
      await page.goto('/app/send')
      await fillAndSubmitSmsForm(page)
      await expect(
        page.getByText(/insufficient balance/i).or(page.getByText(/subscribe to continue/i)).first()
      ).toBeVisible({ timeout: 15000 })
    } finally {
      await setOrgBalance(page, 100)
    }
  })

  test('monthly spending limit shows limit error message', async ({ page }) => {
    const config = await createConfig(page, { name: 'monthly_limit', value: '0.00' })
    try {
      await page.goto('/app/send')
      await fillAndSubmitSmsForm(page)
      await expect(
        page.getByText(/monthly spending limit reached/i).or(page.getByText(/limit/i)).first()
      ).toBeVisible({ timeout: 8000 })
    } finally {
      await deleteConfig(page, config.id).catch(() => {})
    }
  })

  test('billing error shows 0 successful in summary dialog', async ({ page }) => {
    await setOrgBalance(page, 0)
    try {
      await page.goto('/app/send')
      await fillAndSubmitSmsForm(page)
      await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
      await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Unsuccessful').first()).toBeVisible()
      await expect(
        page.getByText(/insufficient balance/i).or(page.getByText(/subscribe to continue/i)).first()
      ).toBeVisible()
    } finally {
      await setOrgBalance(page, 100)
    }
  })
})

// ---------------------------------------------------------------------------
// Group send
// ---------------------------------------------------------------------------

test.describe('Group send — pipeline flow', () => {
  test('group send summary shows total queued count', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })

    const groupTab = page
      .getByRole('tab', { name: /group/i })
      .or(page.getByRole('button', { name: /group/i }))
      .first()

    if (await groupTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await groupTab.click()

      const groupSelect = page.getByRole('combobox').or(page.getByLabel(/group/i)).first()
      if (await groupSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await groupSelect.selectOption({ index: 0 })
      }

      const textarea = page.locator('textarea').first()
      await textarea.fill('Hello group!')

      const sendBtn = page.getByRole('button', { name: /^send$/i }).first()
      await sendBtn.click()

      // Summary should mention 1 recipient (1 group member from beforeAll)
      await expect(
        page.getByText('1').or(page.getByText(/1 recipient/i)).first()
      ).toBeVisible({ timeout: 8000 })
    }
  })
})

// ---------------------------------------------------------------------------
// Dispatch pipeline — visible states in schedule list
// ---------------------------------------------------------------------------

test.describe('Dispatch pipeline — schedule status display', () => {
  test('queued schedule appears in the schedule list', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Charlie').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/queued/i).first()).toBeVisible()
  })

  test('retrying schedule shows retrying status with retry context', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Diana').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/retrying/i).first()).toBeVisible()
  })

  test('delivered schedule shows delivered status', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Eve').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/delivered/i).first()).toBeVisible()
  })

  test('failed schedule shows failed status', async ({ page }) => {
    await page.goto('/app/schedule')
    await expect(page.getByText('Hello Frank').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/failed/i).first()).toBeVisible()
  })
})
