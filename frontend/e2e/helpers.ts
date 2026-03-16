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
  const secretKey = process.env.CLERK_SECRET_KEY
  const userId = process.env.E2E_CLERK_USER_ID

  // Without Clerk credentials (e.g. local dev), skip auth entirely.
  // Tests still exercise UI behaviour via mocked API routes.
  if (!secretKey || !userId) {
    return
  }

  // Set up Clerk testing token (disables CAPTCHAs and rate limits)
  await setupClerkTestingToken({ page })

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

  // Schedules — includes all statuses introduced by the async send pipeline
  await page.route(`${BASE}/api/schedules/**`, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 1, text: 'Hello Alice', phone: '0412111111', status: 'pending', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() + 3600000).toISOString(),
            contact: 1, contact_detail: { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' },
            retry_count: 0, max_retries: 3, failure_category: null, next_retry_at: null, delivered_time: null,
          },
          {
            id: 2, text: 'Hello Bob', phone: '0412222222', status: 'sent', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() - 3600000).toISOString(),
            contact: 2, contact_detail: { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' },
            retry_count: 0, max_retries: 3, failure_category: null, next_retry_at: null, delivered_time: null,
          },
          {
            id: 3, text: 'Hello Charlie', phone: '0412333333', status: 'queued', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() - 60000).toISOString(),
            contact: 3, contact_detail: { id: 3, first_name: 'Charlie', last_name: 'Brown', phone: '0412333333' },
            retry_count: 0, max_retries: 3, failure_category: null, next_retry_at: null, delivered_time: null,
          },
          {
            id: 4, text: 'Hello Diana', phone: '0412444444', status: 'retrying', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() - 120000).toISOString(),
            contact: 4, contact_detail: { id: 4, first_name: 'Diana', last_name: 'Prince', phone: '0412444444' },
            retry_count: 1, max_retries: 3, failure_category: 'server_error',
            next_retry_at: new Date(Date.now() + 60000).toISOString(), delivered_time: null,
          },
          {
            id: 5, text: 'Hello Eve', phone: '0412555555', status: 'delivered', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() - 7200000).toISOString(),
            contact: 5, contact_detail: { id: 5, first_name: 'Eve', last_name: 'Adams', phone: '0412555555' },
            retry_count: 0, max_retries: 3, failure_category: null, next_retry_at: null,
            delivered_time: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: 6, text: 'Hello Frank', phone: '0412666666', status: 'failed', format: 'sms',
            message_parts: 1, scheduled_time: new Date(Date.now() - 3600000).toISOString(),
            contact: 6, contact_detail: { id: 6, first_name: 'Frank', last_name: 'Castle', phone: '0412666666' },
            retry_count: 3, max_retries: 3, failure_category: 'invalid_number', next_retry_at: null, delivered_time: null,
          },
        ],
        pagination: { total: 6, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
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

  // SMS — returns 202 Accepted with schedule_id (async dispatch pipeline)
  await page.route(`${BASE}/api/sms/**`, (route) => {
    const url = route.request().url()
    if (url.includes('send-to-group')) {
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true, message: 'SMS queued for 3 recipients',
          results: { successful: 0, failed: 0, total: 3 },
          group_name: 'VIP Customers', group_schedule_id: 1,
        }),
      })
    }
    if (url.includes('send-mms')) {
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Message queued for delivery', schedule_id: 2 }),
      })
    }
    if (url.includes('upload-file')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, url: 'https://storage.example.com/image.jpg', file_id: 'file_123', size: 12345 }),
      })
    }
    // /api/sms/send/
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Message queued for delivery', schedule_id: 1 }),
    })
  })

  // Billing summary
  await page.route(`${BASE}/api/billing/**`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        billing_mode: 'trial',
        balance: '10.00',
        monthly_spend: '0.25',
        monthly_limit: null,
        sms_usage: '0.05',
        mms_usage: '0.20',
        transactions: { results: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false } },
      }),
    })
  })

  // Users
  await page.route(`${BASE}/api/users/?**`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, first_name: 'Admin', last_name: 'User', email: 'admin@example.com', clerk_id: 'user_test123', role: 'org:admin', organisation: 'Test Org', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
          { id: 2, first_name: 'Member', last_name: 'User', email: 'member@example.com', clerk_id: 'user_member1', role: 'org:member', organisation: 'Test Org', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
          { id: 3, first_name: 'Inactive', last_name: 'User', email: 'inactive@example.com', clerk_id: 'user_inactive1', role: 'org:member', organisation: 'Test Org', is_active: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        ],
        pagination: { total: 3, page: 1, limit: 1000, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    })
  })

  await page.route(new RegExp(`${escapeRegex(BASE)}/api/users/\\d+/role/`), (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'updated', role: 'org:admin' }),
    })
  })

  await page.route(new RegExp(`${escapeRegex(BASE)}/api/users/\\d+/status/`), (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'deactivated', is_active: false }),
    })
  })

  await page.route(`${BASE}/api/users/invite/`, (route) => {
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'invitation_sent', email: 'new@example.com' }),
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
