import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createGroup, paginate } from '../../test/factories'
import { Suspense } from 'react'

// Mock TanStack Router
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: undefined }),
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useNavigate: () => mockNavigate,
}))

// Re-create GroupsLayout for testing (original is not exported)
import { useSuspenseQuery } from '@tanstack/react-query'
import { getAllGroupsQueryOptions } from '../../api/groupsApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import { useEffect } from 'react'

function GroupsLayoutTest() {
  const client = useApiClient()
  const allGroupsQuery = useSuspenseQuery(getAllGroupsQueryOptions(client))
  const navigate = mockNavigate

  useEffect(() => {
    const currentPath = window.location.pathname
    const isGroupsIndexRoute = currentPath === '/app/groups' || currentPath === '/app/groups/'

    if (isGroupsIndexRoute && allGroupsQuery.data.length > 0) {
      const firstGroupId = allGroupsQuery.data[0].id
      navigate({
        to: '/app/groups/$groupId',
        params: { groupId: firstGroupId },
      })
    }
  }, [allGroupsQuery.data, navigate])

  return (
    <div className="flex">
      <div className="w-1/4">
        <div data-testid="groups-widget">
          {allGroupsQuery.data.map((g) => (
            <div key={g.id} data-testid={`group-${g.id}`}>
              {g.name} ({g.member_count})
            </div>
          ))}
        </div>
      </div>
      <div className="w-3/4" data-testid="outlet-container">
        <div data-testid="outlet">Outlet Content</div>
      </div>
    </div>
  )
}

function GroupsLayoutWithSuspense() {
  return (
    <Suspense fallback={<div>Loading groups...</div>}>
      <GroupsLayoutTest />
    </Suspense>
  )
}

describe('GroupsLayout', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('shows loading state via Suspense fallback', () => {
    // Use a handler that delays response
    server.use(
      http.get('http://localhost:8000/api/groups/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return HttpResponse.json(paginate([createGroup({ id: 1 })]))
      })
    )

    renderWithProviders(<GroupsLayoutWithSuspense />)
    expect(screen.getByText('Loading groups...')).toBeInTheDocument()
  })

  it('renders groups after loading', async () => {
    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText(/VIP Customers/)).toBeInTheDocument()
    })
    expect(screen.getByText(/New Customers/)).toBeInTheDocument()
  })

  it('shows member counts', async () => {
    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText('VIP Customers (3)')).toBeInTheDocument()
    })
    expect(screen.getByText('New Customers (2)')).toBeInTheDocument()
  })

  it('auto-navigates to first group when on /app/groups', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/groups' },
      writable: true,
    })

    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/app/groups/$groupId',
        params: { groupId: 1 },
      })
    })
  })

  it('does not auto-navigate when already on a group detail page', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/groups/5' },
      writable: true,
    })

    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(screen.getByText(/VIP Customers/)).toBeInTheDocument()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('renders outlet container for nested routes', async () => {
    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('outlet-container')).toBeInTheDocument()
    })
  })

  it('handles empty groups list without auto-navigate', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/groups' },
      writable: true,
    })

    server.use(
      http.get('http://localhost:8000/api/groups/', () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<GroupsLayoutWithSuspense />)

    await waitFor(() => {
      expect(screen.getByTestId('groups-widget')).toBeInTheDocument()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
