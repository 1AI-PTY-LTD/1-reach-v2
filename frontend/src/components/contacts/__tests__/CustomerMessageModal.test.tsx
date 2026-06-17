import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  userEvent,
} from '../../../test/test-utils'
import { server } from '../../../test/handlers'
import { createContact, createSchedule } from '../../../test/factories'
import { ContactMessageModal } from '../CustomerMessageModal'

// NOTE: the file is named CustomerMessageModal.tsx but the real export is
// `ContactMessageModal` — a compose/schedule/send form modal (not a chat
// thread). These tests render the REAL component.

const BASE_URL = 'http://localhost:8000'

const contact = createContact({
  id: 1,
  first_name: 'Alice',
  last_name: 'Smith',
  phone: '0412111222',
})

const defaultProps = {
  contact,
  isOpen: true,
  setIsOpen: vi.fn(),
}

/**
 * The Scheduled Time field is a single `datetime-local` input (Headless UI
 * Label, so getByLabelText is unreliable — query by type instead). Returns the
 * one datetime-local input in the document.
 */
function getDateTimeInput(): HTMLInputElement {
  const input = document.querySelector(
    'input[type="datetime-local"]',
  ) as HTMLInputElement | null
  if (!input) throw new Error('datetime-local input not found')
  return input
}

/** Format a Date as the local `YYYY-MM-DDTHH:mm` string a datetime-local wants. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** Set the scheduled time `minutes` from now via the datetime-local input. */
function setScheduledMinutesFromNow(minutes: number) {
  const target = new Date(Date.now() + minutes * 60_000)
  fireEvent.change(getDateTimeInput(), {
    target: { value: toLocalInputValue(target) },
  })
}

describe('ContactMessageModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Display / thread state
  // ---------------------------------------------------------------------------
  describe('display', () => {
    it('renders create-mode title with the contact name', () => {
      renderWithProviders(<ContactMessageModal {...defaultProps} />)
      expect(
        screen.getByText('Create new message for Alice Smith'),
      ).toBeInTheDocument()
    })

    it('renders edit-mode title and pre-fills the existing message text', () => {
      const message = createSchedule({ id: 7, text: 'Existing message text' })
      renderWithProviders(
        <ContactMessageModal {...defaultProps} message={message} />,
      )
      expect(screen.getByText('Edit Message')).toBeInTheDocument()
      // The thread's current message content is shown in the textarea.
      expect(screen.getByDisplayValue('Existing message text')).toBeInTheDocument()
      expect(screen.getByText('Update')).toBeInTheDocument()
    })

    it('lists fetched templates plus the Custom message option', async () => {
      renderWithProviders(<ContactMessageModal {...defaultProps} />)
      expect(screen.getByText('Custom message')).toBeInTheDocument()
      // Templates come from GET /api/templates/ (Welcome + Reminder in handlers).
      expect(await screen.findByRole('option', { name: 'Welcome' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Reminder' })).toBeInTheDocument()
    })

    it('updates the character / message-parts counter as the user types', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ContactMessageModal {...defaultProps} />)

      // Empty state: 0 / 306 characters · 0 message parts.
      expect(screen.getByText(/0 \/ 306 characters/)).toBeInTheDocument()

      await user.type(screen.getByPlaceholderText(/Enter your message/), 'Hello world')
      expect(screen.getByText(/11 \/ 306 characters/)).toBeInTheDocument()
      expect(screen.getByText(/1 message part/)).toBeInTheDocument()
    })

    it('does not render its content when isOpen is false', () => {
      renderWithProviders(<ContactMessageModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByText(/Create new message/)).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Compose + send flow — endpoint selection
  // ---------------------------------------------------------------------------
  describe('compose + send flow', () => {
    it('selecting a template populates the textarea with its body', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ContactMessageModal {...defaultProps} />)

      // Wait for templates to load into the select.
      await screen.findByRole('option', { name: 'Welcome' })

      const select = screen.getByRole('combobox')
      await user.selectOptions(select, '1') // Welcome -> "Welcome to our service!"

      expect(screen.getByDisplayValue('Welcome to our service!')).toBeInTheDocument()
    })

    it('sends immediately via POST /api/sms/send/ when the time is within the delay window', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()

      let sentBody: any = null
      let smsCalled = false
      let schedulesCalled = false
      server.use(
        http.post(`${BASE_URL}/api/sms/send/`, async ({ request }) => {
          smsCalled = true
          sentBody = await request.json()
          return HttpResponse.json(
            { success: true, message: 'Message queued for delivery', schedule_id: 1 },
            { status: 202 },
          )
        }),
        http.post(`${BASE_URL}/api/schedules/`, async () => {
          schedulesCalled = true
          return HttpResponse.json(createSchedule({ id: 100 }), { status: 201 })
        }),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      await user.type(
        screen.getByPlaceholderText(/Enter your message/),
        'Send this right away',
      )
      // Future but within the 5-minute delay window => immediate send path.
      setScheduledMinutesFromNow(2)

      await user.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => expect(smsCalled).toBe(true))
      expect(schedulesCalled).toBe(false)
      expect(sentBody.message).toBe('Send this right away')
      expect(sentBody.recipients).toEqual([{ phone: '0412111222', contact_id: 1 }])

      // Successful send closes the modal.
      await waitFor(() => expect(setIsOpen).toHaveBeenCalledWith(false))
    })

    it('creates a scheduled message via POST /api/schedules/ for a future time', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()

      let scheduleBody: any = null
      let smsCalled = false
      server.use(
        http.post(`${BASE_URL}/api/sms/send/`, async () => {
          smsCalled = true
          return HttpResponse.json({ success: true, schedule_id: 9 }, { status: 202 })
        }),
        http.post(`${BASE_URL}/api/schedules/`, async ({ request }) => {
          scheduleBody = await request.json()
          return HttpResponse.json(createSchedule({ id: 100 }), { status: 201 })
        }),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      await user.type(
        screen.getByPlaceholderText(/Enter your message/),
        'Schedule for later',
      )
      // Well into the future => scheduled (not immediate) path.
      setScheduledMinutesFromNow(120)

      await user.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => expect(scheduleBody).not.toBeNull())
      expect(smsCalled).toBe(false)
      expect(scheduleBody.contact_id).toBe(1)
      expect(scheduleBody.phone).toBe('0412111222')
      expect(scheduleBody.text).toBe('Schedule for later')

      await waitFor(() => expect(setIsOpen).toHaveBeenCalledWith(false))
    })

    it('updates an existing message via PUT /api/schedules/:id/ in edit mode', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      const message = createSchedule({
        id: 42,
        text: 'Original text',
        contact: 1,
        scheduled_time: new Date(Date.now() + 7200000).toISOString(),
      })

      let putPath = ''
      let putBody: any = null
      server.use(
        http.put(`${BASE_URL}/api/schedules/:id/`, async ({ params, request }) => {
          putPath = String(params.id)
          putBody = await request.json()
          return HttpResponse.json({ ...message, ...(putBody as object) })
        }),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} message={message} setIsOpen={setIsOpen} />,
      )

      const textarea = screen.getByDisplayValue('Original text')
      await user.clear(textarea)
      await user.type(textarea, 'Edited text')

      await user.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => expect(putBody).not.toBeNull())
      expect(putPath).toBe('42')
      expect(putBody.text).toBe('Edited text')

      await waitFor(() => expect(setIsOpen).toHaveBeenCalledWith(false))
    })

    it('does not send and keeps the modal open when both template and text are empty', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()

      let smsCalled = false
      let schedulesCalled = false
      server.use(
        http.post(`${BASE_URL}/api/sms/send/`, () => {
          smsCalled = true
          return HttpResponse.json({ success: true }, { status: 202 })
        }),
        http.post(`${BASE_URL}/api/schedules/`, () => {
          schedulesCalled = true
          return HttpResponse.json(createSchedule({ id: 100 }), { status: 201 })
        }),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      // Leave text empty entirely, submit immediately.
      setScheduledMinutesFromNow(2)
      await user.click(screen.getByRole('button', { name: 'Create' }))

      // The guard returns early before any network call and the modal stays open.
      await waitFor(() => expect(getDateTimeInput()).toBeInTheDocument())
      expect(smsCalled).toBe(false)
      expect(schedulesCalled).toBe(false)
      expect(setIsOpen).not.toHaveBeenCalledWith(false)
    })

    it('closes the modal without sending when Cancel is clicked', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(setIsOpen).toHaveBeenCalledWith(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Error path
  // ---------------------------------------------------------------------------
  describe('error path', () => {
    it('surfaces the API error and keeps the modal open when the immediate send fails', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()

      server.use(
        http.post(`${BASE_URL}/api/sms/send/`, () =>
          HttpResponse.json(
            { error: 'Insufficient credit balance' },
            { status: 402 },
          ),
        ),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      await user.type(
        screen.getByPlaceholderText(/Enter your message/),
        'This will fail',
      )
      setScheduledMinutesFromNow(2)

      await user.click(screen.getByRole('button', { name: 'Create' }))

      // The red error banner appears with its "Error" heading and the
      // server-provided message.
      expect(await screen.findByText('Insufficient credit balance')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Error' })).toBeInTheDocument()

      // Modal stays open so the user can correct and retry.
      expect(setIsOpen).not.toHaveBeenCalledWith(false)
    })

    it('surfaces the API error when a scheduled create fails', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()

      server.use(
        http.post(`${BASE_URL}/api/schedules/`, () =>
          HttpResponse.json({ error: 'Scheduling is temporarily unavailable' }, { status: 500 }),
        ),
      )

      renderWithProviders(
        <ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />,
      )

      await user.type(
        screen.getByPlaceholderText(/Enter your message/),
        'Schedule that will fail',
      )
      setScheduledMinutesFromNow(120)

      await user.click(screen.getByRole('button', { name: 'Create' }))

      expect(
        await screen.findByText('Scheduling is temporarily unavailable'),
      ).toBeInTheDocument()
      expect(setIsOpen).not.toHaveBeenCalledWith(false)
    })
  })
})
