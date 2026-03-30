import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/handlers'
import { renderWithProviders } from '../../../test/test-utils'
import { createGroupSchedule, paginate } from '../../../test/factories'
import GroupSchedulesDetails from '../GroupSchedulesDetails'

const BASE_URL = 'http://localhost:8000'

// Mock GroupScheduleModal to avoid rendering complexity
vi.mock('../GroupScheduleModal', () => ({
  default: () => null,
}))

// Mock useInfiniteScroll to avoid IntersectionObserver issues
vi.mock('../../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}))

function mockListEndpoint(groupSchedules: ReturnType<typeof createGroupSchedule>[]) {
  server.use(
    http.get(`${BASE_URL}/api/group-schedules/`, () => {
      return HttpResponse.json(paginate(groupSchedules))
    })
  )
}

describe('GroupSchedulesDetails', () => {
  it('renders StatusBadge for each group schedule', async () => {
    mockListEndpoint([
      createGroupSchedule({ id: 1, status: 'pending', text: 'Message 1' }),
      createGroupSchedule({ id: 2, status: 'sent', text: 'Message 2' }),
    ])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('pending')).toBeInTheDocument()
      expect(screen.getByText('sent')).toBeInTheDocument()
    })
  })

  it('renders message text in the table', async () => {
    mockListEndpoint([
      createGroupSchedule({ id: 1, text: 'Hello everyone' }),
    ])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Hello everyone')).toBeInTheDocument()
    })
  })

  it('falls back to name when text is empty', async () => {
    mockListEndpoint([
      createGroupSchedule({ id: 1, text: null, name: 'My Schedule' }),
    ])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('My Schedule')).toBeInTheDocument()
    })
  })

  it('renders scheduled time', async () => {
    mockListEndpoint([
      createGroupSchedule({ id: 1, scheduled_time: '2026-03-15T14:30:00Z' }),
    ])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      // dayjs format: hh:mmA DD/MM/YYYY
      expect(screen.getByText(/15\/03\/2026/)).toBeInTheDocument()
    })
  })

  it('shows "Showing X of Y results" count', async () => {
    mockListEndpoint([
      createGroupSchedule({ id: 1 }),
      createGroupSchedule({ id: 2 }),
    ])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Showing 2 of 2 results')).toBeInTheDocument()
    })
  })

  it('expands row on click to show children', async () => {
    const user = userEvent.setup()
    mockListEndpoint([
      createGroupSchedule({ id: 1, text: 'Click me' }),
    ])
    // Override detail endpoint with a single unique contact
    server.use(
      http.get(`${BASE_URL}/api/group-schedules/:id/`, () => {
        return HttpResponse.json(
          createGroupSchedule({
            id: 1,
            text: 'Click me',
            schedules: [
              { id: 10, contact_detail: { id: 1, first_name: 'Zara', last_name: 'Unique', phone: '0400000000' }, phone: '0400000000', status: 'sent' },
            ],
          })
        )
      })
    )

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Click me')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Click me'))

    await waitFor(() => {
      expect(screen.getByText('Zara Unique')).toBeInTheDocument()
    })
  })

  it('collapses expanded row on second click', async () => {
    const user = userEvent.setup()
    mockListEndpoint([
      createGroupSchedule({ id: 1, text: 'Toggle me' }),
    ])
    server.use(
      http.get(`${BASE_URL}/api/group-schedules/:id/`, () => {
        return HttpResponse.json(
          createGroupSchedule({
            id: 1,
            text: 'Toggle me',
            schedules: [
              { id: 10, contact_detail: { id: 1, first_name: 'Zara', last_name: 'Unique', phone: '0400000000' }, phone: '0400000000', status: 'sent' },
            ],
          })
        )
      })
    )

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Toggle me')).toBeInTheDocument()
    })

    // Expand
    await user.click(screen.getByText('Toggle me'))
    await waitFor(() => {
      expect(screen.getByText('Zara Unique')).toBeInTheDocument()
    })

    // Collapse — "Toggle me" appears in both parent row and expanded message,
    // so click the first one (the parent row cell)
    await user.click(screen.getAllByText('Toggle me')[0])
    await waitFor(() => {
      expect(screen.queryByText('Zara Unique')).not.toBeInTheDocument()
    })
  })

  it('shows error state on failure', async () => {
    server.use(
      http.get(`${BASE_URL}/api/group-schedules/`, () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Error loading group schedules')).toBeInTheDocument()
    })
  })

  it('renders table headers', async () => {
    mockListEndpoint([createGroupSchedule({ id: 1 })])

    renderWithProviders(<GroupSchedulesDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Message')).toBeInTheDocument()
      expect(screen.getByText('Scheduled For')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
    })
  })
})
