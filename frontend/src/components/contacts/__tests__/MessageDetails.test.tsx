import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/handlers'
import { renderWithProviders } from '../../../test/test-utils'
import { createSchedule } from '../../../test/factories'
import { MessageDetails } from '../MessageDetails'

const BASE_URL = 'http://localhost:8000'

const future = () => new Date(Date.now() + 3600_000).toISOString()
const past = () => new Date(Date.now() - 3600_000).toISOString()

describe('MessageDetails', () => {
  it('renders the message text in the table', () => {
    const message = createSchedule({
      id: 1,
      text: 'Hello, your appointment is confirmed.',
      status: 'pending',
      scheduled_time: future(),
    })
    renderWithProviders(<MessageDetails message={message} />)

    expect(screen.getByText('Message')).toBeInTheDocument()
    expect(screen.getByText('Hello, your appointment is confirmed.')).toBeInTheDocument()
  })

  it('shows Edit and Remove buttons for a pending, future message', () => {
    const message = createSchedule({ id: 1, status: 'pending', scheduled_time: future() })
    renderWithProviders(<MessageDetails message={message} />)

    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
  })

  it('hides Edit/Remove for a message that has already been sent', () => {
    const message = createSchedule({ id: 2, status: 'sent', scheduled_time: past() })
    renderWithProviders(<MessageDetails message={message} />)

    expect(screen.getByText('Scheduled test message')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('hides Edit/Remove for a pending message whose scheduled time is in the past', () => {
    const message = createSchedule({ id: 1, status: 'pending', scheduled_time: past() })
    renderWithProviders(<MessageDetails message={message} />)

    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('opens the delete confirmation alert when Remove is clicked', async () => {
    const user = userEvent.setup()
    const message = createSchedule({ id: 1, status: 'pending', scheduled_time: future() })
    renderWithProviders(<MessageDetails message={message} />)

    await user.click(screen.getByRole('button', { name: /Remove/ }))

    expect(
      screen.getByText('Are you sure you want to delete this message?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The message will be removed from the list of messages.'),
    ).toBeInTheDocument()
  })

  it('dismisses the delete alert when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const message = createSchedule({ id: 1, status: 'pending', scheduled_time: future() })
    renderWithProviders(<MessageDetails message={message} />)

    await user.click(screen.getByRole('button', { name: /Remove/ }))
    expect(
      screen.getByText('Are you sure you want to delete this message?'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByText('Are you sure you want to delete this message?'),
      ).not.toBeInTheDocument()
    })
  })

  it('issues a delete (PUT) request when the Delete action is confirmed', async () => {
    const user = userEvent.setup()
    const putSpy = vi.fn()
    server.use(
      http.put(`${BASE_URL}/api/schedules/:id/`, async ({ params, request }) => {
        putSpy(Number(params.id), await request.json())
        return HttpResponse.json(createSchedule({ id: Number(params.id), status: 'cancelled' }))
      }),
    )

    const message = createSchedule({
      id: 1,
      contact: 42,
      status: 'pending',
      scheduled_time: future(),
    })
    renderWithProviders(<MessageDetails message={message} />)

    await user.click(screen.getByRole('button', { name: /Remove/ }))
    await user.click(screen.getByRole('button', { name: /Delete/ }))

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledWith(1, { contact_id: 42 })
    })

    // Alert closes after the delete resolves.
    await waitFor(() => {
      expect(
        screen.queryByText('Are you sure you want to delete this message?'),
      ).not.toBeInTheDocument()
    })
  })
})
