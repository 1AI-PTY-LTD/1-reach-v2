import { test, expect } from '@playwright/test'
import { authenticatePage, mockApiEndpoints } from './helpers'
import dayjs from 'dayjs'

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
  await mockApiEndpoints(page)
})

test.describe('Schedule Page', () => {
  test('displays schedule table with messages', async ({ page }) => {
    await page.goto('/app/schedule')

    // Wait for schedule data to load
    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Hello Bob').first()).toBeVisible()
  })

  test('shows current date', async ({ page }) => {
    await page.goto('/app/schedule')

    const today = dayjs().format('DD/MM/YYYY')
    await expect(page.getByText(today)).toBeVisible({ timeout: 10000 })
  })

  test('can navigate to previous day', async ({ page }) => {
    await page.goto('/app/schedule')

    const today = dayjs().format('DD/MM/YYYY')
    const dateHeading = page.getByRole('heading', { name: today })
    await expect(dateHeading).toBeVisible({ timeout: 10000 })

    // The prev day button is the sibling button before the date heading
    // It's an outline button with just a chevron SVG, located in main content
    const prevButton = page.locator('main button').first()
    await prevButton.click()

    const yesterday = dayjs().subtract(1, 'day').format('DD/MM/YYYY')
    await expect(page.getByRole('heading', { name: yesterday })).toBeVisible({ timeout: 5000 })
  })

  test('can navigate to next day', async ({ page }) => {
    await page.goto('/app/schedule')

    const today = dayjs().format('DD/MM/YYYY')
    const dateHeading = page.getByRole('heading', { name: today })
    await expect(dateHeading).toBeVisible({ timeout: 10000 })

    // The next day button is right after the heading - second button in the top row
    // Target the button that's a sibling of the heading within the date nav container
    const nextDayButton = dateHeading.locator('~ button').first()
    await nextDayButton.click({ timeout: 5000 })

    const tomorrow = dayjs().add(1, 'day').format('DD/MM/YYYY')
    await expect(page.getByRole('heading', { name: tomorrow })).toBeVisible({ timeout: 5000 })
  })

  test('shows message status badges', async ({ page }) => {
    await page.goto('/app/schedule')

    await expect(page.getByText('Hello Alice').first()).toBeVisible({ timeout: 10000 })

    // Should show status indicators
    await expect(page.getByText(/pending/i).first()).toBeVisible()
    await expect(page.getByText(/sent/i).first()).toBeVisible()
  })

  test('shows async pipeline status badges — queued, retrying, delivered, failed', async ({ page }) => {
    await page.goto('/app/schedule')

    await expect(page.getByText('Hello Charlie').first()).toBeVisible({ timeout: 10000 })

    // queued — dispatched to Celery, not yet processed
    await expect(page.getByText(/queued/i).first()).toBeVisible()

    // retrying — transient failure, pending retry
    await expect(page.getByText(/retrying/i).first()).toBeVisible()

    // delivered — carrier-confirmed delivery
    await expect(page.getByText(/delivered/i).first()).toBeVisible()

    // failed — terminal failure after retries exhausted
    await expect(page.getByText(/failed/i).first()).toBeVisible()
  })
})
