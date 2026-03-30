import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/handlers'
import { renderWithProviders } from '../../../test/test-utils'
import { createGroupSchedule } from '../../../test/factories'
import GroupScheduleChildrenList from '../GroupScheduleChildrenList'

const BASE_URL = 'http://localhost:8000'

// Must wrap in table structure since component returns TableRow elements
function renderInTable(ui: React.ReactElement) {
  return renderWithProviders(
    <table>
      <tbody>{ui}</tbody>
    </table>
  )
}

function mockDetailEndpoint(overrides: Parameters<typeof createGroupSchedule>[0] = {}) {
  server.use(
    http.get(`${BASE_URL}/api/group-schedules/:id/`, () => {
      return HttpResponse.json(createGroupSchedule(overrides))
    })
  )
}

describe('GroupScheduleChildrenList', () => {
  it('renders contact names from contact_detail', async () => {
    mockDetailEndpoint({
      id: 1,
      schedules: [
        { id: 10, contact_detail: { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }, phone: '0412111111', status: 'sent' },
        { id: 11, contact_detail: { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }, phone: '0412222222', status: 'pending' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    })
  })

  it('shows "Unknown Contact" when contact_detail is null', async () => {
    mockDetailEndpoint({
      id: 1,
      schedules: [
        { id: 10, contact_detail: null, phone: '0412111111', status: 'sent' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Unknown Contact')).toBeInTheDocument()
    })
  })

  it('renders status badges for each child schedule', async () => {
    mockDetailEndpoint({
      id: 1,
      schedules: [
        { id: 10, contact_detail: null, phone: '0412111111', status: 'sent' },
        { id: 11, contact_detail: null, phone: '0412222222', status: 'pending' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('sent')).toBeInTheDocument()
      expect(screen.getByText('pending')).toBeInTheDocument()
    })
  })

  it('shows "No individual schedules found" when schedules array is empty', async () => {
    mockDetailEndpoint({ id: 1, schedules: [] })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No individual schedules found')).toBeInTheDocument()
    })
  })

  it('shows error message on fetch failure', async () => {
    server.use(
      http.get(`${BASE_URL}/api/group-schedules/:id/`, () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      })
    )

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Error loading individual schedules')).toBeInTheDocument()
    })
  })

  it('renders message text', async () => {
    mockDetailEndpoint({
      id: 1,
      text: 'Hello group members!',
      schedules: [
        { id: 10, contact_detail: null, phone: '0412111111', status: 'pending' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Hello group members!')).toBeInTheDocument()
    })
  })

  it('shows edit/delete buttons for pending future schedules', async () => {
    mockDetailEndpoint({
      id: 1,
      status: 'pending',
      scheduled_time: new Date(Date.now() + 3600000).toISOString(),
      schedules: [
        { id: 10, contact_detail: null, phone: '0412111111', status: 'pending' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} onEdit={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Remove')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })
  })

  it('hides edit/delete buttons for non-pending schedules', async () => {
    mockDetailEndpoint({
      id: 1,
      status: 'sent',
      scheduled_time: new Date(Date.now() - 3600000).toISOString(),
      schedules: [
        { id: 10, contact_detail: null, phone: '0412111111', status: 'sent' },
      ],
    })

    renderInTable(<GroupScheduleChildrenList groupScheduleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('sent')).toBeInTheDocument()
    })
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })
})
