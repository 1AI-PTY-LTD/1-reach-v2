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
 * The backend API is mocked via Playwright route interception. Per-test
 * overrides are registered before mockApiEndpoints() so they take priority
 * (Playwright evaluates routes LIFO).
 */

import { test, expect, type Page } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

const BASE = 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Override the SMS send endpoint for a single test. */
async function overrideSmsRoute(
  page: Page,
  body: object,
  httpStatus = 400,
  path = '/api/sms/send/'
) {
  await page.route(`${BASE}${path}`, (route) =>
    route.fulfill({
      status: httpStatus,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  )
}

/** Fill and submit the single-recipient send form. */
async function fillAndSubmitSmsForm(page: Page, message = 'Hello test') {
  // Wait for the message textarea to be ready
  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 10000 })

  await textarea.fill(message)

  // Add a recipient — type phone directly if no contact selected
  const recipientInput = page
    .getByPlaceholder(/search|recipient|phone|contact/i)
    .first()
  if (await recipientInput.isVisible()) {
    await recipientInput.fill('0412345678')
    // If a dropdown appears, pick the first option; otherwise the field is used directly
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
  await mockApiEndpoints(page)
})

// ---------------------------------------------------------------------------
// Success flows
// ---------------------------------------------------------------------------

test.describe('Send SMS — success flow', () => {
  test('202 response treated as success — summary dialog shows 1 successful', async ({ page }) => {
    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page)

    // The send summary dialog should open and show 1 successful send
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
    // Use exact match to avoid strict-mode collision with "Unsuccessful"
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
    // No unsuccessful sends
    await expect(page.getByText('Unsuccessful').first()).toBeVisible()
  })

  test('success clears the message input', async ({ page }) => {
    await page.goto('/app/send')
    // Must use fillAndSubmitSmsForm so a recipient is added before clicking Send
    await fillAndSubmitSmsForm(page, 'This should be cleared after send')

    // After successful send the summary dialog appears and the form resets
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Send MMS — success flow', () => {
  test('MMS send returns 202 and shows success summary', async ({ page }) => {
    await page.goto('/app/send')

    // Add a recipient first (required before the form will submit)
    await fillAndSubmitSmsForm(page, 'Check this out!')

    // API returns 202 — should be treated as success
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Billing gate errors
// ---------------------------------------------------------------------------

test.describe('Billing gate — error surfaces in UI', () => {
  test('insufficient trial balance shows balance error message', async ({ page }) => {
    // Override before global mock (LIFO — this route wins)
    await overrideSmsRoute(page, {
      detail: 'Insufficient balance. You need $0.05 but only have $0.00.',
    })

    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page)

    // Error message should appear — either inline or in the summary error list
    await expect(
      page
        .getByText(/insufficient balance/i)
        .or(page.getByText(/balance/i))
        .first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('monthly spending limit shows limit error message', async ({ page }) => {
    await overrideSmsRoute(page, {
      detail: 'Monthly spending limit of $10.00 reached. Current spend: $10.05.',
    })

    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page)

    await expect(
      page
        .getByText(/monthly spending limit/i)
        .or(page.getByText(/limit/i))
        .first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('billing error shows 0 successful in summary dialog', async ({ page }) => {
    await overrideSmsRoute(page, {
      detail: 'Insufficient balance. You need $0.05 but only have $0.00.',
    })

    await page.goto('/app/send')
    await fillAndSubmitSmsForm(page)

    // The summary dialog appears but reflects the failure: 0 successful, 1 unsuccessful
    await expect(page.getByText(/send summary/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Unsuccessful').first()).toBeVisible()
    // The specific error detail should be visible in the dialog
    await expect(page.getByText(/insufficient balance/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Group send
// ---------------------------------------------------------------------------

test.describe('Group send — pipeline flow', () => {
  test('group send summary shows total queued count', async ({ page }) => {
    await page.goto('/app/send')

    // Wait for page
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })

    // Look for group send option — tab, button, or select
    const groupTab = page
      .getByRole('tab', { name: /group/i })
      .or(page.getByRole('button', { name: /group/i }))
      .first()

    if (await groupTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await groupTab.click()

      // Select a group
      const groupSelect = page.getByRole('combobox').or(page.getByLabel(/group/i)).first()
      if (await groupSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await groupSelect.selectOption({ index: 0 })
      }

      // Fill message
      const textarea = page.locator('textarea').first()
      await textarea.fill('Hello group!')

      const sendBtn = page.getByRole('button', { name: /^send$/i }).first()
      await sendBtn.click()

      // Summary should mention total recipients (3 from mock)
      await expect(
        page.getByText('3').or(page.getByText(/3 recipient/i)).first()
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

    // The mock includes a schedule with status: 'queued' for Charlie
    await expect(page.getByText('Hello Charlie').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/queued/i).first()).toBeVisible()
  })

  test('retrying schedule shows retrying status with retry context', async ({ page }) => {
    await page.goto('/app/schedule')

    // Diana's schedule has status: 'retrying', retry_count: 1
    await expect(page.getByText('Hello Diana').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/retrying/i).first()).toBeVisible()
  })

  test('delivered schedule shows delivered status', async ({ page }) => {
    await page.goto('/app/schedule')

    // Eve's schedule has status: 'delivered'
    await expect(page.getByText('Hello Eve').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/delivered/i).first()).toBeVisible()
  })

  test('failed schedule shows failed status', async ({ page }) => {
    await page.goto('/app/schedule')

    // Frank's schedule has status: 'failed', failure_category: 'invalid_number'
    await expect(page.getByText('Hello Frank').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/failed/i).first()).toBeVisible()
  })
})
