import { test, expect } from '@playwright/test'
import {
  authenticatePage,
  deleteContact, deleteTemplate,
  ensureContact, ensureTemplate,
} from './helpers'

let contact: { id: number }
let t1: { id: number }, t2: { id: number }

test.beforeAll(async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY) return
  const page = await browser.newPage()
  await authenticatePage(page)
  ;[contact, t1, t2] = await Promise.all([
    ensureContact(page, { first_name: 'Alice', last_name: 'Smith', phone: '0415111111' }),
    ensureTemplate(page, { name: 'SMS Welcome', text: 'Welcome to our service!' }),
    ensureTemplate(page, { name: 'SMS Reminder', text: 'This is your reminder.' }),
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
      await expect(page.getByText('SMS Welcome').first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('send button is present', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').or(page.getByPlaceholder(/message/i)).first()).toBeVisible({ timeout: 10000 })
    const sendButton = page.getByRole('button', { name: /send/i }).first()
    await expect(sendButton).toBeVisible()
  })

  test('shows error when submitting with empty message', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
    // Add a recipient so the only error is the empty message
    const recipientInput = page.getByPlaceholder(/phone|name|list/i).first()
    await recipientInput.fill('0499888777')
    await recipientInput.press('Enter')
    // Submit with no message
    await page.getByRole('button', { name: /send/i }).first().click()
    await expect(page.getByText(/Please select a template or enter a custom message/i)).toBeVisible({ timeout: 5000 })
  })

  test('shows recipients count', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
    // Initially 0 recipients
    await expect(page.getByText('Recipients: 0')).toBeVisible()
  })

  test('selecting a template populates the message textarea', async ({ page }) => {
    await page.goto('/app/send')
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
    // Select 'SMS Welcome' template from the dropdown
    const select = page.locator('select').first()
    await select.selectOption({ label: 'SMS Welcome' })
    // Textarea should be populated with the template text
    await expect(page.locator('textarea').first()).toHaveValue('Welcome to our service!')
  })
})
