import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import {
  createContact,
  createInboundThreadItem,
  createOutboundThreadItem,
  createThreadResponse,
} from '../../test/factories'

// Mock TanStack Router: ConversationThread reads its param via Route.useParams()
// (from the object createFileRoute returns) and the layout uses navigation hooks.
const { mockNavigate, mockParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockParams: { current: { contactId: 1 } },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams.current,
  }),
  useParams: () => mockParams.current,
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a>{children}</a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => mockNavigate,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { ConversationThread } from '../app/_layout.inbox.$contactId'
import { InboxLayout } from '../app/_layout.inbox'

const BASE_URL = 'http://localhost:8000'

describe('InboxLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the conversation list from the API', async () => {
    renderWithProviders(<InboxLayout />)

    // Default MSW conversations: Alice (unread 2) and Bob.
    await waitFor(() => {
      expect(screen.getByTestId('conversation-list')).toBeInTheDocument()
    })
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
  })

  it('shows an error state when the list fails to load', async () => {
    server.use(
      http.get(`${BASE_URL}/api/conversations/`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 })
      )
    )

    renderWithProviders(<InboxLayout />)

    await waitFor(() => {
      expect(screen.getByText('Error loading conversations')).toBeInTheDocument()
    })
  })
})

describe('ConversationThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParams.current = { contactId: 1 }
  })

  it('renders interleaved bubbles oldest-at-top', async () => {
    renderWithProviders(<ConversationThread />)

    // Default MSW thread: outbound "Reply YES to confirm" then inbound "Yes please".
    await waitFor(() => {
      expect(screen.getByText('Yes please')).toBeInTheDocument()
    })
    expect(screen.getByText('Reply YES to confirm')).toBeInTheDocument()

    const scroll = screen.getByTestId('thread-scroll')
    const bubbles = scroll.querySelectorAll(
      '[data-testid="bubble-inbound"], [data-testid="bubble-outbound"]'
    )
    expect(bubbles).toHaveLength(2)
    // Oldest (outbound) first, newest (inbound reply) last.
    expect(bubbles[0]).toHaveAttribute('data-testid', 'bubble-outbound')
    expect(bubbles[1]).toHaveAttribute('data-testid', 'bubble-inbound')
  })

  it('marks unread replies read when the thread is viewed', async () => {
    let markReadCalls = 0
    server.use(
      http.get(`${BASE_URL}/api/conversations/:contactId/thread/`, () =>
        HttpResponse.json(
          createThreadResponse([
            createInboundThreadItem({ text: 'unread reply', read_at: null }),
          ])
        )
      ),
      http.post(`${BASE_URL}/api/conversations/:contactId/mark-read/`, () => {
        markReadCalls += 1
        return HttpResponse.json({ marked: 1 })
      })
    )

    renderWithProviders(<ConversationThread />)

    await waitFor(() => expect(markReadCalls).toBeGreaterThan(0))
  })

  it('does not mark read when every reply is already read', async () => {
    let markReadCalls = 0
    server.use(
      http.get(`${BASE_URL}/api/conversations/:contactId/thread/`, () =>
        HttpResponse.json(
          createThreadResponse([
            createInboundThreadItem({
              text: 'old reply',
              read_at: '2026-07-01T00:00:00Z',
            }),
          ])
        )
      ),
      http.post(`${BASE_URL}/api/conversations/:contactId/mark-read/`, () => {
        markReadCalls += 1
        return HttpResponse.json({ marked: 0 })
      })
    )

    renderWithProviders(<ConversationThread />)

    await waitFor(() => expect(screen.getByText('old reply')).toBeInTheDocument())
    expect(markReadCalls).toBe(0)
  })

  it('shows the contact header and the reply composer', async () => {
    renderWithProviders(<ConversationThread />)

    // MSW contact :id handler returns Alice Smith for id 1.
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Reply message')).toBeInTheDocument()
  })

  it('shows an empty state for a conversation with no messages', async () => {
    server.use(
      http.get(`${BASE_URL}/api/conversations/:contactId/thread/`, () =>
        HttpResponse.json(createThreadResponse([]))
      )
    )

    renderWithProviders(<ConversationThread />)

    await waitFor(() => {
      expect(
        screen.getByText('No messages in this conversation yet')
      ).toBeInTheDocument()
    })
  })

  it('renders outbound bubbles for raw-number sends too', async () => {
    server.use(
      http.get(`${BASE_URL}/api/conversations/:contactId/thread/`, () =>
        HttpResponse.json(
          createThreadResponse([
            createOutboundThreadItem({
              text: 'raw send', contact: null, contact_detail: null,
            }),
          ])
        )
      )
    )

    renderWithProviders(<ConversationThread />)

    await waitFor(() => expect(screen.getByText('raw send')).toBeInTheDocument())
  })
})
