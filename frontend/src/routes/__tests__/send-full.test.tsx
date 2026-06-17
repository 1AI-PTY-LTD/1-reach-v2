import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createContact, createGroup, paginate } from '../../test/factories'
import { SMS_MAX_LENGTH } from '../../lib/sms'

// #11 — Render the REAL Send route component and drive the primary send journey.
// The form uses no router hooks beyond <Link> (in the summary dialog), so the
// router mock only needs createFileRoute + a passthrough Link.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Link: ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => <a>{children}</a>,
}))

// Silence sonner toasts (no Toaster mounted in the test tree).
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { Send } from '../app/_layout.send'

const VALID_PHONE_A = '0412345678'
const VALID_PHONE_B = '0498765432'

function getRecipientInput() {
  return screen.getByPlaceholderText(/Start typing a phone number/i)
}

function getMessageTextarea() {
  return screen.getByPlaceholderText(/Enter your message or select a template/i)
}

describe('Send page — full journey (#11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds a recipient by typing a valid phone number and pressing Enter', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Send />)

    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), VALID_PHONE_A)
    await user.keyboard('{Enter}')

    expect(screen.getByText('Recipients: 1')).toBeInTheDocument()
    // The chip shows the raw phone when no contact name is attached.
    expect(screen.getByText(VALID_PHONE_A)).toBeInTheDocument()
  })

  it('rejects an invalid (landline) phone number', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Send />)

    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), '0212345678') // landline, not 04...
    await user.keyboard('{Enter}')

    expect(screen.getByText('Recipients: 0')).toBeInTheDocument()
  })

  it('rejects a duplicate phone number', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Send />)

    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    const input = getRecipientInput()
    await user.type(input, VALID_PHONE_A)
    await user.keyboard('{Enter}')
    expect(screen.getByText('Recipients: 1')).toBeInTheDocument()

    // Add the same number again (spacing differs but normalises to the same).
    await user.type(input, '0412 345 678')
    await user.keyboard('{Enter}')

    expect(screen.getByText('Recipients: 1')).toBeInTheDocument()
  })

  it('updates the character counter as the message is typed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Send />)

    await waitFor(() => expect(getMessageTextarea()).toBeInTheDocument())

    // The counter text is split across several JSX text nodes, so match on the
    // counter element's full normalized textContent (an exact match uniquely
    // identifies the leaf counter div, not its text-containing ancestors).
    const counterIsExactly = (expected: string) => (_: string, el: Element | null) =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').trim() === expected

    // Counter starts at 0 characters.
    expect(
      screen.getByText(counterIsExactly(`SMS · 0 / ${SMS_MAX_LENGTH} characters · 0 message parts`))
    ).toBeInTheDocument()

    await user.type(getMessageTextarea(), 'Hello there')

    await waitFor(() => {
      expect(
        screen.getByText(counterIsExactly(`SMS · 11 / ${SMS_MAX_LENGTH} characters · 1 message part`))
      ).toBeInTheDocument()
    })
  })

  it('adds a recipient by selecting a contact from search results', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('http://localhost:8000/api/contacts/', ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) {
          return HttpResponse.json(
            paginate([createContact({ id: 50, first_name: 'Zara', last_name: 'Quinn', phone: '0411222333' })])
          )
        }
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), 'Zara')

    // Option text renders the contact name + formatted phone.
    const option = await screen.findByText(/Zara Quinn/i, {}, { timeout: 3000 })
    await user.click(option)

    await waitFor(() => {
      expect(screen.getByText('Recipients: 1')).toBeInTheDocument()
    })
    expect(screen.getByText('Zara Quinn')).toBeInTheDocument()
  })

  it('expands a group into individual recipients (group vs individual switch)', async () => {
    const user = userEvent.setup()
    server.use(
      // Group search returns one group.
      http.get('http://localhost:8000/api/groups/', ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search) {
          return HttpResponse.json(paginate([createGroup({ id: 9, name: 'Wholesale', member_count: 2 })]))
        }
        return HttpResponse.json(paginate([]))
      }),
      // Contact search returns nothing so only the group option shows.
      http.get('http://localhost:8000/api/contacts/', () => HttpResponse.json(paginate([]))),
      // Group detail returns 2 members that get expanded into recipients.
      http.get('http://localhost:8000/api/groups/:id/', () =>
        HttpResponse.json({
          ...createGroup({ id: 9, name: 'Wholesale' }),
          members: [
            createContact({ id: 60, first_name: 'Mia', last_name: 'Lane', phone: '0411000111' }),
            createContact({ id: 61, first_name: 'Theo', last_name: 'Park', phone: '0411000222' }),
          ],
          pagination: { total: 2, page: 1, limit: 10000, totalPages: 1, hasNext: false, hasPrev: false },
        })
      )
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), 'Wholesale')

    const groupOption = await screen.findByText(/Wholesale/i, {}, { timeout: 3000 })
    await user.click(groupOption)

    await waitFor(() => {
      expect(screen.getByText('Recipients: 2')).toBeInTheDocument()
    })
    expect(screen.getByText('Mia Lane')).toBeInTheDocument()
    expect(screen.getByText('Theo Park')).toBeInTheDocument()
  })

  it('submits an SMS to the correct endpoint with the selected recipients', async () => {
    const user = userEvent.setup()
    let sentBody: any = null
    server.use(
      http.post('http://localhost:8000/api/sms/send/', async ({ request }) => {
        sentBody = await request.json()
        return HttpResponse.json(
          { success: true, message: 'queued', schedule_id: 1, total: 1, skipped_opted_out: 0 },
          { status: 202 }
        )
      })
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), VALID_PHONE_A)
    await user.keyboard('{Enter}')
    await user.type(getMessageTextarea(), 'Hello from the test')

    await user.click(screen.getByRole('button', { name: /Send Now/i }))

    await waitFor(() => {
      expect(sentBody).not.toBeNull()
    })
    expect(sentBody.message).toBe('Hello from the test')
    expect(sentBody.recipients).toEqual([{ phone: VALID_PHONE_A, contact_id: null }])

    // Success summary dialog appears.
    await waitFor(() => {
      expect(screen.getByText('Messages queued')).toBeInTheDocument()
    })
  })

  it('does not call send-mms when no image is uploaded', async () => {
    const user = userEvent.setup()
    const smsCall = vi.fn()
    const mmsCall = vi.fn()
    server.use(
      http.post('http://localhost:8000/api/sms/send/', () => {
        smsCall()
        return HttpResponse.json({ success: true, total: 1, skipped_opted_out: 0 }, { status: 202 })
      }),
      http.post('http://localhost:8000/api/sms/send-mms/', () => {
        mmsCall()
        return HttpResponse.json({ success: true, total: 1 }, { status: 202 })
      })
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), VALID_PHONE_B)
    await user.keyboard('{Enter}')
    await user.type(getMessageTextarea(), 'Plain SMS only')
    await user.click(screen.getByRole('button', { name: /Send Now/i }))

    await waitFor(() => expect(smsCall).toHaveBeenCalledTimes(1))
    expect(mmsCall).not.toHaveBeenCalled()
  })

  it('surfaces a 402 billing error returned by the API', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('http://localhost:8000/api/sms/send/', () =>
        HttpResponse.json({ detail: 'Insufficient credit balance to send this message.' }, { status: 402 })
      )
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), VALID_PHONE_A)
    await user.keyboard('{Enter}')
    await user.type(getMessageTextarea(), 'This should fail billing')
    await user.click(screen.getByRole('button', { name: /Send Now/i }))

    await waitFor(() => {
      expect(screen.getByText('Insufficient credit balance to send this message.')).toBeInTheDocument()
    })
  })

  it('surfaces a 400 validation error envelope returned by the API', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('http://localhost:8000/api/sms/send/', () =>
        HttpResponse.json(
          {
            recipients: {
              '0': { phone: ['Phone must be an Australian mobile number (04XXXXXXXX or +614XXXXXXXX).'] },
            },
          },
          { status: 400 }
        )
      )
    )

    renderWithProviders(<Send />)
    await waitFor(() => expect(getRecipientInput()).toBeInTheDocument())

    await user.type(getRecipientInput(), VALID_PHONE_A)
    await user.keyboard('{Enter}')
    await user.type(getMessageTextarea(), 'Trigger validation error')
    await user.click(screen.getByRole('button', { name: /Send Now/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Phone must be an Australian mobile number/i)
      ).toBeInTheDocument()
    })
  })
})
