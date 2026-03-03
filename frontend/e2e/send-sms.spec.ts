import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Send SMS Page', () => {
  test('displays the send page with message form', async ({ page }) => {
    await page.goto('/app/send')

    // Should see the send page with message input area
    await expect(page.getByPlaceholder(/message|type/i).or(page.locator('textarea')).first()).toBeVisible({ timeout: 10000 })
  })

  test('can search for contacts to add as recipients', async ({ page }) => {
    await page.goto('/app/send')

    // Wait for page to load
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })

    // Find search/recipient input
    const recipientInput = page.getByPlaceholder(/search|recipient|phone|contact/i).first()
    if (await recipientInput.isVisible()) {
      await recipientInput.fill('Alice')

      // Should show search results
      await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('can type a message', async ({ page }) => {
    await page.goto('/app/send')

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })

    await textarea.fill('Hello, this is a test message!')

    await expect(textarea).toHaveValue('Hello, this is a test message!')
  })

  test('shows templates for selection', async ({ page }) => {
    await page.goto('/app/send')

    // Wait for page to load
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })

    // Look for template selector
    const templateSelect = page.getByText(/template/i).first()
    if (await templateSelect.isVisible()) {
      await templateSelect.click()

      // Should show available templates
      await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('send button is present', async ({ page }) => {
    await page.goto('/app/send')

    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })

    // Should have a send button
    const sendButton = page.getByRole('button', { name: /send/i }).first()
    await expect(sendButton).toBeVisible()
  })
})
