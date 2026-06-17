import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleDetails } from '../ScheduleDetails'
import { createSchedule } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'
import type { ScheduleStatus } from '../../types/schedule.types'

const mockContactMessageModal = vi.fn().mockReturnValue(null)
vi.mock('../contacts/CustomerMessageModal', () => ({
  ContactMessageModal: (props: any) => mockContactMessageModal(props),
}))

const contactDetail = {
  id: 1,
  first_name: 'Alice',
  last_name: 'Smith',
  phone: '0412111222',
  is_active: true,
  opt_out: false,
  created_at: '',
  updated_at: '',
}

describe('ScheduleDetails', () => {
  beforeEach(() => {
    mockContactMessageModal.mockClear()
  })

  it('renders nothing when message is undefined', () => {
    const { container } = renderWithProviders(<ScheduleDetails message={undefined} />)
    expect(container.textContent).toBe('')
  })

  it('renders message text', () => {
    const message = createSchedule({
      text: 'Hello world message',
      contact: 1,
      contact_detail: contactDetail,
    })
    renderWithProviders(<ScheduleDetails message={message} />)

    expect(screen.getByText('Hello world message')).toBeInTheDocument()
  })

  describe('cancel button visibility', () => {
    it('shows Cancel button for pending messages', () => {
      const message = createSchedule({
        status: 'pending',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    const nonCancellableStatuses: ScheduleStatus[] = [
      'queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled', 'retrying',
    ]

    it.each(nonCancellableStatuses)(
      'does not show Cancel button for %s status',
      (status) => {
        const message = createSchedule({
          status,
          contact: 1,
          contact_detail: contactDetail,
        })
        renderWithProviders(<ScheduleDetails message={message} />)
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
      }
    )
  })

  describe('edit button visibility', () => {
    it('shows Edit button for future pending messages', () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString()
      const message = createSchedule({
        status: 'pending',
        scheduled_time: futureTime,
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('does not show Edit button for past pending messages', () => {
      const pastTime = new Date(Date.now() - 3600000).toISOString()
      const message = createSchedule({
        status: 'pending',
        scheduled_time: pastTime,
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    })

    it('does not show Edit button for non-pending statuses even if in future', () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString()
      const message = createSchedule({
        status: 'sent',
        scheduled_time: futureTime,
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    })
  })

  describe('cancel confirmation dialog', () => {
    it('opens confirmation dialog when Cancel is clicked', async () => {
      const user = userEvent.setup()
      const message = createSchedule({
        status: 'pending',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.getByText('Are you sure you want to cancel this message?')).toBeInTheDocument()
        expect(screen.getByText('The message will be cancelled and will not be sent.')).toBeInTheDocument()
      })
    })

    it('shows "No, keep it" and "Yes, cancel" buttons', async () => {
      const user = userEvent.setup()
      const message = createSchedule({
        status: 'pending',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.getByText('No, keep it')).toBeInTheDocument()
        expect(screen.getByText('Yes, cancel')).toBeInTheDocument()
      })
    })

    it('closes dialog when "No, keep it" is clicked', async () => {
      const user = userEvent.setup()
      const message = createSchedule({
        status: 'pending',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Cancel'))
      await waitFor(() => {
        expect(screen.getByText('Are you sure you want to cancel this message?')).toBeInTheDocument()
      })

      await user.click(screen.getByText('No, keep it'))
      await waitFor(() => {
        expect(screen.queryByText('Are you sure you want to cancel this message?')).not.toBeInTheDocument()
      })
    })
  })

  describe('contact support button', () => {
    it('shows Contact Support button for failed messages', () => {
      const message = createSchedule({
        status: 'failed',
        contact: 1,
        contact_detail: contactDetail,
        error: 'Number unreachable',
        failure_category: 'network_error',
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.getByText('Contact Support')).toBeInTheDocument()
    })

    const nonFailedStatuses: ScheduleStatus[] = [
      'pending', 'queued', 'processing', 'sent', 'delivered', 'cancelled', 'retrying',
    ]

    it.each(nonFailedStatuses)(
      'does not show Contact Support button for %s status',
      (status) => {
        const message = createSchedule({
          status,
          contact: 1,
          contact_detail: contactDetail,
        })
        renderWithProviders(<ScheduleDetails message={message} />)
        expect(screen.queryByText('Contact Support')).not.toBeInTheDocument()
      }
    )

    it('opens mailto link with message details when clicked', async () => {
      const user = userEvent.setup()
      let capturedHref = ''
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...originalLocation, set href(url: string) { capturedHref = url } },
      })

      const message = createSchedule({
        id: 42,
        status: 'failed',
        contact: 1,
        contact_detail: contactDetail,
        phone: '0412345678',
        error: 'Number unreachable',
        failure_category: 'network_error',
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Contact Support'))

      expect(capturedHref).toContain('mailto:support@1ai.net.au')
      expect(capturedHref).toContain('Failed%20Message%20%2342')
      expect(capturedHref).toContain('Number%20unreachable')

      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      })
    })
  })

  describe('edit modal', () => {
    it('does not render ContactMessageModal on initial render', () => {
      const message = createSchedule({ contact: 1, contact_detail: contactDetail })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(mockContactMessageModal).not.toHaveBeenCalled()
    })

    it('passes contact prop to ContactMessageModal when Edit is clicked', async () => {
      const user = userEvent.setup()
      const futureTime = new Date(Date.now() + 3600000).toISOString()
      const message = createSchedule({ contact: 1, contact_detail: contactDetail, scheduled_time: futureTime })
      renderWithProviders(<ScheduleDetails message={message} />)
      await user.click(screen.getByText('Edit'))
      expect(mockContactMessageModal).toHaveBeenCalledWith(
        expect.objectContaining({ contact: expect.objectContaining({ id: 1 }) })
      )
    })
  })

  describe('alphanumeric sender', () => {
    it('renders the Sender ID block when alphanumeric_sender is set', () => {
      const message = createSchedule({
        contact: 1,
        contact_detail: contactDetail,
        alphanumeric_sender: 'ACMECORP',
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      expect(screen.getByText('Sender ID:')).toBeInTheDocument()
      expect(screen.getByText('ACMECORP')).toBeInTheDocument()
    })

    it('does not render Sender ID block when alphanumeric_sender is absent', () => {
      const message = createSchedule({
        contact: 1,
        contact_detail: contactDetail,
        alphanumeric_sender: null,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      expect(screen.queryByText('Sender ID:')).not.toBeInTheDocument()
    })
  })

  describe('retry button visibility', () => {
    it('shows Retry button for failed messages', () => {
      const message = createSchedule({
        status: 'failed',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    const nonRetryableStatuses: ScheduleStatus[] = [
      'pending', 'queued', 'processing', 'sent', 'delivered', 'cancelled', 'retrying',
    ]

    it.each(nonRetryableStatuses)(
      'does not show Retry button for %s status',
      (status) => {
        const message = createSchedule({
          status,
          contact: 1,
          contact_detail: contactDetail,
        })
        renderWithProviders(<ScheduleDetails message={message} />)
        expect(screen.queryByText('Retry')).not.toBeInTheDocument()
      }
    )
  })

  describe('retry confirmation dialog', () => {
    it('opens retry confirmation dialog when Retry is clicked', async () => {
      const user = userEvent.setup()
      const message = createSchedule({
        status: 'failed',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Retry'))

      await waitFor(() => {
        expect(screen.getByText('Retry this message?')).toBeInTheDocument()
        expect(screen.getByText('The message will be re-queued for delivery.')).toBeInTheDocument()
        expect(screen.getByText('Yes, retry')).toBeInTheDocument()
      })
    })

    it('closes retry dialog when "No, keep it" is clicked', async () => {
      const user = userEvent.setup()
      const message = createSchedule({
        status: 'failed',
        contact: 1,
        contact_detail: contactDetail,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      await user.click(screen.getByText('Retry'))
      await waitFor(() => {
        expect(screen.getByText('Retry this message?')).toBeInTheDocument()
      })

      await user.click(screen.getByText('No, keep it'))
      await waitFor(() => {
        expect(screen.queryByText('Retry this message?')).not.toBeInTheDocument()
      })
    })
  })

  describe('batch parent recipients table', () => {
    it('renders the recipients table with status, name, phone, and error for batch parents', async () => {
      // The /recipients/ MSW handler returns three recipients: two sent and
      // one failed (see src/test/handlers.ts).
      const message = createSchedule({
        id: 7,
        contact: 1,
        contact_detail: contactDetail,
        recipient_count: 3,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      // Recipients arrive via the schedules/:id/recipients/ query.
      await waitFor(() => {
        expect(screen.getByText('Phone')).toBeInTheDocument()
      })

      // Column headers specific to the recipients table.
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Phone' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Error' })).toBeInTheDocument()

      // Per-recipient status badges from the handler payload.
      expect(screen.getAllByText('sent')).toHaveLength(2)
      expect(screen.getByText('failed')).toBeInTheDocument()

      // Phone numbers are reformatted with spaces.
      expect(screen.getByText('0412 111 111')).toBeInTheDocument()
    })

    it('does not render the recipients table for non-batch messages', () => {
      const message = createSchedule({
        contact: 1,
        contact_detail: contactDetail,
        recipient_count: 0,
      })
      renderWithProviders(<ScheduleDetails message={message} />)

      // No recipient column headers should be present.
      expect(screen.queryByRole('columnheader', { name: 'Phone' })).not.toBeInTheDocument()
    })
  })
})
