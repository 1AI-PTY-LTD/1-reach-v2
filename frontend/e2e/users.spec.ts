import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Users Page', () => {
  test('displays users table after loading', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('member@example.com')).toBeVisible()
    await expect(page.getByText('inactive@example.com')).toBeVisible()
  })

  test('shows table headers', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Organisation' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
  })

  test('shows role and status badges', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    // Role badges
    await expect(page.getByText('Admin').first()).toBeVisible()
    await expect(page.getByText('Member').first()).toBeVisible()

    // Status badges
    await expect(page.getByText('Active').first()).toBeVisible()
    await expect(page.getByText('Inactive').first()).toBeVisible()
  })

  test('shows Invite User button', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Invite User' })).toBeVisible()
  })

  test('shows action buttons for non-self users', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    // Should have Make Admin buttons for member users
    await expect(page.getByRole('button', { name: 'Make Admin' }).first()).toBeVisible()

    // Should have Deactivate for active member
    await expect(page.getByRole('button', { name: 'Deactivate' }).first()).toBeVisible()

    // Should have Re-invite for inactive user
    await expect(page.getByRole('button', { name: 'Re-invite' })).toBeVisible()
  })

  test('can open invite user dialog', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'Invite User' }).click()

    // Dialog should appear with email input
    await expect(page.getByText('Invite User', { exact: false }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send Invite' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('can submit invite user form', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible({ timeout: 5000 })

    await page.getByPlaceholder('user@example.com').fill('new@example.com')
    await page.getByRole('button', { name: 'Send Invite' }).click()

    // Dialog should close after successful submission
    await expect(page.getByPlaceholder('user@example.com')).not.toBeVisible({ timeout: 5000 })
  })

  test('can close invite dialog with cancel', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByPlaceholder('user@example.com')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByPlaceholder('user@example.com')).not.toBeVisible({ timeout: 5000 })
  })

  test('Make Admin button triggers role update without error', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    // Click "Make Admin" for the member user
    await page.getByRole('button', { name: 'Make Admin' }).first().click()

    // Should not show an error message
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })

  test('Deactivate button triggers status update without error', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    // Click "Deactivate" for an active member
    await page.getByRole('button', { name: 'Deactivate' }).first().click()

    // Should not show an error message
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })

  test('Re-invite button triggers re-invitation without error', async ({ page }) => {
    await page.goto('/app/users')

    await expect(page.getByText('admin@example.com')).toBeVisible({ timeout: 10000 })

    // Click "Re-invite" for the inactive user
    await page.getByRole('button', { name: 'Re-invite' }).click()

    // Should not show an error message
    await expect(page.getByText(/failed|error/i)).not.toBeVisible({ timeout: 3000 })
  })
})
