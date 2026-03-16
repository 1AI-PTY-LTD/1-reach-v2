import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createBillingSummary, createCreditTransaction } from '../../test/factories'
import { Suspense } from 'react'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
}))

// Use vi.hoisted so mockUseOrganization is available inside vi.mock (which is hoisted)
const { mockUseOrganization } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn().mockReturnValue({ membership: { role: 'org:admin' }, isLoaded: true }),
}))

// Override Clerk mock to include admin membership with mutable useOrganization
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue('mock-token'),
    isSignedIn: true,
    isLoaded: true,
    userId: 'user_test123',
    orgId: 'org_test123',
  }),
  useUser: () => ({
    user: { id: 'user_test123', firstName: 'Test', lastName: 'User' },
    isLoaded: true,
    isSignedIn: true,
  }),
  useOrganization: mockUseOrganization,
  useOrganizationList: () => ({
    organizationList: [{ organization: { id: 'org_test123', name: 'Test Org' } }],
    isLoaded: true,
    setActive: vi.fn(),
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  UserButton: () => null,
}))

import { useSuspenseQuery } from '@tanstack/react-query'
import { getBillingSummaryQueryOptions } from '../../api/billingApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import { useOrganization } from '@clerk/clerk-react'

function BillingContentTest() {
  const client = useApiClient()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === 'org:admin'
  const { data } = useSuspenseQuery(getBillingSummaryQueryOptions(client))

  if (!isAdmin) {
    return <div data-testid="access-denied">Access restricted to organisation admins.</div>
  }

  return (
    <div>
      <div data-testid="billing-mode">{data.billing_mode}</div>
      <div data-testid="balance">{data.balance}</div>
      <div data-testid="monthly-spend">{data.total_monthly_spend}</div>
      <div data-testid="monthly-limit">{data.monthly_limit ?? 'no-limit'}</div>
      {Object.entries(data.monthly_usage_by_format).map(([fmt, info]) => (
        <div key={fmt} data-testid={`format-${fmt}`}>
          {fmt}: ${info.spend} @ ${info.rate}
        </div>
      ))}
      <div data-testid="tx-count">{data.pagination.total}</div>
      {data.results.map((tx) => (
        <div key={tx.id} data-testid={`tx-${tx.id}`}>
          {tx.transaction_type}: ${tx.amount}
        </div>
      ))}
    </div>
  )
}

function BillingWithSuspense() {
  return (
    <Suspense fallback={<div>Loading billing...</div>}>
      <BillingContentTest />
    </Suspense>
  )
}

describe('BillingLayout', () => {
  // Default to admin for all tests
  afterEach(() => {
    mockUseOrganization.mockReturnValue({ membership: { role: 'org:admin' }, isLoaded: true })
  })

  beforeEach(() => {
    mockUseOrganization.mockReturnValue({ membership: { role: 'org:admin' }, isLoaded: true })
  })

  it('shows loading state via Suspense fallback', () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return HttpResponse.json(createBillingSummary())
      })
    )

    renderWithProviders(<BillingWithSuspense />)
    expect(screen.getByText('Loading billing...')).toBeInTheDocument()
  })

  it('renders trial billing mode', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', () =>
        HttpResponse.json(createBillingSummary({ billing_mode: 'trial', balance: '8.50' }))
      )
    )

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('billing-mode')).toHaveTextContent('trial')
    })
    expect(screen.getByTestId('balance')).toHaveTextContent('8.50')
  })

  it('renders subscribed billing mode', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', () =>
        HttpResponse.json(createBillingSummary({ billing_mode: 'subscribed' }))
      )
    )

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('billing-mode')).toHaveTextContent('subscribed')
    })
  })

  it('displays monthly spend', async () => {
    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('monthly-spend')).toHaveTextContent('1.50')
    })
  })

  it('displays monthly limit when set', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', () =>
        HttpResponse.json(createBillingSummary({ monthly_limit: '25.00' }))
      )
    )

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('monthly-limit')).toHaveTextContent('25.00')
    })
  })

  it('shows no-limit when monthly_limit is null', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', () =>
        HttpResponse.json(createBillingSummary({ monthly_limit: null }))
      )
    )

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('monthly-limit')).toHaveTextContent('no-limit')
    })
  })

  it('renders per-format usage', async () => {
    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('format-sms')).toHaveTextContent('sms: $1.00 @ $0.05')
    })
    expect(screen.getByTestId('format-mms')).toHaveTextContent('mms: $0.50 @ $0.20')
  })

  it('renders transaction history', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/summary/', () =>
        HttpResponse.json(
          createBillingSummary({
            results: [
              createCreditTransaction({ id: 1, transaction_type: 'grant', amount: '10.00' }),
              createCreditTransaction({ id: 2, transaction_type: 'deduct', amount: '0.05', format: 'sms' }),
            ],
            pagination: { total: 2, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
          })
        )
      )
    )

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('tx-1')).toHaveTextContent('grant: $10.00')
    })
    expect(screen.getByTestId('tx-2')).toHaveTextContent('deduct: $0.05')
    expect(screen.getByTestId('tx-count')).toHaveTextContent('2')
  })

  it('shows access denied for non-admin', async () => {
    mockUseOrganization.mockReturnValue({ membership: { role: 'org:member' }, isLoaded: true })

    renderWithProviders(<BillingWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('access-denied')).toBeInTheDocument()
    })
  })
})
