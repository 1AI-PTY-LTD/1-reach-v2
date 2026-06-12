import { test, expect } from '@playwright/test'
import { authenticatePage, apiRequest, deleteContact } from './helpers'

/**
 * CSV import with validation errors (previously untested end-to-end): valid
 * rows import, invalid rows are reported, and the result summary is shown.
 */

// Unique per run so re-runs don't trip the duplicate-contact check
const SUFFIX = `${Math.floor(Math.random() * 90) + 10}`
const VALID_PHONE = `04149191${SUFFIX}`

const CSV = [
  'phone,first_name,last_name',
  `${VALID_PHONE},Csv,Valid`,
  'not-a-phone,Csv,Invalid',
].join('\n')

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  const found = await apiRequest(page, 'GET', `/api/contacts/?search=${VALID_PHONE}`)
  for (const c of found.results ?? []) {
    await deleteContact(page, c.id).catch(() => {})
  }
  await page.close()
})

test('csv import creates valid rows and reports invalid ones', async ({ page }) => {
  await page.goto('/app/contacts')

  await page.getByRole('button', { name: 'Add Contacts from file' }).click()

  await page.locator('input[type="file"]').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  })
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  // Partial import: 1 valid row created, 1 invalid row reported
  await expect(page.getByText('Upload Complete')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('1 imported, 1 failed')).toBeVisible()

  // The valid contact is actually in the org
  const found = await apiRequest(page, 'GET', `/api/contacts/?search=${VALID_PHONE}`)
  expect(found.results?.length).toBe(1)
})
