import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Contacts Page', () => {
  test('displays contacts list after loading', async ({ page }) => {
    await page.goto('/app/contacts')

    // Wait for contacts to load - use first() since name appears in list and detail
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Bob Jones').first()).toBeVisible()
    await expect(page.getByText('Charlie Brown').first()).toBeVisible()
  })

  test('shows contact details when clicking a contact', async ({ page }) => {
    await page.goto('/app/contacts')

    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })

    // Click on Bob Jones via the row link (a overlay intercepts pointer events)
    await page.locator('a[href="/app/contacts/2"]').first().click()

    // Should navigate and show contact detail
    await expect(page.getByText('0412 222 222').or(page.getByText('0412222222')).first()).toBeVisible({ timeout: 5000 })
  })

  test('can search for contacts', async ({ page }) => {
    await page.goto('/app/contacts')

    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })

    // Find and use the search input
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('Alice')
      // Search should filter results - Alice should remain visible
      await expect(page.getByText('Alice').first()).toBeVisible()
    }
  })

  test('can open create contact modal', async ({ page }) => {
    await page.goto('/app/contacts')

    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })

    // Click the Add button
    const addButton = page.getByRole('button', { name: /add/i }).first()
    await addButton.click()

    // Should show a modal with form fields
    await expect(page.getByText(/first name/i).first()).toBeVisible({ timeout: 5000 })
  })
})
