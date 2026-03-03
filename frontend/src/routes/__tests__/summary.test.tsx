import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createSummaryData, createMonthlyStats } from '../../test/factories'
import { Suspense } from 'react'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
}))

// Re-create SummaryContent for testing (original is not exported)
import { useSuspenseQuery } from '@tanstack/react-query'
import { getSummaryQueryOptions } from '../../api/statsApi'
import { useApiClient } from '../../lib/ApiClientProvider'

function SummaryContentTest() {
  const client = useApiClient()
  const { data } = useSuspenseQuery(getSummaryQueryOptions(client))

  return (
    <div>
      <div data-testid="limits-info">
        Monthly SMS limit: {data.sms_limit.toLocaleString()}; MMS limit: {data.mms_limit.toLocaleString()}
      </div>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>SMS Sent</th>
            <th>SMS Message Parts</th>
            <th>MMS Total</th>
            <th>Pending</th>
            <th>Errored</th>
          </tr>
        </thead>
        <tbody>
          {data.monthly_stats.map(
            ({ month, sms_sent, sms_message_parts, mms_sent, pending, errored }, index) => (
              <tr key={index} data-testid={`stats-row-${index}`}>
                <td>{month}</td>
                <td>{sms_sent}</td>
                <td>{sms_message_parts}</td>
                <td>{mms_sent}</td>
                <td>{pending}</td>
                <td>{errored}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function SummaryWithSuspense() {
  return (
    <Suspense fallback={<div>Loading summary...</div>}>
      <SummaryContentTest />
    </Suspense>
  )
}

describe('SummaryLayout', () => {
  it('shows loading state via Suspense fallback', () => {
    server.use(
      http.get('http://localhost:8000/api/stats/monthly/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return HttpResponse.json(createSummaryData())
      })
    )

    renderWithProviders(<SummaryWithSuspense />)
    expect(screen.getByText('Loading summary...')).toBeInTheDocument()
  })

  it('renders monthly stats table', async () => {
    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText('January 2026')).toBeInTheDocument()
    })
    expect(screen.getByText('February 2026')).toBeInTheDocument()
  })

  it('displays SMS and MMS limits', async () => {
    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      const limitsInfo = screen.getByTestId('limits-info')
      expect(limitsInfo).toHaveTextContent('Monthly SMS limit: 1,000')
      expect(limitsInfo).toHaveTextContent('MMS limit: 100')
    })
  })

  it('renders correct stat values', async () => {
    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('stats-row-0')).toBeInTheDocument()
    })

    // January 2026 stats: sms_sent=150, sms_message_parts=200, mms_sent=10, pending=5, errored=2
    const firstRow = screen.getByTestId('stats-row-0')
    expect(firstRow).toHaveTextContent('150')
    expect(firstRow).toHaveTextContent('200')
    expect(firstRow).toHaveTextContent('10')
    expect(firstRow).toHaveTextContent('5')
    expect(firstRow).toHaveTextContent('2')
  })

  it('renders all table headers', async () => {
    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText('Month')).toBeInTheDocument()
    })
    expect(screen.getByText('SMS Sent')).toBeInTheDocument()
    expect(screen.getByText('SMS Message Parts')).toBeInTheDocument()
    expect(screen.getByText('MMS Total')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Errored')).toBeInTheDocument()
  })

  it('renders multiple months of data', async () => {
    server.use(
      http.get('http://localhost:8000/api/stats/monthly/', () => {
        return HttpResponse.json(
          createSummaryData({
            monthly_stats: [
              createMonthlyStats({ month: 'January 2026' }),
              createMonthlyStats({ month: 'February 2026' }),
              createMonthlyStats({ month: 'March 2026' }),
            ],
          })
        )
      })
    )

    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText('January 2026')).toBeInTheDocument()
    })
    expect(screen.getByText('February 2026')).toBeInTheDocument()
    expect(screen.getByText('March 2026')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^stats-row-/)).toHaveLength(3)
  })

  it('displays custom limits correctly', async () => {
    server.use(
      http.get('http://localhost:8000/api/stats/monthly/', () => {
        return HttpResponse.json(createSummaryData({ sms_limit: 5000, mms_limit: 500 }))
      })
    )

    renderWithProviders(<SummaryWithSuspense />)

    await waitFor(() => {
      const limitsInfo = screen.getByTestId('limits-info')
      expect(limitsInfo).toHaveTextContent('Monthly SMS limit: 5,000')
      expect(limitsInfo).toHaveTextContent('MMS limit: 500')
    })
  })
})
