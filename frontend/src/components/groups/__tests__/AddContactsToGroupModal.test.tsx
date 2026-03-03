import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddContactsToGroupModal } from '../AddContactsToGroupModal'
import { renderWithProviders } from '../../../test/test-utils'

describe('AddContactsToGroupModal', () => {
  const defaultProps = {
    groupId: 1,
    isOpen: true,
    setIsOpen: vi.fn(),
  }

  it('renders modal title', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)
    expect(screen.getByText('Select Contacts To Add')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)
    expect(screen.getByPlaceholderText('Search contacts...')).toBeInTheDocument()
  })

  it('shows 0 contacts selected initially', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)
    expect(screen.getByText('0 contacts selected')).toBeInTheDocument()
  })

  it('shows Add 0 Contacts button (disabled) initially', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)
    const addButton = screen.getByText('Add 0 Contacts')
    expect(addButton.closest('button')).toBeDisabled()
  })

  it('renders cancel button', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('calls setIsOpen(false) on cancel', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<AddContactsToGroupModal {...defaultProps} setIsOpen={setIsOpen} />)

    await user.click(screen.getByText('Cancel'))
    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('loads contacts from the API', async () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)

    // Wait for contacts to load (from MSW handler)
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
  })

  it('updates selected count when contact is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} />)

    // Wait for contacts to load
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    // Click on Alice to select
    await user.click(screen.getByText('Alice Smith'))

    await waitFor(() => {
      expect(screen.getByText('1 contact selected')).toBeInTheDocument()
    })
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<AddContactsToGroupModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Select Contacts To Add')).not.toBeInTheDocument()
  })
})
