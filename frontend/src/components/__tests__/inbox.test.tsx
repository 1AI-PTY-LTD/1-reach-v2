import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import {
  createContact,
  createConversation,
  createInboundThreadItem,
  createOutboundThreadItem,
} from '../../test/factories'

// ConversationList renders TanStack Links; keep them as plain anchors.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a>{children}</a>
  ),
}))

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: mockToast }))

import { ConversationList } from '../inbox/ConversationList'
import { MessageBubble } from '../inbox/MessageBubble'
import { ReplyComposer } from '../inbox/ReplyComposer'

const BASE_URL = 'http://localhost:8000'

describe('ConversationList', () => {
  it('renders one row per conversation with preview and unread badge', () => {
    const conversations = [
      createConversation({
        contact_id: 1,
        contact_detail: createContact({ first_name: 'Alice', last_name: 'Smith' }),
        last_inbound_text: 'Yes please',
        unread_count: 3,
      }),
      createConversation({
        contact_id: 2,
        contact_detail: createContact({ first_name: 'Bob', last_name: 'Jones' }),
        last_inbound_text: 'No thanks',
        unread_count: 0,
      }),
    ]

    renderWithProviders(<ConversationList conversations={conversations} />)

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Yes please')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    const badges = screen.getAllByTestId('unread-badge')
    expect(badges).toHaveLength(1) // only unread conversations get a badge
    expect(badges[0]).toHaveTextContent('3')
  })

  it('falls back to the phone number for auto-created blank-name contacts', () => {
    const conversations = [
      createConversation({
        contact_detail: createContact({
          first_name: '', last_name: '', phone: '0498888888',
        }),
      }),
    ]

    renderWithProviders(<ConversationList conversations={conversations} />)

    expect(screen.getAllByText('0498 888 888').length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no conversations', () => {
    renderWithProviders(<ConversationList conversations={[]} />)
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument()
  })
})

describe('MessageBubble', () => {
  it('renders inbound messages on the left with the reply text', () => {
    renderWithProviders(
      <MessageBubble item={createInboundThreadItem({ text: 'A reply' })} />
    )

    expect(screen.getByTestId('bubble-inbound')).toBeInTheDocument()
    expect(screen.getByText('A reply')).toBeInTheDocument()
  })

  it('renders outbound messages with a status badge', () => {
    renderWithProviders(
      <MessageBubble
        item={createOutboundThreadItem({ text: 'Hello there', status: 'delivered' })}
      />
    )

    expect(screen.getByTestId('bubble-outbound')).toBeInTheDocument()
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('delivered')).toBeInTheDocument()
  })

  it('flags opt-out replies', () => {
    renderWithProviders(
      <MessageBubble
        item={createInboundThreadItem({ text: 'STOP', is_opt_out: true })}
      />
    )

    expect(screen.getByText('Opted out')).toBeInTheDocument()
  })
})

describe('ReplyComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the reply as a two-way SMS to the contact', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post(`${BASE_URL}/api/sms/send/`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { success: true, message: 'queued', schedule_id: 42 },
          { status: 202 }
        )
      })
    )
    const contact = createContact({ id: 9, phone: '0412345678' })
    const user = userEvent.setup()

    renderWithProviders(<ReplyComposer contact={contact} />)
    await user.type(screen.getByLabelText('Reply message'), 'On my way')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody).toMatchObject({
      message: 'On my way',
      recipients: [{ phone: '0412345678', contact_id: 9 }],
      two_way: true,
    })
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('shows the segment counter as the message grows', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ReplyComposer contact={createContact()} />)

    await user.type(screen.getByLabelText('Reply message'), 'Short')

    expect(screen.getByText(/5\/306 characters · 1 segment/)).toBeInTheDocument()
  })

  it('disables sending for opted-out contacts', () => {
    renderWithProviders(
      <ReplyComposer contact={createContact({ opt_out: true })} />
    )

    expect(screen.getByTestId('composer-opted-out')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('disables the send button while the message is empty', () => {
    renderWithProviders(<ReplyComposer contact={createContact()} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('surfaces send failures as an error toast', async () => {
    server.use(
      http.post(`${BASE_URL}/api/sms/send/`, () =>
        HttpResponse.json({ detail: 'Insufficient credits.' }, { status: 402 })
      )
    )
    const user = userEvent.setup()

    renderWithProviders(<ReplyComposer contact={createContact()} />)
    await user.type(screen.getByLabelText('Reply message'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
  })
})
