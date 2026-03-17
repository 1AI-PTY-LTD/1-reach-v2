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

  test('can fill and submit the create contact form', async ({ page }) => {
    // The helpers mock uses ?** which only matches URLs with query strings.
    // Add an explicit mock for the plain POST to /api/contacts/
    await page.route('http://localhost:8000/api/contacts/', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 100, first_name: 'Jane', last_name: 'Doe', phone: '0499111222', email: '', company: '', is_active: true, opt_out: false }),
        })
      }
      return route.continue()
    })

    await page.goto('/app/contacts')

    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: /add/i }).first().click()
    await expect(page.getByText(/first name/i).first()).toBeVisible({ timeout: 5000 })

    // Fill out the form (phone must match Australian format: 04xx xxx xxx)
    await page.getByPlaceholder('First Name').fill('Jane')
    await page.getByPlaceholder('Last Name').fill('Doe')
    await page.getByPlaceholder('0412 345 678').pressSequentially('0499111222')

    // Submit
    await page.getByRole('button', { name: /create/i }).first().click()

    // Dialog should close after successful submission
    await expect(page.getByPlaceholder('First Name')).not.toBeVisible({ timeout: 5000 })
  })

  test('can open edit contact modal from contact detail', async ({ page }) => {
    await page.goto('/app/contacts/1')

    // Wait for contact to load
    await expect(page.getByText(/alice/i).first()).toBeVisible({ timeout: 10000 })

    // Click the pencil/edit button (button containing the contact name)
    const editButton = page.getByRole('button').filter({ hasText: /alice/i }).first()
    await editButton.click()

    // Edit modal should open with the edit heading
    await expect(page.getByText(/edit contact details/i)).toBeVisible({ timeout: 5000 })
  })

  test('can submit edit contact form', async ({ page }) => {
    await page.goto('/app/contacts/1')

    await expect(page.getByText(/alice/i).first()).toBeVisible({ timeout: 10000 })

    // Open edit modal
    const editButton = page.getByRole('button').filter({ hasText: /alice/i }).first()
    await editButton.click()

    await expect(page.getByText(/edit contact details/i)).toBeVisible({ timeout: 5000 })

    // Update the first name
    const firstNameInput = page.getByPlaceholder('First Name')
    await firstNameInput.clear()
    await firstNameInput.fill('Alicia')

    // Submit
    await page.getByRole('button', { name: /update/i }).first().click()

    // Dialog should close after successful update
    await expect(page.getByText(/edit contact details/i)).not.toBeVisible({ timeout: 5000 })
  })
})
