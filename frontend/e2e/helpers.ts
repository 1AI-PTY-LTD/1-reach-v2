import { type Page } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import fs from 'fs'

/**
 * Set up Clerk authentication for E2E tests.
 *
 * Pass an explicit userId to sign in as a specific user (e.g. a spec-owned
 * admin user). Without it, falls back to the global E2E user from the state
 * file written by global-setup.ts, then to the E2E_CLERK_USER_ID env var.
 *
 * Without CLERK_SECRET_KEY (e.g. local dev), auth is skipped entirely.
 */
export async function authenticatePage(page: Page, userId?: string) {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return

  // Explicit userId wins; fall back to state file then env var
  let effectiveUserId = userId
  if (!effectiveUserId) {
    effectiveUserId = process.env.E2E_CLERK_USER_ID
    const stateFile = '/tmp/e2e-state.json'
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      effectiveUserId = state.clerkUserId ?? effectiveUserId
    }
  }
  if (!effectiveUserId) return

  await setupClerkTestingToken({ page })

  // Create a one-time sign-in token via the Clerk Backend API
  const response = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: effectiveUserId }),
  })
  const ticket = (await response.json()).token

  await page.goto('/')
  await page.waitForFunction(
    () => (window as any).Clerk?.loaded === true,
    { timeout: 15000 }
  )

  await page.evaluate(async (ticket: string) => {
    const clerk = (window as any).Clerk
    if (!clerk) throw new Error('Clerk not loaded')
    const result = await clerk.client.signIn.create({ strategy: 'ticket', ticket })
    if (result.status === 'complete') {
      await clerk.setActive({ session: result.createdSessionId })
    } else {
      throw new Error(`Sign-in incomplete: ${result.status}`)
    }
  }, ticket)

  await page.waitForFunction(
    () => (window as any).Clerk?.user?.id != null,
    { timeout: 10000 }
  )
}

// ---------------------------------------------------------------------------
// Authenticated API helpers — use the Clerk session token from the page
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:8000'

export async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clerk = (window as any).Clerk
    if (!clerk?.session) throw new Error('No Clerk session')
    return clerk.session.getToken() as Promise<string>
  })
}

export async function apiRequest(
  page: Page,
  method: string,
  path: string,
  data?: object,
): Promise<any> {
  const token = await getAuthToken(page)
  const res = await page.request.fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Typed CRUD helpers
export const createContact  = (p: Page, d: object) => apiRequest(p, 'POST', '/api/contacts/', d)
export const deleteContact  = (p: Page, id: number) => apiRequest(p, 'DELETE', `/api/contacts/${id}/`)
export const createGroup    = (p: Page, d: object) => apiRequest(p, 'POST', '/api/groups/', d)
export const addMembers     = (p: Page, id: number, ids: number[]) =>
  apiRequest(p, 'POST', `/api/groups/${id}/members/`, { contact_ids: ids })
export const deleteGroup    = (p: Page, id: number) => apiRequest(p, 'DELETE', `/api/groups/${id}/`)
export const createTemplate = (p: Page, d: object) => apiRequest(p, 'POST', '/api/templates/', d)
export const deleteTemplate = (p: Page, id: number) => apiRequest(p, 'DELETE', `/api/templates/${id}/`)
export const forceStatus    = (p: Page, id: number, s: string) =>
  apiRequest(p, 'PATCH', `/api/schedules/${id}/force-status/`, { status: s })
export const deleteSchedule = (p: Page, id: number) => apiRequest(p, 'DELETE', `/api/schedules/${id}/`)
export const createConfig   = (p: Page, d: object) => apiRequest(p, 'POST', '/api/configs/', d)
export const deleteConfig   = (p: Page, id: number) => apiRequest(p, 'DELETE', `/api/configs/${id}/`)
export const setOrgBalance  = (p: Page, balance: number) =>
  apiRequest(p, 'PATCH', '/api/billing/test-set-balance/', { balance })
