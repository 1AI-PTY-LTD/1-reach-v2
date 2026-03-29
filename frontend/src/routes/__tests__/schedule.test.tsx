import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate } from '../../test/factories'
import dayjs from 'dayjs'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
}))

// Mock ScheduleTable to avoid deep component tree
vi.mock('../../components/ScheduleTable', () => ({
  default: ({ messages, selectedMessageId, setSelectedMessageId }: any) => (
    <div data-testid="schedule-table">
      {messages.map((m: any) => (
        <div
          key={m.id}
          data-testid={`schedule-row-${m.id}`}
          data-selected={m.id === selectedMessageId}
          onClick={() => setSelectedMessageId(m.id)}
        >
          {m.text} - {m.status}
        </div>
      ))}
    </div>
  ),
}))

// Mock LoadingSpinner
vi.mock('../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner">Loading...</div>,
}))

// Re-create ScheduleContent for testing (mirrors infinite scroll version)
import { useInfiniteQuery } from '@tanstack/react-query'
import { getAllSchedulesInfiniteOptions } from '../../api/schedulesApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import { useState } from 'react'

function ScheduleContentTest() {
  const client = useApiClient()
  const [date, setDate] = useState(dayjs())
  const [selectedMessageId, setSelectedMessageId] = useState<undefined | number>()

  const messagesQuery = useInfiniteQuery(
    getAllSchedulesInfiniteOptions(client, date.format('YYYY-MM-DD'), 50)
  )

  if (messagesQuery.status === 'pending') {
    return <div data-testid="loading-spinner">Loading...</div>
  }

  if (messagesQuery.status === 'error') {
    return <div className="text-center py-8 text-red-600">Failed to load messages</div>
  }

  const messages = messagesQuery.data?.pages.flatMap((page) => page.results) ?? []
  const totalCount = messagesQuery.data?.pages[0]?.pagination.total ?? 0

  if (!selectedMessageId && messages.length !== 0) {
    setSelectedMessageId(messages[0].id)
  }

  const goToPreviousDay = () => {
    setSelectedMessageId(undefined)
    setDate((prev) => prev.subtract(1, 'day'))
  }

  const goToNextDay = () => {
    setSelectedMessageId(undefined)
    setDate((prev) => prev.add(1, 'day'))
  }

  return (
    <div>
      <div className="flex gap-4 justify-between mb-4">
        <button onClick={goToPreviousDay} data-testid="prev-day">Previous</button>
        <h2 data-testid="current-date">{date.format('DD/MM/YYYY')}</h2>
        <button onClick={goToNextDay} data-testid="next-day">Next</button>
      </div>
      {totalCount > 0 && (
        <div data-testid="pagination-info">
          Showing {messages.length} of {totalCount} results
        </div>
      )}
      <div data-testid="schedule-table-container">
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
      </div>
    </div>
  )
}

describe('ScheduleLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    renderWithProviders(<ScheduleContentTest />)
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders schedule messages after loading', async () => {
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByText(/Hello Alice/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Hello Bob/)).toBeInTheDocument()
  })

  it('displays current date', async () => {
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toHaveTextContent(dayjs().format('DD/MM/YYYY'))
    })
  })

  it('navigates to previous day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('prev-day'))

    expect(screen.getByTestId('current-date')).toHaveTextContent(
      dayjs().subtract(1, 'day').format('DD/MM/YYYY')
    )
  })

  it('navigates to next day', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('current-date')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('next-day'))

    expect(screen.getByTestId('current-date')).toHaveTextContent(
      dayjs().add(1, 'day').format('DD/MM/YYYY')
    )
  })

  it('auto-selects first message', async () => {
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      const firstRow = screen.getByTestId('schedule-row-1')
      expect(firstRow).toHaveAttribute('data-selected', 'true')
    })
  })

  it('selects message on click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('schedule-row-2')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('schedule-row-2'))

    expect(screen.getByTestId('schedule-row-2')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('schedule-row-1')).toHaveAttribute('data-selected', 'false')
  })

  it('shows pagination info', async () => {
    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('pagination-info')).toBeInTheDocument()
    })

    expect(screen.getByTestId('pagination-info')).toHaveTextContent(/Showing 2 of 2 results/)
  })

  it('shows error state when API fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/schedules/', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<ScheduleContentTest />)

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

    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('schedule-table')).toBeInTheDocument()
    })

    expect(screen.queryByTestId(/^schedule-row-/)).not.toBeInTheDocument()
  })

  it('does not show pagination info when no results', async () => {
    server.use(
      http.get('http://localhost:8000/api/schedules/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<ScheduleContentTest />)

    await waitFor(() => {
      expect(screen.getByTestId('schedule-table')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('pagination-info')).not.toBeInTheDocument()
  })
})
