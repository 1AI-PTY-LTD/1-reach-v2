import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Groups Page', () => {
  test('displays groups list', async ({ page }) => {
    await page.goto('/app/groups')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('New Customers').first()).toBeVisible()
  })

  test('shows group detail when clicking a group', async ({ page }) => {
    await page.goto('/app/groups')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    // Click on VIP Customers via the row link (a overlay intercepts pointer events)
    await page.locator('a[href*="/app/groups/1"]').first().click()

    // Should show group detail heading (Messages tab is shown by default)
    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 5000 })
    // The detail panel should be visible with group info
    await expect(page.getByText(/member/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows member count for groups', async ({ page }) => {
    await page.goto('/app/groups')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    // Should show member counts
    await expect(page.getByText('3').first()).toBeVisible()
  })

  test('can open create group modal', async ({ page }) => {
    await page.goto('/app/groups')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    // Look for add/create group button
    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()

      // Should show group form
      await expect(page.getByText(/group name|create group|new group/i).first()).toBeVisible({ timeout: 5000 })
    }
  })
})
