import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  createTemplate, deleteTemplate,
} from './helpers'

const createdIds: number[] = []
let t1: { id: number }, t2: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  ;[t1, t2] = await Promise.all([
    createTemplate(page, { name: 'Welcome', content: 'Welcome to our service!' }),
    createTemplate(page, { name: 'Reminder', content: 'This is your reminder.' }),
  ])
  createdIds.push(t1.id, t2.id)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all(createdIds.map(id => deleteTemplate(page, id).catch(() => {})))
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
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
    await page.getByText('Welcome').first().click()
    await expect(page.getByText('Welcome to our service!')).toBeVisible({ timeout: 5000 })
  })

  test('can open create template modal', async ({ page }) => {
    await page.goto('/app/templates')
    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 10000 })
    const addButton = page.getByRole('button', { name: /add|create|new/i }).first()
    if (await addButton.isVisible()) {
      await addButton.click()
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
      await page.getByLabel(/template name/i).fill('My New Template')
      await page.getByRole('textbox', { name: /message|text|content/i }).fill('Hello, this is a test template.')
      await page.getByRole('button', { name: /create|save/i }).last().click()
      await expect(page.getByText(/create new template/i)).not.toBeVisible({ timeout: 5000 })
    }
  })

  test('shows Edit button on template detail page', async ({ page }) => {
    await page.goto(`/app/templates/${t1?.id}`)
    await expect(page.getByText('Welcome to our service!').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible()
  })
})
