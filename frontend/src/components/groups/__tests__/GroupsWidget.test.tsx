import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupsWidget from '../GroupsWidget'
import { createGroup } from '../../../test/factories'
import { renderWithProviders } from '../../../test/test-utils'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({
    pathname: '/app/groups/1',
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

// Mock GroupsModal
vi.mock('../GroupsModal', () => ({
  default: () => null,
}))

const groups = [
  createGroup({ id: 1, name: 'VIP Customers', member_count: 15 }),
  createGroup({ id: 2, name: 'New Customers', member_count: 8 }),
  createGroup({ id: 3, name: 'Inactive', member_count: 3 }),
]

describe('GroupsWidget', () => {
  it('renders the Groups heading', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)
    expect(screen.getByText('Groups')).toBeInTheDocument()
  })

  it('renders group names', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)

    expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    expect(screen.getByText('New Customers')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
  })

  it('renders Add button', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('shows search help message by default', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)
    expect(screen.getByText('Min. 2 letters to start search')).toBeInTheDocument()
  })

  it('allows typing in search input', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GroupsWidget userGroups={groups} />)

    const searchInput = screen.getByLabelText('Search')
    await user.type(searchInput, 'VIP')

    expect(searchInput).toHaveValue('VIP')
  })

  it('renders avatar initials for groups', () => {
    renderWithProviders(<GroupsWidget userGroups={groups} />)

    expect(screen.getByText('VI')).toBeInTheDocument() // VIP Customers
    expect(screen.getByText('NE')).toBeInTheDocument() // New Customers
    expect(screen.getByText('IN')).toBeInTheDocument() // Inactive
  })

  it('renders empty state with no groups', () => {
    renderWithProviders(<GroupsWidget userGroups={[]} />)
    expect(screen.getByText('Groups')).toBeInTheDocument()
    // No group names rendered
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()
  })
})
