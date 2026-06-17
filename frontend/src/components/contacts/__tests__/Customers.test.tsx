import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import {
  renderWithProviders,
  screen,
  within,
  waitFor,
  userEvent,
} from '../../../test/test-utils'
import { server } from '../../../test/handlers'
import { createContact, paginate } from '../../../test/factories'

// ---------------------------------------------------------------------------
// Router mock.
//
// The REAL ContactsWidget (Customers.tsx) reads the selected contact id from
// `useRouterState({ select: (state) => state.location })` and then `.pathname`.
// Its rows (<TableRow to=.../>) render a router-aware <Link> via the ui/link
// wrapper, and the create-contact modal calls useNavigate. So the mock must
// supply useRouterState (honouring the `select` callback so we can drive the
// pathname per test), Link, and useNavigate — rather than re-creating any of
// those components.
// ---------------------------------------------------------------------------
const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { current: { pathname: '/app/contacts' } },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({
    select,
  }: {
    select?: (s: { location: { pathname: string } }) => unknown
  }) => (select ? select({ location: mockLocation.current }) : mockLocation.current),
  Link: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}))

// Keep the file-upload modal out of the tree — it has its own coverage and
// would otherwise add a hidden file input + query hooks to every render.
vi.mock('../UploadFileModal', () => ({ default: () => null }))

// Silence sonner toasts (no <Toaster/> is mounted in the test tree).
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import ContactsWidget from '../Customers'

const BASE_URL = 'http://localhost:8000'

const contacts = [
  createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
  createContact({ id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }),
  createContact({ id: 3, first_name: 'Charlie', last_name: 'Brown', phone: '0412333333' }),
]

function setPathname(pathname: string) {
  mockLocation.current = { pathname }
}

describe('ContactsWidget (Customers)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    setPathname('/app/contacts') // default: no contact selected
  })

  // -------------------------------------------------------------------------
  // Static initial render — the passed-in contacts list.
  // -------------------------------------------------------------------------
  describe('initial render', () => {
    it('renders the heading and the seeded contacts', () => {
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      expect(screen.getByText('Contacts')).toBeInTheDocument()
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
      expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
    })

    it('formats phone numbers as grouped digits', () => {
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      expect(screen.getByText('0412 111 111')).toBeInTheDocument()
      expect(screen.getByText('0412 222 222')).toBeInTheDocument()
      expect(screen.getByText('0412 333 333')).toBeInTheDocument()
    })

    it('shows the default search prompt before searching', async () => {
      renderWithProviders(<ContactsWidget contacts={contacts} />)
      // debouncedSearchMessage is itself debounced (100ms), so wait for it.
      expect(await screen.findByText('Min. 2 letters to start search')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Blank first/last-name fallback — names are optional on imported contacts
  // and the avatar initials must never crash on a blank one.
  // -------------------------------------------------------------------------
  describe('blank name fallback', () => {
    it('renders a "#" placeholder avatar when both names are blank', () => {
      const blank = createContact({ id: 9, first_name: '', last_name: '', phone: '0412999999' })
      renderWithProviders(<ContactsWidget contacts={[blank]} />)

      // initials fall back to '#' when first+last are empty
      expect(screen.getByText('#')).toBeInTheDocument()
      // still renders the (formatted) phone for the otherwise-nameless row
      expect(screen.getByText('0412 999 999')).toBeInTheDocument()
    })

    it('derives avatar initials from first+last name', () => {
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      expect(screen.getByText('AS')).toBeInTheDocument() // Alice Smith
      expect(screen.getByText('BJ')).toBeInTheDocument() // Bob Jones
      expect(screen.getByText('CB')).toBeInTheDocument() // Charlie Brown
    })

    it('uses just the first-name initial when the last name is blank', () => {
      const partial = createContact({ id: 7, first_name: 'Zoe', last_name: '', phone: '0412777777' })
      renderWithProviders(<ContactsWidget contacts={[partial]} />)

      expect(screen.getByText('Z')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Selected-contact highlighting — the row whose id matches the current
  // /app/contacts/:id pathname gets the `font-bold` modifier.
  // -------------------------------------------------------------------------
  describe('selected-contact highlighting', () => {
    it('bolds the row matching the contactId in the URL', () => {
      setPathname('/app/contacts/2') // Bob is selected
      const { container } = renderWithProviders(<ContactsWidget contacts={contacts} />)

      const bobRow = screen.getByText('Bob Jones').closest('tr')
      const aliceRow = screen.getByText('Alice Smith').closest('tr')

      expect(bobRow).toHaveClass('font-bold')
      expect(aliceRow).not.toHaveClass('font-bold')

      // exactly one row should be highlighted
      const boldRows = container.querySelectorAll('tr.font-bold')
      expect(boldRows).toHaveLength(1)
    })

    it('highlights no row when the path is not a contact detail page', () => {
      setPathname('/app/contacts')
      const { container } = renderWithProviders(<ContactsWidget contacts={contacts} />)

      expect(container.querySelectorAll('tr.font-bold')).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // Debounced search input + results-state transitions
  // (idle prompt -> loading -> results / empty).
  // -------------------------------------------------------------------------
  describe('debounced search', () => {
    it('does not query for a single character (min. 2 letters gate)', async () => {
      const searchCalls: string[] = []
      server.use(
        http.get(`${BASE_URL}/api/contacts/`, ({ request }) => {
          const search = new URL(request.url).searchParams.get('search')
          if (search !== null) searchCalls.push(search)
          return HttpResponse.json(paginate(contacts))
        }),
      )

      const user = userEvent.setup()
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      await user.type(screen.getByLabelText('Search'), 'A')
      expect(screen.getByLabelText('Search')).toHaveValue('A')

      // Give the 300ms debounce ample time; the query stays disabled at len < 2.
      await new Promise((r) => setTimeout(r, 400))
      expect(searchCalls).toHaveLength(0)
    })

    it('shows the loading message while a search is in flight, then the results', async () => {
      server.use(
        http.get(`${BASE_URL}/api/contacts/`, async ({ request }) => {
          const search = new URL(request.url).searchParams.get('search')
          if (search) {
            await delay(500) // keep isFetching true long enough to observe the loading copy
            return HttpResponse.json(
              paginate([createContact({ id: 50, first_name: 'Diana', last_name: 'Prince', phone: '0412505050' })]),
            )
          }
          return HttpResponse.json(paginate(contacts))
        }),
      )

      const user = userEvent.setup()
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      await user.type(screen.getByLabelText('Search'), 'Diana')

      // Loading state surfaces while fetching.
      expect(
        await screen.findByText('Looking for contacts...', {}, { timeout: 2000 }),
      ).toBeInTheDocument()

      // Then the server result replaces the rendered list.
      expect(await screen.findByText('Diana Prince', {}, { timeout: 2500 })).toBeInTheDocument()
      expect(screen.getByText('0412 505 050')).toBeInTheDocument()
      // The originally-seeded contacts are no longer shown.
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
    })

    it('shows the no-results message when the search returns nothing', async () => {
      server.use(
        http.get(`${BASE_URL}/api/contacts/`, ({ request }) => {
          const search = new URL(request.url).searchParams.get('search')
          if (search) return HttpResponse.json(paginate([]))
          return HttpResponse.json(paginate(contacts))
        }),
      )

      const user = userEvent.setup()
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      await user.type(screen.getByLabelText('Search'), 'Nobody')

      expect(await screen.findByText("Didn't find any contacts")).toBeInTheDocument()
      // empty-state copy appears once the (empty) search results take over
      expect(await screen.findByText('No contacts yet')).toBeInTheDocument()
      expect(
        screen.getByText('Click "Add" to create your first contact'),
      ).toBeInTheDocument()
    })

    it('replaces the seeded list with matching search results', async () => {
      const user = userEvent.setup()
      // Uses the default handler, which filters the global contacts list
      // (Alice/Bob/Charlie) by the search term.
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      await user.type(screen.getByLabelText('Search'), 'Alice')

      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument()
        expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
        expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Empty initial state — no contacts at all, no search running.
  // -------------------------------------------------------------------------
  describe('empty state', () => {
    it('shows the empty placeholder when there are no contacts', () => {
      renderWithProviders(<ContactsWidget contacts={[]} />)

      expect(screen.getByText('No contacts yet')).toBeInTheDocument()
      expect(
        screen.getByText('Click "Add" to create your first contact'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Create-contact modal wiring.
  // -------------------------------------------------------------------------
  describe('create modal', () => {
    it('opens the create-contact modal from the Add button', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ContactsWidget contacts={contacts} />)

      expect(screen.queryByText('Add new contact')).not.toBeInTheDocument()

      // The "Add" button is the one next to the heading (not "Add Contacts from file").
      await user.click(screen.getByRole('button', { name: 'Add' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Add new contact')).toBeInTheDocument()
    })
  })
})
