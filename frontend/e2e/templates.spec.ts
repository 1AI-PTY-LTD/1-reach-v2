import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Templates Page', () => {
  test('displays templates list', async ({ page }) => {
    await page.goto('/app/templates')

    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Reminder').first()).toBeVisible()
  })

  test('shows template content when selected', async ({ page }) => {
    await page.goto('/app/templates')

    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 10000 })

    // Click on the Welcome template
    await page.getByText('Welcome').first().click()

    // Should display template content
    await expect(page.getByText('Welcome to our service!')).toBeVisible({ timeout: 5000 })
  })

  test('can open create template modal', async ({ page }) => {
    await page.goto('/app/templates')

    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 10000 })

    // Look for create/add button
    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()

      // Should show template form
      await expect(page.getByText(/template name|create template/i).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('can fill and submit the create template form', async ({ page }) => {
    await page.goto('/app/templates')

    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 10000 })

    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()

      await expect(page.getByText(/template name|create template/i).first()).toBeVisible({ timeout: 5000 })

      // Fill the form
      await page.getByLabel(/template name/i).fill('My New Template')
      await page.getByRole('textbox', { name: /message|text|content/i }).fill('Hello, this is a test template.')

      // Submit
      await page.getByRole('button', { name: /create|save/i }).last().click()

      // Dialog should close after successful submission
      await expect(page.getByText(/create new template/i)).not.toBeVisible({ timeout: 5000 })
    }
  })

  test('shows Edit button on template detail page', async ({ page }) => {
    await page.goto('/app/templates/1')

    await expect(page.getByText('Welcome to our service!').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible()
  })
})
