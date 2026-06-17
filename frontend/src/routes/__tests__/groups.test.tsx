import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate } from '../../test/factories'

// Mock TanStack Router. The real GroupsLayout renders GroupsWidget which relies
// on useRouterState, useNavigate and router-aware <Link>s (via TableRow), so the
// mock supplies those primitives instead of re-creating the component.
const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { current: { pathname: '/app/groups' } },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => <a>{children}</a>,
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: mockLocation.current }) : mockLocation.current,
}))

// Import the REAL exported layout after the router mock is set up.
import { GroupsLayout } from '../app/_layout.groups'

function setPathname(pathname: string) {
  mockLocation.current = { pathname }
  Object.defineProperty(window, 'location', {
    value: { pathname },
    writable: true,
  })
}

describe('GroupsLayout', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    setPathname('/app/groups/5') // default: not the index, so no auto-navigate
  })

  it('shows loading state initially', () => {
    renderWithProviders(<GroupsLayout />)
    expect(screen.getByText('Loading groups...')).toBeInTheDocument()
  })

  it('renders groups after loading', async () => {
    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('New Customers')).toBeInTheDocument()
  })

  it('renders the Groups widget heading', async () => {
    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByText('Groups')).toBeInTheDocument()
    })
  })

  it('auto-navigates to first group when on /app/groups', async () => {
    setPathname('/app/groups')

    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/app/groups/$groupId',
        params: { groupId: 1 },
      })
    })
  })

  it('does not auto-navigate when already on a group detail page', async () => {
    setPathname('/app/groups/5')

    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('renders outlet for nested routes', async () => {
    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
  })

  it('shows error state when API fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/groups/', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByText('Error loading groups')).toBeInTheDocument()
    })
  })

  it('handles empty groups list without auto-navigate', async () => {
    setPathname('/app/groups')

    server.use(
      http.get('http://localhost:8000/api/groups/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<GroupsLayout />)

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeInTheDocument()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
