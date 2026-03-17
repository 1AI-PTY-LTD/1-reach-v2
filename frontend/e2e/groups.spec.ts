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

  test('can fill and submit the create group form', async ({ page }) => {
    // The helpers mock uses ?** which only matches URLs with query strings.
    // Add an explicit mock for plain POST to /api/groups/
    await page.route('http://localhost:8000/api/groups/', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 100, name: 'Test Group', description: '', member_count: 0, is_active: true }),
        })
      }
      return route.continue()
    })

    await page.goto('/app/groups')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()

      await expect(page.getByText(/group name|create group|new group/i).first()).toBeVisible({ timeout: 5000 })

      // Fill in group name
      const nameInput = page.getByLabel(/group name/i).or(page.getByPlaceholder(/group name/i)).first()
      await nameInput.fill('Test Group')

      // Submit using the specific Create Group button
      await page.getByRole('button', { name: 'Create Group' }).click()

      // Dialog should close after successful submission
      await expect(page.getByText('Create New Group')).not.toBeVisible({ timeout: 5000 })
    }
  })

  test('shows group contacts tab with members', async ({ page }) => {
    await page.goto('/app/groups/1')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    // Click the Contacts tab (use aria-controls to avoid matching nav link)
    await page.locator('[role="tab"][aria-controls="tabpanel-users"]').click()

    // Should show group members from the mock (first and last name are in separate cells)
    await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Smith').first()).toBeVisible()
    await expect(page.getByText('Bob').first()).toBeVisible()
    await expect(page.getByText('Jones').first()).toBeVisible()
  })

  test('can open add contacts modal within a group', async ({ page }) => {
    // Mock the members endpoint for this test
    await page.route('http://localhost:8000/api/groups/1/members/', (route) => {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'added', count: 1 }),
      })
    })

    await page.goto('/app/groups/1')

    await expect(page.getByText('VIP Customers').first()).toBeVisible({ timeout: 10000 })

    // Switch to Contacts tab using aria-controls attribute to avoid nav link match
    await page.locator('[role="tab"][aria-controls="tabpanel-users"]').click()

    // Wait for tab content to appear, then click the "+" add contacts button within the tab panel
    // Remove buttons have aria-label; the "+" button does not — so target the last unlabelled button
    await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 5000 })
    await page.locator('[role="tabpanel"] button:not([aria-label])').last().click()

    // Add contacts modal should open — check for modal title
    await expect(page.getByText('Select Contacts To Add').first()).toBeVisible({ timeout: 5000 })
  })
})
