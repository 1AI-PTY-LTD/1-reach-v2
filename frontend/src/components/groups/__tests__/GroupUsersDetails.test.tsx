import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/handlers'
import { renderWithProviders } from '../../../test/test-utils'
import { createContact, createGroup } from '../../../test/factories'
import GroupUsersDetails from '../GroupUsersDetails'

// Mock toasts (see wave-1 lessons): sonner is a side effect, not under test.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const BASE_URL = 'http://localhost:8000'

/**
 * Override the group-members endpoint with a single page of members.
 * The real query (getGroupMembersInfiniteOptions) hits
 * `/api/groups/:id/?page=&limit=` and expects { members, pagination }.
 */
function mockMembers(
  members = [
    createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
    createContact({ id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }),
  ],
  total = members.length,
) {
  server.use(
    http.get(`${BASE_URL}/api/groups/:id/`, () => {
      return HttpResponse.json({
        ...createGroup({ id: 1, name: 'VIP Customers' }),
        members,
        pagination: { total, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false },
      })
    }),
  )
}

describe('GroupUsersDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a row per member with first/last name', async () => {
    mockMembers()
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
    expect(screen.getByText('Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Jones')).toBeInTheDocument()
  })

  it('renders the table column headers', async () => {
    mockMembers()
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
    expect(screen.getByText('First Name')).toBeInTheDocument()
    expect(screen.getByText('Last Name')).toBeInTheDocument()
    expect(screen.getByText('Phone Number')).toBeInTheDocument()
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('formats the phone number into 4-3-3 groups', async () => {
    mockMembers([createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' })])
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('0412 111 111')).toBeInTheDocument()
    })
  })

  it('renders a dash when a member has no phone', async () => {
    mockMembers([createContact({ id: 5, first_name: 'No', last_name: 'Phone', phone: '' })])
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No')).toBeInTheDocument()
    })
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('shows the "Showing X of Y members" count header', async () => {
    mockMembers(
      [
        createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
        createContact({ id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }),
      ],
      7,
    )
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Showing 2 of 7 members')).toBeInTheDocument()
    })
  })

  it('shows the skeleton loader while the members query is pending', () => {
    // Never-resolving handler keeps the query in "pending".
    server.use(
      http.get(`${BASE_URL}/api/groups/:id/`, () => new Promise(() => {})),
    )
    const { container } = renderWithProviders(<GroupUsersDetails groupId={1} />)

    // TableSkeleton renders animate-pulse placeholder boxes, not real rows.
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('shows an error message when the members query fails', async () => {
    server.use(
      http.get(`${BASE_URL}/api/groups/:id/`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Error loading group members')).toBeInTheDocument()
    })
  })

  it('opens the remove-member confirmation dialog with the member name', async () => {
    const user = userEvent.setup()
    mockMembers([createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' })])
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove Alice Smith from group' }))

    // "Remove Member" appears twice — as the dialog title (a heading) and as the
    // confirm action button. Scope to the heading role to disambiguate.
    expect(screen.getByRole('heading', { name: 'Remove Member' })).toBeInTheDocument()
    // The description is a single element; its interpolated member name makes
    // the visible text "...remove Alice Smith from this group...".
    expect(
      screen.getByText(
        (_content, el) => {
          if (!el) return false
          const text = el.textContent ?? ''
          const childMatches = Array.from(el.children).some((c) =>
            (c.textContent ?? '').includes('remove Alice Smith from'),
          )
          return !childMatches && text.includes('remove Alice Smith from')
        },
      ),
    ).toBeInTheDocument()
  })

  it('removes a member and shows a success toast on confirm', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockMembers([createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' })])
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove Alice Smith from group' }))

    // The confirm dialog's action button is labelled "Remove Member" (the
    // dialog title with the same text is a heading, not a button).
    await user.click(screen.getByRole('button', { name: 'Remove Member' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Member removed')
    })
  })

  it('closes the confirmation dialog when Cancel is clicked', async () => {
    const user = userEvent.setup()
    mockMembers([createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' })])
    renderWithProviders(<GroupUsersDetails groupId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove Alice Smith from group' }))
    // Dialog title heading confirms the confirmation dialog is open ("Remove
    // Member" also matches the confirm button, so scope to the heading role).
    expect(screen.getByRole('heading', { name: 'Remove Member' })).toBeInTheDocument()

    await user.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Remove Member' })).not.toBeInTheDocument()
    })
  })
})
