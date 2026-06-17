import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate } from '../../test/factories'

// Mock TanStack Router. The real ContactsLayout renders ContactsWidget which
// relies on useRouterState, useNavigate and router-aware <Link>s (via TableRow),
// so the mock supplies those primitives instead of re-creating the component.
const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { current: { pathname: '/app/contacts' } },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  // Strip router-only props (to/params/target/title) so they don't leak onto the DOM <a>.
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a>{children}</a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: mockLocation.current }) : mockLocation.current,
}))

// Import the REAL exported layout after the router mock is set up.
import { ContactsLayout } from '../app/_layout.contacts'

function setPathname(pathname: string) {
  mockLocation.current = { pathname }
  Object.defineProperty(window, 'location', {
    value: { pathname },
    writable: true,
  })
}

describe('ContactsLayout', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    setPathname('/app/contacts/5') // default: not the index, so no auto-navigate
  })

  it('shows loading state initially', () => {
    renderWithProviders(<ContactsLayout />)
    expect(screen.getByText('Loading contacts...')).toBeInTheDocument()
  })

  it('renders contacts after loading', async () => {
    renderWithProviders(<ContactsLayout />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
  })

  it('renders outlet for nested routes', async () => {
    renderWithProviders(<ContactsLayout />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
  })

  it('auto-navigates to first contact when on /app/contacts', async () => {
    setPathname('/app/contacts')

    renderWithProviders(<ContactsLayout />)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/app/contacts/$contactId',
        params: { contactId: 1 },
      })
    })
  })

  it('does not auto-navigate when already on a contact detail page', async () => {
    setPathname('/app/contacts/5')

    renderWithProviders(<ContactsLayout />)

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

    renderWithProviders(<ContactsLayout />)

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

    renderWithProviders(<ContactsLayout />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
  })
})
