import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { http, HttpResponse } from 'msw'
import GroupScheduleModal from '../GroupScheduleModal'
import { renderWithProviders } from '../../../test/test-utils'
import { server } from '../../../test/handlers'
import { createGroupSchedule } from '../../../test/factories'
import { toast } from 'sonner'

// Silence sonner toasts (no Toaster mounted in the test tree) and let us assert
// success/error notifications.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const BASE_URL = 'http://localhost:8000'

const mockToast = vi.mocked(toast)

const GROUP_ID = 1

// The component renders a <input type="datetime-local"> with no accessible name.
// The modal is a Headless UI Dialog that PORTALS its content to document.body, so
// it lives outside the render container — we reach for it via the document.
function getDateTimeInput(): HTMLInputElement {
  const input = document.querySelector(
    'input[type="datetime-local"]',
  ) as HTMLInputElement | null
  if (!input) throw new Error('datetime-local input not found')
  return input
}

// Set the schedule time to a fixed future instant (well beyond the immediate
// send window) so create flows hit the scheduled POST path, not the immediate
// send-to-group path. The picker's onChange does `new Date(local).toISOString()`,
// so we feed it a local "YYYY-MM-DDTHH:mm" value.
function setFutureScheduledTime(daysAhead = 3) {
  const input = getDateTimeInput()
  const futureLocal = dayjs().add(daysAhead, 'day').format('YYYY-MM-DDTHH:mm')
  fireEvent.change(input, { target: { value: futureLocal } })
}

function getSubmitButton(): HTMLButtonElement {
  // The submit button is the only one with type="submit" wired to the form.
  const buttons = screen.getAllByRole('button')
  const submit = buttons.find((b) => b.getAttribute('type') === 'submit')
  if (!submit) throw new Error('submit button not found')
  return submit as HTMLButtonElement
}

function getMessageTextarea() {
  return screen.getByPlaceholderText(
    /Enter your message text or select a template above/,
  )
}

// The form (with the datetime picker, template select and message textarea) only
// renders once both the templates and (in edit mode) the schedule have loaded.
async function waitForForm() {
  await screen.findByPlaceholderText(
    /Enter your message text or select a template above/,
  )
}

describe('GroupScheduleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering / create-vs-edit mode', () => {
    it('does not render dialog content when closed', () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={false} setIsOpen={vi.fn()} />,
      )
      expect(
        screen.queryByText(/Create new message for the group/),
      ).not.toBeInTheDocument()
    })

    it('renders create-mode heading and Create button when no groupScheduleId', async () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      expect(
        await screen.findByText(/Create new message for the group/),
      ).toBeInTheDocument()
      // Templates finish loading -> form (and Create button) renders.
      await waitFor(() => {
        expect(getSubmitButton()).toHaveTextContent('Create')
      })
    })

    it('renders edit-mode heading and Update button when groupScheduleId provided', async () => {
      server.use(
        http.get(`${BASE_URL}/api/group-schedules/:id/`, ({ params }) =>
          HttpResponse.json(
            createGroupSchedule({
              id: Number(params.id),
              text: 'Existing group text',
              template: null,
              scheduled_time: dayjs().add(2, 'day').toISOString(),
            }),
          ),
        ),
      )

      renderWithProviders(
        <GroupScheduleModal
          groupId={GROUP_ID}
          groupScheduleId={42}
          isOpen={true}
          setIsOpen={vi.fn()}
        />,
      )

      expect(await screen.findByText('Edit message for the group')).toBeInTheDocument()
      await waitFor(() => {
        expect(getSubmitButton()).toHaveTextContent('Update')
      })
    })

    it('pre-fills the message text from the existing schedule in edit mode', async () => {
      server.use(
        http.get(`${BASE_URL}/api/group-schedules/:id/`, ({ params }) =>
          HttpResponse.json(
            createGroupSchedule({
              id: Number(params.id),
              text: 'Hello existing recipients',
              template: null,
              scheduled_time: dayjs().add(2, 'day').toISOString(),
            }),
          ),
        ),
      )

      renderWithProviders(
        <GroupScheduleModal
          groupId={GROUP_ID}
          groupScheduleId={7}
          isOpen={true}
          setIsOpen={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('Hello existing recipients')).toBeInTheDocument()
      })
    })

    it('shows a loading spinner while templates are loading, then the form', async () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      // Loading indicator appears before the templates query resolves.
      expect(screen.getByText('Loading...')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      expect(
        getMessageTextarea(),
      ).toBeInTheDocument()
    })

    it('lists templates from the API as <option>s in the template select', async () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      // Handlers seed "Welcome" and "Reminder" templates.
      await waitFor(() => {
        expect(
          screen.getByRole('option', { name: 'Welcome' }),
        ).toBeInTheDocument()
      })
      expect(screen.getByRole('option', { name: 'Reminder' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Custom message' })).toBeInTheDocument()
    })
  })

  describe('template OR free text validation', () => {
    it('does not call any mutation or close when both template and text are empty', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      let createCalled = false
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          createCalled = true
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      // Provide a valid future time but leave both template + text empty.
      setFutureScheduledTime()

      await user.click(getSubmitButton())

      // The submit handler bails out early: no toast, no close, no POST.
      await waitFor(() => {
        expect(getSubmitButton()).toHaveTextContent('Create')
      })
      expect(setIsOpen).not.toHaveBeenCalled()
      expect(mockToast.success).not.toHaveBeenCalled()
      expect(createCalled).toBe(false)
    })

    it('proceeds when free text is supplied without a template', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      const createBodies: Record<string, unknown>[] = []
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          createBodies.push(body)
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      setFutureScheduledTime()
      await user.type(
        getMessageTextarea(),
        'A custom free-text message',
      )

      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(createBodies).toHaveLength(1)
      expect(createBodies[0]).toMatchObject({
        group_id: GROUP_ID,
        text: 'A custom free-text message',
      })
    })

    it('proceeds when a template is selected without typed free text', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      const createBodies: Record<string, unknown>[] = []
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          createBodies.push(body)
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      setFutureScheduledTime()

      // Selecting a template auto-populates the message text field with the
      // template body ("Welcome" -> "Welcome to our service!"). The form is
      // portaled to document.body by the Headless UI Dialog, so query the document.
      const select = document.querySelector(
        'select[name="template_id"]',
      ) as HTMLSelectElement
      await user.selectOptions(select, '1')

      await waitFor(() => {
        expect(
          screen.getByDisplayValue('Welcome to our service!'),
        ).toBeInTheDocument()
      })

      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(createBodies).toHaveLength(1)
      expect(createBodies[0]).toMatchObject({
        group_id: GROUP_ID,
        template_id: 1,
      })
    })
  })

  describe('submit button enabled/disabled state', () => {
    it('disables submit when the scheduled time is in the past', async () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      await waitFor(() => expect(getSubmitButton()).toBeEnabled())

      // Force a clearly-past schedule time.
      const input = getDateTimeInput()
      const pastLocal = dayjs().subtract(2, 'day').format('YYYY-MM-DDTHH:mm')
      fireEvent.change(input, { target: { value: pastLocal } })

      await waitFor(() => {
        expect(getSubmitButton()).toBeDisabled()
      })
      // The picker surfaces the past-time warning copy too.
      expect(
        screen.getByText(/A message can't be scheduled for a time in the past/),
      ).toBeInTheDocument()
    })

    it('keeps submit enabled for a valid future schedule time', async () => {
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      await waitForForm()
      setFutureScheduledTime()

      await waitFor(() => {
        expect(getSubmitButton()).toBeEnabled()
      })
    })
  })

  describe('successful submit calls the right mutation', () => {
    it('creates a scheduled group message (PUT not used) for a future time', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      let createCalled = false
      let immediateCalled = false
      let updateCalled = false
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          createCalled = true
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
        http.post(`${BASE_URL}/api/sms/send-to-group/`, () => {
          immediateCalled = true
          return HttpResponse.json({ success: true }, { status: 202 })
        }),
        http.put(`${BASE_URL}/api/group-schedules/:id/`, () => {
          updateCalled = true
          return HttpResponse.json(createGroupSchedule({ id: 1 }))
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      setFutureScheduledTime()
      await user.type(
        getMessageTextarea(),
        'Scheduled-for-later message',
      )

      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(createCalled).toBe(true)
      expect(immediateCalled).toBe(false)
      expect(updateCalled).toBe(false)
      expect(mockToast.success).toHaveBeenCalledWith('Message scheduled')
    })

    it('sends immediately via send-to-group when the schedule time is within the delay window', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      let createCalled = false
      const immediateBodies: Record<string, unknown>[] = []
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          createCalled = true
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
        http.post(`${BASE_URL}/api/sms/send-to-group/`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          immediateBodies.push(body)
          // sendSmsToGroup reads data.group_name + data.results.{successful,failed,total}
          // after the POST, so the mock must return the full SendGroupSmsResponse shape
          // or the success path throws before setIsOpen(false).
          return HttpResponse.json(
            {
              group_name: 'Test Group',
              results: { successful: 1, failed: 0, total: 1 },
            },
            { status: 202 },
          )
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      // A time "now" is within the immediate window but NOT in the past, so
      // submit stays enabled and the immediate send path runs.
      const input = getDateTimeInput()
      const nowLocal = dayjs().add(1, 'minute').format('YYYY-MM-DDTHH:mm')
      fireEvent.change(input, { target: { value: nowLocal } })

      await user.type(
        getMessageTextarea(),
        'Send me right now',
      )

      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(createCalled).toBe(false)
      expect(immediateBodies).toHaveLength(1)
      expect(immediateBodies[0]).toMatchObject({
        group_id: GROUP_ID,
        message: 'Send me right now',
      })
      expect(mockToast.success).toHaveBeenCalledWith('Message scheduled')
    })

    it('updates an existing schedule via PUT in edit mode', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      const putBodies: Record<string, unknown>[] = []
      let createCalled = false
      let immediateCalled = false
      server.use(
        http.get(`${BASE_URL}/api/group-schedules/:id/`, ({ params }) =>
          HttpResponse.json(
            createGroupSchedule({
              id: Number(params.id),
              text: 'Original edit text',
              template: null,
              scheduled_time: dayjs().add(2, 'day').toISOString(),
            }),
          ),
        ),
        http.put(`${BASE_URL}/api/group-schedules/:id/`, async ({ params, request }) => {
          const body = (await request.json()) as Record<string, unknown>
          putBodies.push(body)
          return HttpResponse.json(createGroupSchedule({ id: Number(params.id), ...body }))
        }),
        http.post(`${BASE_URL}/api/group-schedules/`, () => {
          createCalled = true
          return HttpResponse.json(createGroupSchedule({ id: 100 }), { status: 201 })
        }),
        http.post(`${BASE_URL}/api/sms/send-to-group/`, () => {
          immediateCalled = true
          return HttpResponse.json({ success: true }, { status: 202 })
        }),
      )

      renderWithProviders(
        <GroupScheduleModal
          groupId={GROUP_ID}
          groupScheduleId={55}
          isOpen={true}
          setIsOpen={setIsOpen}
        />,
      )

      // Wait for the existing schedule text to populate.
      await waitFor(() => {
        expect(screen.getByDisplayValue('Original edit text')).toBeInTheDocument()
      })

      // Edit the message text.
      const textarea = getMessageTextarea()
      await user.clear(textarea)
      await user.type(textarea, 'Updated edit text')

      // Keep a valid future time (already future from the fixture, but re-set to
      // be safe against clock drift in the populated default).
      setFutureScheduledTime()

      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(putBodies).toHaveLength(1)
      expect(putBodies[0]).toMatchObject({ text: 'Updated edit text' })
      // Edit mode always uses PUT — never the create or immediate-send paths.
      expect(createCalled).toBe(false)
      expect(immediateCalled).toBe(false)
      expect(mockToast.success).toHaveBeenCalledWith('Message updated')
    })
  })

  describe('server error surfacing', () => {
    it('surfaces a server error body and shows the error toast on create failure', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, () =>
          HttpResponse.json(
            { error: 'Group has no active members' },
            { status: 400 },
          ),
        ),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      setFutureScheduledTime()
      await user.type(
        getMessageTextarea(),
        'Will fail on the server',
      )

      await user.click(getSubmitButton())

      // The error banner inside the dialog surfaces the server message...
      await waitFor(() => {
        expect(screen.getByText('Group has no active members')).toBeInTheDocument()
      })
      // ...and is labelled as an Error, with the error toast fired.
      expect(screen.getByText('Error')).toBeInTheDocument()
      expect(mockToast.error).toHaveBeenCalledWith('Group has no active members')
      // The modal stays open on failure.
      expect(setIsOpen).not.toHaveBeenCalled()
    })

    it('falls back to a generic message when the server returns no error detail', async () => {
      const user = userEvent.setup()
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, () =>
          HttpResponse.json({}, { status: 500 }),
        ),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={vi.fn()} />,
      )

      await waitForForm()

      setFutureScheduledTime()
      await user.type(
        getMessageTextarea(),
        'Server explodes',
      )

      await user.click(getSubmitButton())

      // ApiClient builds "API error: 500" for an empty error body; the component
      // surfaces it via error.message.
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled()
      })
      const banner = await screen.findByText(/API error: 500/)
      expect(banner).toBeInTheDocument()
    })

    it('clears a previously shown error after a subsequent successful submit', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      let shouldFail = true
      server.use(
        http.post(`${BASE_URL}/api/group-schedules/`, async ({ request }) => {
          if (shouldFail) {
            return HttpResponse.json({ error: 'Temporary failure' }, { status: 400 })
          }
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            createGroupSchedule({ id: 100, name: body.name as string }),
            { status: 201 },
          )
        }),
      )

      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      setFutureScheduledTime()
      await user.type(
        getMessageTextarea(),
        'Retry me',
      )

      // First submit fails -> banner shows.
      await user.click(getSubmitButton())
      await waitFor(() => {
        expect(screen.getByText('Temporary failure')).toBeInTheDocument()
      })

      // Flip the server to succeed, then resubmit.
      shouldFail = false
      await user.click(getSubmitButton())

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })
      expect(screen.queryByText('Temporary failure')).not.toBeInTheDocument()
    })
  })

  describe('cancel', () => {
    it('closes the modal when Cancel is clicked', async () => {
      const user = userEvent.setup()
      const setIsOpen = vi.fn()
      renderWithProviders(
        <GroupScheduleModal groupId={GROUP_ID} isOpen={true} setIsOpen={setIsOpen} />,
      )

      await waitForForm()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(setIsOpen).toHaveBeenCalledWith(false)
    })
  })
})
