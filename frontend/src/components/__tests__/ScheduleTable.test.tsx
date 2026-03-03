import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScheduleTable from '../ScheduleTable'
import { createSchedule } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'

// Mock ContactMessageModal to avoid prop mismatch in ScheduleDetails
vi.mock('../contacts/CustomerMessageModal', () => ({
  ContactMessageModal: () => null,
}))

const mockMessages = [
  createSchedule({
    id: 1,
    text: 'Hello Alice, this is a test message that is longer than forty characters for truncation testing',
    phone: '0412111222',
    status: 'pending',
    format: 'SMS',
    message_parts: 1,
    contact: 1,
    contact_detail: { id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111222', is_active: true, opt_out: false, created_at: '', updated_at: '' },
  }),
  createSchedule({
    id: 2,
    text: 'Short message',
    phone: '0412333444',
    status: 'sent',
    format: 'MMS',
    message_parts: 1,
    contact: 2,
    sent_time: '2026-01-15T10:30:00Z',
    contact_detail: { id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412333444', is_active: true, opt_out: false, created_at: '', updated_at: '' },
  }),
]

describe('ScheduleTable', () => {
  it('renders table headers', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Message')).toBeInTheDocument()
  })

  it('renders message rows with contact names', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
  })

  it('renders status badges for each message', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('sent')).toBeInTheDocument()
  })

  it('renders phone numbers with formatting', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('0412 111 222')).toBeInTheDocument()
    expect(screen.getByText('0412 333 444')).toBeInTheDocument()
  })

  it('renders message format (SMS/MMS)', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('SMS')).toBeInTheDocument()
    expect(screen.getByText('MMS')).toBeInTheDocument()
  })

  it('truncates long messages at 40 characters', () => {
    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    // Long message should be truncated
    expect(screen.getByText(/Hello Alice, this is a test message that/)).toBeInTheDocument()
    // Short message should be shown in full
    expect(screen.getByText('Short message')).toBeInTheDocument()
  })

  it('calls setSelectedMessageId when row is clicked', async () => {
    const setSelectedMessageId = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <ScheduleTable
        messages={mockMessages}
        selectedMessageId={undefined}
        setSelectedMessageId={setSelectedMessageId}
      />
    )

    await user.click(screen.getByText('Alice Smith'))
    expect(setSelectedMessageId).toHaveBeenCalledWith(1)
  })

  it('shows N/A for messages without contact details', () => {
    const messageNoContact = createSchedule({
      id: 10,
      text: 'No contact message',
      phone: '0412999888',
      contact_detail: null,
    })

    renderWithProviders(
      <ScheduleTable
        messages={[messageNoContact]}
        selectedMessageId={undefined}
        setSelectedMessageId={vi.fn()}
      />
    )

    expect(screen.getByText('N/A')).toBeInTheDocument()
  })
})
