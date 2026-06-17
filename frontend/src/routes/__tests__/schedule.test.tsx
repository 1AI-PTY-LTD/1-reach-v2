import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate } from '../../test/factories'
import dayjs from 'dayjs'

// IntersectionObserver (used by useInfiniteScroll inside the real ScheduleContent)
// is stubbed globally in test/setup.ts.

// Mock TanStack Router — ScheduleContent itself uses no router hooks, and its
// Buttons render plain <button>s (no `to` prop), so only createFileRoute matters.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}))

// Mock ScheduleTable to avoid the deep component tree and assert on rows simply.
vi.mock('../../components/ScheduleTable', () => ({
  default: ({ messages, selectedMessageId, setSelectedMessageId }: any) => (
    <div data-testid="schedule-table">
      {messages.map((m: any) => (
        <div
          key={m.id}
          data-testid={`schedule-row-${m.id}`}
          data-selected={String(m.id === selectedMessageId)}
          onClick={() => setSelectedMessageId(m.id)}
        >
          {m.text} - {m.status}
        </div>
      ))}
    </div>
  ),
}))

// Mock LoadingSpinner for a stable testid.
vi.mock('../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner">Loading...</div>,
}))

// Mock DatePicker to surface its current value (and allow assertions on day nav).
vi.mock('../../components/DatePicker', () => ({
  default: ({ value }: { value: dayjs.Dayjs }) => (
    <div data-testid="current-date">{value.format('DD/MM/YYYY')}</div>
  ),
}))

// Import the REAL exported components after mocks are set up.
import { ScheduleContent, ScheduleLayout } from '../app/_layout.schedule'

describe('ScheduleLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    renderWithProviders(<ScheduleContent />)
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders schedule messages after loading', async () => {
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByText(/Hello Alice/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Hello Bob/)).toBeInTheDocument()
  })

  it('displays current date', async () => {
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toHaveTextContent(dayjs().format('DD/MM/YYYY'))
    })
  })

  it('navigates to previous day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toBeInTheDocument()
    })

    // Buttons are [prev, next] — both icon-only.
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[0])

    // Changing the date triggers a fresh query (brief pending state), so wait
    // for the re-render with the new date.
    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toHaveTextContent(
        dayjs().subtract(1, 'day').format('DD/MM/YYYY')
      )
    })
  })

  it('navigates to next day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toBeInTheDocument()
    })

    const buttons = screen.getAllByRole('button')
    await user.click(buttons[1])

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toHaveTextContent(
        dayjs().add(1, 'day').format('DD/MM/YYYY')
      )
    })
  })

  it('auto-selects first message', async () => {
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      const firstRow = screen.getByTestId('schedule-row-1')
      expect(firstRow).toHaveAttribute('data-selected', 'true')
    })
  })

  it('selects message on click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByTestId('schedule-row-2')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('schedule-row-2'))

    expect(screen.getByTestId('schedule-row-2')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('schedule-row-1')).toHaveAttribute('data-selected', 'false')
  })

  it('shows pagination info', async () => {
    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2 results/)).toBeInTheDocument()
    })
  })

  it('shows error state when API fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/schedules/', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load messages')).toBeInTheDocument()
    })
  })

  it('renders empty state when no schedules', async () => {
    server.use(
      http.get('http://localhost:8000/api/schedules/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByText('No messages scheduled for this date')).toBeInTheDocument()
    })

    expect(screen.queryByTestId(/^schedule-row-/)).not.toBeInTheDocument()
  })

  it('does not show pagination info when no results', async () => {
    server.use(
      http.get('http://localhost:8000/api/schedules/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<ScheduleContent />)

    await waitFor(() => {
      expect(screen.getByText('No messages scheduled for this date')).toBeInTheDocument()
    })

    expect(screen.queryByText(/Showing .* results/)).not.toBeInTheDocument()
  })

  it('wraps content in a Suspense boundary via ScheduleLayout', async () => {
    renderWithProviders(<ScheduleLayout />)

    await waitFor(() => {
      expect(screen.getByText(/Hello Alice/)).toBeInTheDocument()
    })
  })
})
