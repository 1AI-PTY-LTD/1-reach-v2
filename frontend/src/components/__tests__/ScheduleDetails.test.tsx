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
})
