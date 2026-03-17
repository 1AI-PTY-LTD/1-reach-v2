import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleDetails } from '../ScheduleDetails'
import { createSchedule } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'

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

  it('shows edit and delete buttons for future pending messages', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString()
    const message = createSchedule({
      status: 'pending',
      scheduled_time: futureTime,
      contact: 1,
      contact_detail: contactDetail,
    })

    renderWithProviders(<ScheduleDetails message={message} />)

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })

  it('hides edit and delete buttons for past messages', () => {
    const pastTime = new Date(Date.now() - 3600000).toISOString()
    const message = createSchedule({
      status: 'pending',
      scheduled_time: pastTime,
      contact: 1,
      contact_detail: contactDetail,
    })

    renderWithProviders(<ScheduleDetails message={message} />)

    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('shows delete confirmation dialog', async () => {
    const user = userEvent.setup()
    const futureTime = new Date(Date.now() + 3600000).toISOString()
    const message = createSchedule({
      status: 'pending',
      scheduled_time: futureTime,
      contact: 1,
      contact_detail: contactDetail,
    })

    renderWithProviders(<ScheduleDetails message={message} />)

    await user.click(screen.getByText('Remove'))

    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this message?')).toBeInTheDocument()
    })
  })

  it('closes delete confirmation on cancel', async () => {
    const user = userEvent.setup()
    const futureTime = new Date(Date.now() + 3600000).toISOString()
    const message = createSchedule({
      status: 'pending',
      scheduled_time: futureTime,
      contact: 1,
      contact_detail: contactDetail,
    })

    renderWithProviders(<ScheduleDetails message={message} />)

    await user.click(screen.getByText('Remove'))
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this message?')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Cancel'))
    await waitFor(() => {
      expect(screen.queryByText('Are you sure you want to delete this message?')).not.toBeInTheDocument()
    })
  })

  it('does not render ContactMessageModal on initial render', () => {
    const message = createSchedule({ contact: 1, contact_detail: contactDetail })
    renderWithProviders(<ScheduleDetails message={message} />)
    expect(mockContactMessageModal).not.toHaveBeenCalled()
  })

  it('passes contact prop (not customer) to ContactMessageModal when Edit is clicked', async () => {
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
