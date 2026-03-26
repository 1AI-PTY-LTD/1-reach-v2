import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { paginate } from '../../test/factories'
import { Suspense } from 'react'

// Mock TanStack Router — capture route options so errorComponent can be tested
// Use vi.hoisted so capturedUsersRouteOptions is available inside the hoisted vi.mock factory
const { capturedUsersRouteOptions } = vi.hoisted(() => ({
  capturedUsersRouteOptions: {} as Record<string, unknown>,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => {
    Object.assign(capturedUsersRouteOptions, options)
    return options
  },
  useNavigate: () => vi.fn(),
}))

// Override Clerk mock to include admin membership
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue('mock-token'),
    isSignedIn: true,
    isLoaded: true,
    userId: 'user_test123',
    orgId: 'org_test123',
  }),
  useUser: () => ({
    user: { id: 'user_test123', firstName: 'Admin', lastName: 'User' },
    isLoaded: true,
    isSignedIn: true,
  }),
  useOrganization: () => ({
    organization: { id: 'org_test123', name: 'Test Org' },
    membership: { role: 'org:admin' },
    isLoaded: true,
  }),
  useOrganizationList: () => ({
    organizationList: [{ organization: { id: 'org_test123', name: 'Test Org' } }],
    isLoaded: true,
    setActive: vi.fn(),
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  UserButton: () => null,
}))

// Import after mocks
// eslint-disable-next-line import/first
import { UsersContent } from '../app/_layout.users'

function UsersTest() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UsersContent />
    </Suspense>
  )
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders users table after loading', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('inactive@example.com')).toBeInTheDocument()
  })

  it('shows table headers', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument()
    })
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Organisation')).toBeInTheDocument()
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('shows role badges correctly', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Member')).toHaveLength(2)
  })

  it('shows status badges correctly', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getAllByText('Active')).toHaveLength(2)
    })
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows (you) label for current user', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('(you)')).toBeInTheDocument()
    })
  })

  it('shows Invite User button for admins', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Invite User')).toBeInTheDocument()
    })
  })

  it('shows Make Admin buttons for non-self members', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getAllByText('Make Admin')).toHaveLength(2)
    })
  })

  it('does not show Revoke Admin button (self is only admin)', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    })
    expect(screen.queryByText('Revoke Admin')).not.toBeInTheDocument()
  })

  it('shows Deactivate button for active non-self users', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Deactivate')).toBeInTheDocument()
    })
  })

  it('shows Re-invite button for inactive users', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Re-invite')).toBeInTheDocument()
    })
  })

  it('dims inactive user rows', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('inactive@example.com')).toBeInTheDocument()
    })

    const inactiveRow = screen.getByText('inactive@example.com').closest('tr')
    expect(inactiveRow).toHaveClass('opacity-50')
  })

  it('renders empty table when no users', async () => {
    server.use(
      http.get('http://localhost:8000/api/users/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument()
    })
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument()
  })

  it('shows organisation name for users', async () => {
    renderWithProviders(<UsersTest />)

    await waitFor(() => {
      expect(screen.getAllByText('Test Org')).toHaveLength(3)
    })
  })

  it('renders error component with message and retry button', () => {
    // capturedUsersRouteOptions is populated when _layout.users.tsx is imported above
    const ErrorComponent = capturedUsersRouteOptions.errorComponent as React.ComponentType<{
      error: Error
      info: { componentStack: string }
      reset: () => void
    }>
    renderWithProviders(
      <ErrorComponent
        error={new Error('Failed to load users.')}
        info={{ componentStack: '' }}
        reset={() => {}}
      />
    )
    expect(screen.getByText('Failed to load users.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
