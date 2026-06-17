import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate, createGroup, createContact } from '../../test/factories'

// Mock TanStack Router. The real GroupsComponent reads its route param via
// `Route.useParams()` (where `Route` is the object returned by createFileRoute).
// We therefore expose useParams on the object createFileRoute returns, plus a
// passthrough Link and a no-op useNavigate (the GroupsModal / nested detail
// components pull useNavigate from the router). `mockParams.current` lets a test
// switch which groupId the route resolves to.
const { mockNavigate, mockParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockParams: { current: { groupId: 1 } },
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

// sonner toast is referenced indirectly through the group modals / member rows.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// Import the REAL exported component after the router mock is set up.
import { GroupsComponent } from '../app/_layout.groups.$groupId'

const BASE_URL = 'http://localhost:8000'

function setGroupId(id: number) {
  mockParams.current = { groupId: id }
}

describe('GroupsComponent (group detail)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setGroupId(1) // "VIP Customers" — present in the default groups handler
  })

  it('renders the group name and member-count badge from the groups list', async () => {
    renderWithProviders(<GroupsComponent />)

    // Default handler returns group id 1 = "VIP Customers" with member_count 3.
    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('3 members')).toBeInTheDocument()
  })

  it('renders both the Messages and Contacts tabs', async () => {
    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })

    expect(screen.getByRole('tab', { name: 'Messages' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Contacts' })).toBeInTheDocument()
  })

  it('uses the singular "member" label when the group has exactly one member', async () => {
    server.use(
      http.get(`${BASE_URL}/api/groups/`, () => {
        return HttpResponse.json(
          paginate([createGroup({ id: 1, name: 'Solo Group', member_count: 1 })])
        )
      })
    )

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('Solo Group')).toBeInTheDocument()
    })
    // Singular form — "1 member", not "1 members".
    expect(screen.getByText('1 member')).toBeInTheDocument()
    expect(screen.queryByText('1 members')).not.toBeInTheDocument()
  })

  it('renders the group members list when the Contacts tab is selected', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE_URL}/api/groups/:id/`, () => {
        return HttpResponse.json({
          ...createGroup({ id: 1, name: 'VIP Customers', member_count: 3 }),
          members: [
            createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
            createContact({ id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }),
          ],
          pagination: { total: 2, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false },
        })
      })
    )

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })

    // Switch from the default Messages tab to Contacts to mount GroupUsersDetails.
    await user.click(screen.getByRole('tab', { name: 'Contacts' }))

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // The member-count summary line reflects the page total.
    expect(screen.getByText('Showing 2 of 2 members')).toBeInTheDocument()
  })

  it('shows the empty member table when the group has no members', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE_URL}/api/groups/:id/`, () => {
        return HttpResponse.json({
          ...createGroup({ id: 1, name: 'VIP Customers', member_count: 0 }),
          members: [],
          pagination: { total: 0, page: 1, limit: 10, totalPages: 0, hasNext: false, hasPrev: false },
        })
      })
    )

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Contacts' }))

    // Header (First Name / Last Name / Phone Number / Action) still renders, but
    // no contact rows are present and the "Showing … of … members" line is hidden.
    await waitFor(() => {
      expect(screen.getByText('First Name')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Showing .* of .* members/)).not.toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('renders "Group not found" when the route groupId is not in the list', async () => {
    // groupId 999 is not returned by the default groups handler.
    setGroupId(999)

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('Group not found')).toBeInTheDocument()
    })
    // The tabbed container / member badge should NOT render in this branch.
    expect(screen.queryByRole('tab', { name: 'Messages' })).not.toBeInTheDocument()
  })

  it('shows the error state when the groups list request fails', async () => {
    server.use(
      http.get(`${BASE_URL}/api/groups/`, () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      })
    )

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('Error loading group details')).toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'Messages' })).not.toBeInTheDocument()
  })

  it('does not show the member-count badge while the groups list is still loading', async () => {
    // Delay the groups response so the pending branch is observable: the route
    // renders the tabbed container with no group name / member badge yet.
    server.use(
      http.get(`${BASE_URL}/api/groups/`, async () => {
        await new Promise((r) => setTimeout(r, 80))
        return HttpResponse.json(paginate([createGroup({ id: 1, name: 'VIP Customers', member_count: 3 })]))
      })
    )

    renderWithProviders(<GroupsComponent />)

    // While pending neither the name nor the member badge is present yet.
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()
    expect(screen.queryByText('3 members')).not.toBeInTheDocument()
    // Tabs still render during loading (group is simply undefined).
    expect(screen.getByRole('tab', { name: 'Messages' })).toBeInTheDocument()

    // Once resolved the badge appears.
    await waitFor(() => {
      expect(screen.getByText('3 members')).toBeInTheDocument()
    })
  })

  it('reads the groupId route param and resolves the matching group', async () => {
    // Point the route at group id 2 and confirm the matching group renders.
    setGroupId(2)
    server.use(
      http.get(`${BASE_URL}/api/groups/`, () => {
        return HttpResponse.json(
          paginate([
            createGroup({ id: 1, name: 'VIP Customers', member_count: 3 }),
            createGroup({ id: 2, name: 'New Customers', member_count: 7 }),
          ])
        )
      })
    )

    renderWithProviders(<GroupsComponent />)

    await waitFor(() => {
      expect(screen.getByText('New Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('7 members')).toBeInTheDocument()
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()
  })
})
