import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createSummaryData, createMonthlyStats } from '../../test/factories'
import { Suspense } from 'react'

// `_layout.summary.tsx` calls `createFileRoute(...)({ ... })` at module load,
// so we mock the router. The real SummaryContent never passes `to` to a row,
// so `Link` is never rendered — a stub keeps `ui/link` importable.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

// Render the REAL component (now exported from the route module).
import { SummaryContent } from '../app/_layout.summary'

const SUMMARY_URL = 'http://localhost:8000/api/stats/monthly/'

// SummaryContent uses useSuspenseQuery, so it must be rendered inside a
// Suspense boundary (the route normally provides one via RouteComponent).
function renderSummary() {
  return renderWithProviders(
    <Suspense fallback={<div>Loading summary...</div>}>
      <SummaryContent />
    </Suspense>,
  )
}

describe('SummaryContent', () => {
  it('shows a loading fallback while the summary request is in flight', () => {
    server.use(
      http.get(SUMMARY_URL, async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return HttpResponse.json(createSummaryData())
      }),
    )

    renderSummary()

    expect(screen.getByText('Loading summary...')).toBeInTheDocument()
  })

  it('displays the monthly spend with the configured limit', async () => {
    // Default handler returns total_monthly_spend '12.50' and monthly_limit '50.00'.
    renderSummary()

    await waitFor(() => {
      expect(
        screen.getByText('Monthly spend: $12.50 / $50.00 limit'),
      ).toBeInTheDocument()
    })
  })

  it('shows "(no limit set)" when monthly_limit is null', async () => {
    server.use(
      http.get(SUMMARY_URL, () =>
        HttpResponse.json(
          createSummaryData({ monthly_limit: null, total_monthly_spend: '7.50' }),
        ),
      ),
    )

    renderSummary()

    await waitFor(() => {
      expect(
        screen.getByText('Monthly spend: $7.50 (no limit set)'),
      ).toBeInTheDocument()
    })
    // The limit branch must not render when no limit is set.
    expect(screen.queryByText(/limit$/)).not.toBeInTheDocument()
  })

  it('renders the stats table headers', async () => {
    renderSummary()

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'SMS Sent' })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'SMS Message Parts' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'MMS Total' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Pending' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Errored' })).toBeInTheDocument()
  })

  it('renders a row per month with its stat values', async () => {
    server.use(
      http.get(SUMMARY_URL, () =>
        HttpResponse.json(
          createSummaryData({
            monthly_stats: [
              createMonthlyStats({
                month: 'January 2026',
                sms_sent: 150,
                sms_message_parts: 200,
                mms_sent: 10,
                pending: 5,
                errored: 2,
              }),
              createMonthlyStats({ month: 'February 2026', sms_sent: 180 }),
              createMonthlyStats({ month: 'March 2026', sms_sent: 99 }),
            ],
          }),
        ),
      ),
    )

    renderSummary()

    await waitFor(() => {
      expect(screen.getByText('January 2026')).toBeInTheDocument()
    })
    expect(screen.getByText('February 2026')).toBeInTheDocument()
    expect(screen.getByText('March 2026')).toBeInTheDocument()

    // The January row must surface its individual stat cells.
    const januaryRow = screen.getByText('January 2026').closest('tr')!
    expect(januaryRow).toHaveTextContent('150')
    expect(januaryRow).toHaveTextContent('200')
    expect(januaryRow).toHaveTextContent('10')
    expect(januaryRow).toHaveTextContent('5')
    expect(januaryRow).toHaveTextContent('2')

    // 3 data rows + 1 header row.
    expect(screen.getAllByRole('row')).toHaveLength(4)
  })

  it('shows an empty-state message when there are no monthly stats', async () => {
    server.use(
      http.get(SUMMARY_URL, () =>
        HttpResponse.json(createSummaryData({ monthly_stats: [] })),
      ),
    )

    renderSummary()

    await waitFor(() => {
      expect(
        screen.getByText(
          'No data yet. Stats will appear after your first message is sent.',
        ),
      ).toBeInTheDocument()
    })
    // Header row only — no data rows are rendered.
    expect(screen.queryByText('January 2026')).not.toBeInTheDocument()
  })
})
