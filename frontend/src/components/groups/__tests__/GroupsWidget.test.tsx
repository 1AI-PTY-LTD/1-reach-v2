import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import { server } from '../../../test/handlers'
import { createGroup, paginate } from '../../../test/factories'
import GroupsWidget from '../GroupsWidget'

// ---------------------------------------------------------------------------
// Router mock.
//
// GroupsWidget reads the active route via useRouterState({ select }) (operating
// on state.location), navigates on group creation, and — through <TableRow
// to=...> / <TableCell> → ui/link.tsx — renders TanStack <Link>. We expose a
// mutable `mockLocation` so individual tests can control which group row is
// "selected", run the real `select` callback against it, and capture navigate
// calls.
// ---------------------------------------------------------------------------
const { mockLocation, mockNavigate } = vi.hoisted(() => ({
  mockLocation: { pathname: '/app/groups/1' },
  mockNavigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: typeof mockLocation }) => unknown }) =>
    select({ location: mockLocation }),
  useNavigate: () => mockNavigate,
  // An <a> only resolves to role="link" when it has an href, so derive one
  // from the `to`/`params` the widget passes through.
  Link: ({ children, to, params, ...props }: any) => {
    const href = typeof to === 'string' && params?.groupId != null ? to.replace('$groupId', String(params.groupId)) : to
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

// ---------------------------------------------------------------------------
// GroupsModal mock.
//
// The real modal pulls in @tanstack/react-form + sonner and is covered by its
// own test. Here we only need to observe that the widget opens it (Add button)
// and forwards the navigation callback, so the mock reflects `isOpen` and lets
// us fire `onGroupCreated`.
// ---------------------------------------------------------------------------
let lastOnGroupCreated: ((group: any) => void) | undefined
vi.mock('../GroupsModal', () => ({
  default: ({ isOpen, onGroupCreated }: any) => {
    lastOnGroupCreated = onGroupCreated
    return isOpen ? <div data-testid="groups-modal">Create New Group</div> : null
  },
}))

const BASE = 'http://localhost:8000'

// A group's display name lives in <span class="font-medium">{name}</span>, but
// during a refetch transition React can momentarily wrap/normalise the text so a
// strict, exact getByText('Alpha…') trips over text that is split across nodes
// (and "Alpha Result" is a prefix of "Alphabet Result"). This matcher targets the
// single element whose OWN normalised text is exactly the group name, ignoring
// text aggregated from descendants — the standard RTL pattern for split text.
const exactName = (name: string) => (_content: string, element: Element | null) => {
  if (!element) return false
  const normalise = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
  const ownText = Array.from(element.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join('')
  return normalise(ownText) === name
}

const userGroups = [
  createGroup({ id: 1, name: 'VIP Customers', member_count: 15 }),
  createGroup({ id: 2, name: 'New Customers', member_count: 8 }),
  createGroup({ id: 3, name: 'Inactive', member_count: 3 }),
]

beforeEach(() => {
  mockLocation.pathname = '/app/groups/1'
  mockNavigate.mockReset()
  lastOnGroupCreated = undefined
})

describe('GroupsWidget — static render', () => {
  it('renders the heading, search input and Add button', () => {
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    expect(screen.getByText('Groups')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('renders the passed-in groups before any search', () => {
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    expect(screen.getByText('New Customers')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows the empty state when there are no groups', () => {
    renderWithProviders(<GroupsWidget userGroups={[]} />)

    expect(screen.getByText('No groups yet')).toBeInTheDocument()
    expect(screen.getByText('Click "Add" to create your first group')).toBeInTheDocument()
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()
  })
})

describe('GroupsWidget — group-name initials extraction', () => {
  it('uppercases the first two characters of multi-letter names', () => {
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    // VIP Customers -> "VI", New Customers -> "NE", Inactive -> "IN"
    expect(screen.getByText('VI')).toBeInTheDocument()
    expect(screen.getByText('NE')).toBeInTheDocument()
    expect(screen.getByText('IN')).toBeInTheDocument()
  })

  it('lowercase names are upcased and spaces count as the second char', () => {
    renderWithProviders(
      <GroupsWidget
        userGroups={[
          createGroup({ id: 10, name: 'beta team' }), // -> "BE"
        ]}
      />
    )

    expect(screen.getByText('BE')).toBeInTheDocument()
  })

  it('single-character names yield a single initial (no trailing undefined)', () => {
    renderWithProviders(
      <GroupsWidget
        userGroups={[
          createGroup({ id: 11, name: 'A' }), // charAt(1) is '' -> initials === "A"
        ]}
      />
    )

    // The bare name "A" appears twice: once as the row's display name and once
    // as the avatar initials. Scope to the avatar (the initials live in the
    // SVG <text> inside the [data-slot="avatar"] span) so we assert on the
    // initials specifically and prove there's no trailing "UNDEFINED".
    const matches = screen.getAllByText('A')
    const avatarText = matches.find((el) => el.closest('[data-slot="avatar"]'))
    expect(avatarText).toBeDefined()
    expect(avatarText?.textContent).toBe('A')
  })
})

describe('GroupsWidget — selection behavior', () => {
  it('marks the row matching the active route as selected (font-bold)', () => {
    mockLocation.pathname = '/app/groups/2'
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    const selectedName = screen.getByText('New Customers')
    const selectedRow = selectedName.closest('tr')
    expect(selectedRow).toHaveClass('font-bold')

    // A non-active row is not bold.
    const otherRow = screen.getByText('VIP Customers').closest('tr')
    expect(otherRow).not.toHaveClass('font-bold')
  })

  it('marks no row when the route is not a group detail path', () => {
    mockLocation.pathname = '/app/contacts'
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    for (const name of ['VIP Customers', 'New Customers', 'Inactive']) {
      expect(screen.getByText(name).closest('tr')).not.toHaveClass('font-bold')
    }
  })

  it('renders each group row as a link to its detail route', () => {
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    // ui/link.tsx renders an <a> per linked cell; at least one per group row.
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(userGroups.length)
  })
})

describe('GroupsWidget — debounced search query', () => {
  it('does not search and keeps userGroups for queries shorter than 2 chars', async () => {
    const user = userEvent.setup()
    const searchCalled = vi.fn()
    server.use(
      http.get(`${BASE}/api/groups/`, ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) searchCalled()
        return HttpResponse.json(paginate(userGroups))
      })
    )

    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    await user.type(screen.getByLabelText('Search'), 'V')

    // Give the 300ms debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 400))

    expect(searchCalled).not.toHaveBeenCalled()
    // Original list is still shown.
    expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    expect(screen.getByText('New Customers')).toBeInTheDocument()
  })

  it('debounces input and replaces the list with server search results', async () => {
    const user = userEvent.setup()
    const searchTerms: string[] = []
    server.use(
      http.get(`${BASE}/api/groups/`, ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) {
          searchTerms.push(search)
          return HttpResponse.json(
            paginate([createGroup({ id: 99, name: 'Wholesale Partners' })])
          )
        }
        return HttpResponse.json(paginate(userGroups))
      })
    )

    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    await user.type(screen.getByLabelText('Search'), 'Whole')

    // The server result replaces the original list.
    await waitFor(() => {
      expect(screen.getByText('Wholesale Partners')).toBeInTheDocument()
    })
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()

    // Debounce means we don't fire a request per keystroke; the final term wins.
    expect(searchTerms).toContain('Whole')
    expect(searchTerms.length).toBeLessThan('Whole'.length)
  })

  it('shows the "no groups found" message when search returns nothing', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/api/groups/`, ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) return HttpResponse.json(paginate([]))
        return HttpResponse.json(paginate(userGroups))
      })
    )

    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    await user.type(screen.getByLabelText('Search'), 'zzz')

    await waitFor(
      () => {
        expect(screen.getByText("Didn't find any groups")).toBeInTheDocument()
      },
      { timeout: 2500 }
    )
  })
})

describe('GroupsWidget — keep previous results during refetch', () => {
  it('keeps the prior search results visible while a new query is fetching', async () => {
    const user = userEvent.setup()
    let resolveSecond: (() => void) | null = null

    server.use(
      http.get(`${BASE}/api/groups/`, async ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search === 'alpha') {
          return HttpResponse.json(paginate([createGroup({ id: 70, name: 'Alpha Result' })]))
        }
        if (search === 'alphabet') {
          // Hold the second fetch open so the widget is mid-refetch.
          await new Promise<void>((resolve) => {
            resolveSecond = resolve
          })
          return HttpResponse.json(paginate([createGroup({ id: 71, name: 'Alphabet Result' })]))
        }
        return HttpResponse.json(paginate(userGroups))
      })
    )

    renderWithProviders(<GroupsWidget userGroups={userGroups} />)
    const searchInput = screen.getByLabelText('Search')

    // First search resolves and replaces the list.
    await user.type(searchInput, 'alpha')
    await waitFor(() => {
      expect(screen.getByText(exactName('Alpha Result'))).toBeInTheDocument()
    })

    // Trigger a second search whose response is held open.
    await user.type(searchInput, 'bet') // -> "alphabet"

    // While the second request is in flight, the prior results remain rendered
    // (lastSearchResults), not the original userGroups.
    await waitFor(() => {
      expect(screen.getByText(exactName('Alpha Result'))).toBeInTheDocument()
    })
    expect(screen.queryByText('VIP Customers')).not.toBeInTheDocument()

    // Let the held request finish; the new results take over. "Alphabet Result"
    // must now be present (and "Alpha Result" gone) — scope to the table so the
    // exact-name matcher asserts the rendered row, not aggregated parent text.
    // Wait until the second (held) request has actually arrived — the debounced
    // 'alphabet' query may not be in flight yet, in which case resolveSecond is
    // still null and resolving it would be a no-op (test would then time out).
    await waitFor(() => expect(resolveSecond).not.toBeNull())
    resolveSecond!()
    await waitFor(
      () => {
        expect(screen.getByText(exactName('Alphabet Result'))).toBeInTheDocument()
      },
      { timeout: 2500 }
    )
    expect(screen.queryByText(exactName('Alpha Result'))).not.toBeInTheDocument()
  })

  it('surfaces the "Looking for groups..." message during a slow search', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/api/groups/`, async ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) {
          await delay(300)
          return HttpResponse.json(paginate([createGroup({ id: 80, name: 'Slow Result' })]))
        }
        return HttpResponse.json(paginate(userGroups))
      })
    )

    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    await user.type(screen.getByLabelText('Search'), 'slow')

    // The fetching message (itself debounced ~100ms) appears mid-flight.
    await waitFor(
      () => {
        expect(screen.getByText('Looking for groups...')).toBeInTheDocument()
      },
      { timeout: 2500 }
    )

    await waitFor(
      () => {
        expect(screen.getByText('Slow Result')).toBeInTheDocument()
      },
      { timeout: 2500 }
    )
  })
})

describe('GroupsWidget — create modal', () => {
  it('opens the create-group modal when Add is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    expect(screen.queryByTestId('groups-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Add/i }))

    expect(screen.getByTestId('groups-modal')).toBeInTheDocument()
  })

  it('navigates to a newly created group via onGroupCreated', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GroupsWidget userGroups={userGroups} />)

    await user.click(screen.getByRole('button', { name: /Add/i }))

    // Simulate the modal reporting a created group.
    expect(lastOnGroupCreated).toBeTypeOf('function')
    lastOnGroupCreated?.(createGroup({ id: 555, name: 'Fresh Group' }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/app/groups/$groupId',
      params: { groupId: 555 },
    })
  })
})
