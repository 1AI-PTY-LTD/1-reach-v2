import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactMessageModal } from '../CustomerMessageModal'
import { createContact, createSchedule } from '../../../test/factories'
import { renderWithProviders } from '../../../test/test-utils'

describe('ContactMessageModal', () => {
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

  it('renders create mode title', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByText(/Create new message for Alice Smith/)).toBeInTheDocument()
  })

  it('renders edit mode title when message provided', () => {
    const message = createSchedule({ id: 1, text: 'Hello' })
    renderWithProviders(<ContactMessageModal {...defaultProps} message={message} />)
    expect(screen.getByText('Edit Message')).toBeInTheDocument()
  })

  it('shows template selector with Custom message option', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByText('Custom message')).toBeInTheDocument()
  })

  it('shows message textarea', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Enter your message/)).toBeInTheDocument()
  })

  it('shows character count', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactMessageModal {...defaultProps} />)

    const textarea = screen.getByPlaceholderText(/Enter your message/)
    await user.type(textarea, 'Hello world')

    expect(screen.getByText(/11 \/ 306 characters/)).toBeInTheDocument()
  })

  it('shows message parts as 0 for empty text', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByText(/0 of 2 message parts/)).toBeInTheDocument()
  })

  it('shows message parts as 1 for short text', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactMessageModal {...defaultProps} />)

    await user.type(screen.getByPlaceholderText(/Enter your message/), 'Hello')
    expect(screen.getByText(/1 of 2 message parts/)).toBeInTheDocument()
  })

  it('shows Create button in create mode', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('shows Update button in edit mode', () => {
    const message = createSchedule({ id: 1, text: 'Hello' })
    renderWithProviders(<ContactMessageModal {...defaultProps} message={message} />)
    expect(screen.getByText('Update')).toBeInTheDocument()
  })

  it('closes modal on cancel', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<ContactMessageModal {...defaultProps} setIsOpen={setIsOpen} />)

    await user.click(screen.getByText('Cancel'))
    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('shows scheduled time input', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} />)
    expect(screen.getByText('Scheduled Time *')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<ContactMessageModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText(/Create new message/)).not.toBeInTheDocument()
  })

  it('pre-fills message text in edit mode', () => {
    const message = createSchedule({ id: 1, text: 'Existing message text' })
    renderWithProviders(<ContactMessageModal {...defaultProps} message={message} />)
    expect(screen.getByDisplayValue('Existing message text')).toBeInTheDocument()
  })
})
