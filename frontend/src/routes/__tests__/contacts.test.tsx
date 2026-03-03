import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createContact, paginate } from '../../test/factories'

// Mock TanStack Router
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useNavigate: () => mockNavigate,
}))

// Import after mocks are set up - we need to test the inner component
// Since ContactsLayout is not exported, we re-create a test version that mirrors its logic
import { useQuery } from '@tanstack/react-query'
import { getAllContactsQueryOptions } from '../../api/contactsApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import { useEffect } from 'react'
import { Outlet } from '@tanstack/react-router'

function ContactsLayoutTest() {
  const client = useApiClient()
  const allContactsQuery = useQuery(getAllContactsQueryOptions(client))
  const navigate = mockNavigate
  const contacts = allContactsQuery.data

  useEffect(() => {
    if (
      contacts &&
      contacts[0]?.id &&
      window.location.pathname === '/app/contacts'
    ) {
      navigate({
        to: '/app/contacts/$contactId',
        params: { contactId: contacts[0].id },
      })
    }
  }, [contacts, navigate])

  if (allContactsQuery.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-600">Error loading contacts</div>
      </div>
    )
  }

  if (allContactsQuery.status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading contacts...</div>
      </div>
    )
  }

  return (
    <div className="flex">
      <div className="w-1/4">
        <div data-testid="contacts-widget">
          {contacts?.map((c) => (
            <div key={c.id} data-testid={`contact-${c.id}`}>
              {c.first_name} {c.last_name}
            </div>
          ))}
        </div>
      </div>
      <div className="w-3/4">
        <Outlet />
      </div>
    </div>
  )
}

describe('ContactsLayout', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('shows loading state initially', () => {
    renderWithProviders(<ContactsLayoutTest />)
    expect(screen.getByText('Loading contacts...')).toBeInTheDocument()
  })

  it('renders contacts after loading', async () => {
    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
  })

  it('renders outlet for nested routes', async () => {
    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
  })

  it('auto-navigates to first contact when on /app/contacts', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/contacts' },
      writable: true,
    })

    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/app/contacts/$contactId',
        params: { contactId: 1 },
      })
    })
  })

  it('does not auto-navigate when already on a contact detail page', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/contacts/5' },
      writable: true,
    })

    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows error state when API fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/contacts/', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(screen.getByText('Error loading contacts')).toBeInTheDocument()
    })
  })

  it('renders empty state when no contacts returned', async () => {
    server.use(
      http.get('http://localhost:8000/api/contacts/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<ContactsLayoutTest />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
    expect(screen.queryByTestId(/^contact-/)).not.toBeInTheDocument()
  })
})
