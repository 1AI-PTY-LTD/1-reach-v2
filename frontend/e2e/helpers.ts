import { type Page } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'

/**
 * Set up Clerk authentication for E2E tests.
 *
 * Uses a sign-in token from the Backend API to authenticate
 * programmatically (bypasses MFA/email verification).
 *
 * Required environment variables:
 * - CLERK_SECRET_KEY: Clerk secret key (sk_test_...)
 * - E2E_CLERK_USER_ID: Test user ID (user_...)
 */
export async function authenticatePage(page: Page) {
  // Set up Clerk testing token (disables CAPTCHAs and rate limits)
  await setupClerkTestingToken({ page })

  const secretKey = process.env.CLERK_SECRET_KEY
  const userId = process.env.E2E_CLERK_USER_ID

  if (!secretKey || !userId) {
    return
  }

  // Create a sign-in token via the Clerk Backend API
  const response = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  })
  const tokenData = await response.json()
  const ticket = tokenData.token

  // Navigate to the app root so Clerk SDK initializes
  await page.goto('/')

  // Wait for Clerk to fully load
  await page.waitForFunction(
    () => (window as any).Clerk?.loaded === true,
    { timeout: 15000 }
  )

  // Sign in using the ticket
  await page.evaluate(async (ticket: string) => {
    const clerk = (window as any).Clerk
    if (!clerk) throw new Error('Clerk not loaded')

    const result = await clerk.client.signIn.create({
      strategy: 'ticket',
      ticket,
    })

    if (result.status === 'complete') {
      await clerk.setActive({ session: result.createdSessionId })
    } else {
      throw new Error(`Sign-in incomplete: ${result.status}`)
    }
  }, ticket)

  // Wait for auth state to propagate
  await page.waitForFunction(
    () => {
      const clerk = (window as any).Clerk
      return clerk?.user?.id != null
    },
    { timeout: 10000 }
  )
}

/**
 * Mock all backend API endpoints with realistic test data.
 * This intercepts requests to the backend API and returns mock data,
 * allowing E2E tests to run without a real backend.
 */
export async function mockApiEndpoints(page: Page) {
  const BASE = 'http://localhost:8000'

  // Contacts list
  await page.route(`${BASE}/api/contacts/?**`, (route) => {
    const method = route.request().method()

    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 100, first_name: 'New', last_name: 'Contact', phone: '0499999999',
          email: '', company: '', is_active: true, opt_out: false,
        }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111', email: 'alice@example.com', company: 'Test Corp', is_active: true, opt_out: false },
          { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222', email: 'bob@example.com', company: 'Test Corp', is_active: true, opt_out: false },
          { id: 3, first_name: 'Charlie', last_name: 'Brown', phone: '0412333333', email: 'charlie@example.com', company: 'Test Corp', is_active: true, opt_out: false },
        ],
        pagination: { total: 3, page: 1, limit: 1000, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Contact by ID
  await page.route(new RegExp(`${escapeRegex(BASE)}/api/contacts/\\d+/`), (route) => {
    const method = route.request().method()
    const url = route.request().url()
    const idMatch = url.match(/\/contacts\/(\d+)\//)
    const id = idMatch ? Number(idMatch[1]) : 1

    if (method === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id, first_name: 'Alice', last_name: 'Updated', phone: '0412111111',
          email: 'alice@example.com', company: 'Test Corp', is_active: true, opt_out: false,
        }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id, first_name: 'Alice', last_name: 'Smith', phone: '0412111111',
        email: 'alice@example.com', company: 'Test Corp', is_active: true, opt_out: false,
      }),
    })
  })

  // Contact schedules
  await page.route(new RegExp(`${escapeRegex(BASE)}/api/contacts/\\d+/schedules/`), (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Contact import
  await page.route(`${BASE}/api/contacts/import/`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', message: 'Contacts imported', filename: 'contacts.csv' }),
    })
  })

  // Templates
  await page.route(`${BASE}/api/templates/**`, (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 100, name: 'New Template', text: 'New template text', is_active: true, version: 1 }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, name: 'Welcome', text: 'Welcome to our service!', is_active: true, version: 1 },
          { id: 2, name: 'Reminder', text: 'This is a friendly reminder.', is_active: true, version: 1 },
        ],
        pagination: { total: 2, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Schedules
  await page.route(`${BASE}/api/schedules/**`, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 1, text: 'Hello Alice', phone: '0412111111', status: 'pending', format: 'SMS',
            message_parts: 1, scheduled_time: new Date(Date.now() + 3600000).toISOString(),
            contact: 1, contact_detail: { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' },
          },
          {
            id: 2, text: 'Hello Bob', phone: '0412222222', status: 'sent', format: 'SMS',
            message_parts: 1, scheduled_time: new Date(Date.now() - 3600000).toISOString(),
            contact: 2, contact_detail: { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' },
          },
        ],
        pagination: { total: 2, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Groups list
  await page.route(`${BASE}/api/groups/?**`, (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 100, name: 'New Group', description: '', member_count: 0, is_active: true }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, name: 'VIP Customers', description: 'Our VIP customers', member_count: 3, is_active: true },
          { id: 2, name: 'New Customers', description: 'Newly added', member_count: 2, is_active: true },
        ],
        pagination: { total: 2, page: 1, limit: 1000, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Group by ID
  await page.route(new RegExp(`${escapeRegex(BASE)}/api/groups/\\d+/`), (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1, name: 'VIP Customers', description: 'Our VIP customers', member_count: 3, is_active: true,
        members: [
          { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' },
          { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' },
        ],
        pagination: { total: 2, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  // Group schedules
  await page.route(`${BASE}/api/group-schedules/**`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0, hasNext: false, hasPrev: false },
      }),
    })
  })

  // SMS
  await page.route(`${BASE}/api/sms/**`, (route) => {
    const url = route.request().url()
    if (url.includes('send-to-group')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true, message: 'SMS sent to group',
          results: { successful: 3, failed: 0, total: 3 },
          group_name: 'VIP Customers', group_schedule_id: 1,
        }),
      })
    }
    if (url.includes('send-mms')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'MMS sent successfully' }),
      })
    }
    if (url.includes('upload-file')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, url: 'https://storage.example.com/image.jpg', file_id: 'file_123', size: 12345 }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'SMS sent successfully' }),
    })
  })

  // Stats
  await page.route(`${BASE}/api/stats/**`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        monthly_stats: [
          { month: 'January 2026', sms_sent: 150, sms_message_parts: 200, mms_sent: 10, pending: 5, errored: 2 },
          { month: 'February 2026', sms_sent: 180, sms_message_parts: 250, mms_sent: 15, pending: 3, errored: 1 },
        ],
        sms_limit: 1000,
        mms_limit: 100,
      }),
    })
  })
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
