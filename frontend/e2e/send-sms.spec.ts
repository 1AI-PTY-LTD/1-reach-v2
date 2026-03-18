import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  createContact, deleteContact,
  createTemplate, deleteTemplate,
} from './helpers'

let contact: { id: number }
let t1: { id: number }, t2: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  ;[contact, t1, t2] = await Promise.all([
    createContact(page, { first_name: 'Alice', last_name: 'Smith', phone: '0415111111' }),
    createTemplate(page, { name: 'Welcome', content: 'Welcome to our service!' }),
    createTemplate(page, { name: 'Reminder', content: 'This is your reminder.' }),
  ])
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  await Promise.all([
    contact?.id && deleteContact(page, contact.id).catch(() => {}),
    t1?.id && deleteTemplate(page, t1.id).catch(() => {}),
    t2?.id && deleteTemplate(page, t2.id).catch(() => {}),
  ])
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await authenticatePage(page)
})

test.describe('Send SMS Page', () => {
  test('displays the send page with message form', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.getByPlaceholder(/message|type/i).or(page.locator('textarea')).first()).toBeVisible({ timeout: 10000 })
  })

  test('can search for contacts to add as recipients', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })
    const recipientInput = page.getByPlaceholder(/search|recipient|phone|contact/i).first()
    if (await recipientInput.isVisible()) {
      await recipientInput.fill('Alice')
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
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })
    const templateSelect = page.getByText(/template/i).first()
    if (await templateSelect.isVisible()) {
      await templateSelect.click()
      await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('send button is present', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })
    const sendButton = page.getByRole('button', { name: /send/i }).first()
    await expect(sendButton).toBeVisible()
  })
})
