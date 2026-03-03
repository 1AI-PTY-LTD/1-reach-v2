import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactModal } from '../CustomerModal'
import { createContact } from '../../../test/factories'
import { renderWithProviders } from '../../../test/test-utils'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

describe('ContactModal', () => {
  const defaultProps = {
    isOpen: true,
    setIsOpen: vi.fn(),
  }

  it('renders create mode title when no contact', () => {
    renderWithProviders(<ContactModal {...defaultProps} />)
    expect(screen.getByText('Add new contact')).toBeInTheDocument()
  })

  it('renders edit mode title when contact provided', () => {
    const contact = createContact({ first_name: 'Alice', last_name: 'Smith' })
    renderWithProviders(<ContactModal {...defaultProps} contact={contact} />)
    expect(screen.getByText('Edit contact details')).toBeInTheDocument()
  })

  it('renders empty form in create mode', () => {
    renderWithProviders(<ContactModal {...defaultProps} />)

    expect(screen.getByPlaceholderText('First Name')).toHaveValue('')
    expect(screen.getByPlaceholderText('Last Name')).toHaveValue('')
    expect(screen.getByPlaceholderText('0412 345 678')).toHaveValue('')
  })

  it('pre-fills form in edit mode', () => {
    const contact = createContact({
      first_name: 'Alice',
      last_name: 'Smith',
      phone: '0412345678',
    })
    renderWithProviders(<ContactModal {...defaultProps} contact={contact} />)

    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Smith')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0412 345 678')).toBeInTheDocument()
  })

  it('formats phone number as user types', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactModal {...defaultProps} />)

    const phoneInput = screen.getByPlaceholderText('0412 345 678')
    await user.type(phoneInput, '0412345678')

    await waitFor(() => {
      expect(phoneInput).toHaveValue('0412 345 678')
    })
  })

  it('shows Create button in create mode', () => {
    renderWithProviders(<ContactModal {...defaultProps} />)
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('shows Update button in edit mode', () => {
    const contact = createContact()
    renderWithProviders(<ContactModal {...defaultProps} contact={contact} />)
    expect(screen.getByText('Update')).toBeInTheDocument()
  })

  it('closes modal on cancel', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<ContactModal isOpen={true} setIsOpen={setIsOpen} />)

    await user.click(screen.getByText('Cancel'))
    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('shows validation error for short first name on submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactModal {...defaultProps} />)

    await user.type(screen.getByPlaceholderText('First Name'), 'A')
    await user.type(screen.getByPlaceholderText('Last Name'), 'Smith')
    await user.type(screen.getByPlaceholderText('0412 345 678'), '0412345678')
    await user.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(screen.getByText(/First Name has to be at least 2 characters/)).toBeInTheDocument()
    })
  })

  it('shows validation error for invalid phone on submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactModal {...defaultProps} />)

    await user.type(screen.getByPlaceholderText('First Name'), 'Alice')
    await user.type(screen.getByPlaceholderText('Last Name'), 'Smith')
    await user.type(screen.getByPlaceholderText('0412 345 678'), '12345')
    await user.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(screen.getByText(/valid Australian mobile number/)).toBeInTheDocument()
    })
  })

  it('submits create form with valid data', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<ContactModal isOpen={true} setIsOpen={setIsOpen} />)

    await user.type(screen.getByPlaceholderText('First Name'), 'Alice')
    await user.type(screen.getByPlaceholderText('Last Name'), 'Smith')
    await user.type(screen.getByPlaceholderText('0412 345 678'), '0412345678')
    await user.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(setIsOpen).toHaveBeenCalledWith(false)
    })
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<ContactModal isOpen={false} setIsOpen={vi.fn()} />)
    expect(screen.queryByText('Add new contact')).not.toBeInTheDocument()
  })
})
