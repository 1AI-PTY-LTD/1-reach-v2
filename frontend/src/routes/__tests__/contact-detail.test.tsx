import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate, createContact, createSchedule } from '../../test/factories'
import dayjs from 'dayjs'

// Mock TanStack Router. The real ContactDetails reads its route param via
// `Route.useParams()` (where `Route` is the object returned by createFileRoute),
// and the contact/message modals it renders pull `useNavigate` from the router.
// We therefore expose useParams on the object createFileRoute returns, plus a
// passthrough Link and a no-op useNavigate. `mockParams.current` lets a test
// switch which contactId the route resolves to.
const { mockNavigate, mockParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockParams: { current: { contactId: 1 } },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams.current,
  }),
  useParams: () => mockParams.current,
  // Strip router-only props (to/params/target) so they don't leak onto the DOM <a>.
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}))

// sonner toast is referenced indirectly through the contact modals; keep it inert.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// Import the REAL exported component after the router mock is set up.
import { ContactDetails } from '../app/_layout.contacts.$contactId'

const BASE_URL = 'http://localhost:8000'

function setContactId(id: number) {
  mockParams.current = { contactId: id }
}

describe('ContactDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setContactId(1) // Alice Smith — present in the default contacts handler
  })

  it('shows loading state while contacts are pending', () => {
    // Delay the contacts response so the pending branch is observable.
    server.use(
      http.get(`${BASE_URL}/api/contacts/`, async () => {
        await new Promise((r) => setTimeout(r, 50))
        return HttpResponse.json(paginate([createContact({ id: 1 })]))
      })
    )

    renderWithProviders(<ContactDetails />)

    expect(screen.getByText('Loading contact...')).toBeInTheDocument()
  })

  it('renders the contact detail header from the contacts list', async () => {
    renderWithProviders(<ContactDetails />)

    // Default handler returns Alice Smith with phone 0412111111.
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    // Phone is formatted into 4-3-3 groups by the component.
    expect(screen.getByText('Phone: 0412 111 111')).toBeInTheDocument()
  })

  it('renders the message-history table headers', async () => {
    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Scheduled Time')).toBeInTheDocument()
    expect(screen.getByText('Sent Time')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Message')).toBeInTheDocument()
  })

  it('renders message rows from the schedules-by-contact endpoint', async () => {
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(
          paginate([
            createSchedule({ id: 41, text: 'First message to Alice', status: 'sent', format: 'SMS' }),
            createSchedule({ id: 42, text: 'Second message to Alice', status: 'pending', format: 'MMS' }),
          ])
        )
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('First message to Alice')).toBeInTheDocument()
    })
    expect(screen.getByText('Second message to Alice')).toBeInTheDocument()
    // Format column surfaces the per-message type.
    expect(screen.getByText('MMS')).toBeInTheDocument()
  })

  it('truncates long message text to 40 characters with an ellipsis', async () => {
    const longText = 'A'.repeat(60)
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(
          paginate([createSchedule({ id: 50, text: longText, status: 'sent' })])
        )
      })
    )

    renderWithProviders(<ContactDetails />)

    const expected = longText.substring(0, 40) + '...'
    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument()
    })
    expect(screen.queryByText(longText)).not.toBeInTheDocument()
  })

  it('expands a row to show the MessageDetails panel on click', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(
          paginate([
            createSchedule({
              id: 61,
              text: 'Click to expand me',
              status: 'sent',
              contact: 1,
            }),
          ])
        )
      })
    )

    renderWithProviders(<ContactDetails />)

    const row = await screen.findByText('Click to expand me')
    await user.click(row)

    // MessageDetails renders a "Message" header inside the expanded panel,
    // so after expansion there are two "Message" texts (column header + detail).
    await waitFor(() => {
      expect(screen.getAllByText('Message').length).toBeGreaterThan(1)
    })
  })

  it('shows the pagination summary line with total messages', async () => {
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(
          paginate(
            [
              createSchedule({ id: 71, text: 'msg one', status: 'sent' }),
              createSchedule({ id: 72, text: 'msg two', status: 'sent' }),
            ],
            { total: 2 }
          )
        )
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2 messages/)).toBeInTheDocument()
    })
  })

  it('renders the empty state when the contact has no messages', async () => {
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(paginate([], { total: 0 }))
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('No messages for this contact')).toBeInTheDocument()
    })
  })

  it('shows the messages-error state when the schedules endpoint fails', async () => {
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load messages')).toBeInTheDocument()
    })
    // The contact header still renders since the contacts query succeeds.
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('falls back to fetching the contact by id when it is not in the list', async () => {
    // contactId 99 is not in the default list, forcing the by-id query branch.
    setContactId(99)
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/`, ({ params }) => {
        if (Number(params.id) === 99) {
          return HttpResponse.json(
            createContact({ id: 99, first_name: 'Zoe', last_name: 'Quinn', phone: '0499888777' })
          )
        }
        return HttpResponse.json({ error: 'Contact not found' }, { status: 404 })
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('Zoe Quinn')).toBeInTheDocument()
    })
    expect(screen.getByText('Phone: 0499 888 777')).toBeInTheDocument()
  })

  it('shows the contact-error state when both list and by-id lookups fail', async () => {
    setContactId(123)
    server.use(
      http.get(`${BASE_URL}/api/contacts/`, () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<ContactDetails />)

    await waitFor(() => {
      expect(screen.getByText('Error loading contact details')).toBeInTheDocument()
    })
  })

  it('formats the scheduled time using the dayjs display format', async () => {
    const scheduled = '2026-03-10T09:30:00Z'
    server.use(
      http.get(`${BASE_URL}/api/contacts/:id/schedules/`, () => {
        return HttpResponse.json(
          paginate([
            createSchedule({ id: 81, text: 'timed message', status: 'sent', scheduled_time: scheduled }),
          ])
        )
      })
    )

    renderWithProviders(<ContactDetails />)

    const expected = dayjs(scheduled).format('hh:mmA DD/MM/YYYY')
    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument()
    })
  })
})
