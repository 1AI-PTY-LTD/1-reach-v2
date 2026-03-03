import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContactsWidget from '../Customers'
import { createContact } from '../../../test/factories'
import { renderWithProviders } from '../../../test/test-utils'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({
    pathname: '/app/contacts/1',
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

// Mock UploadFileModal
vi.mock('../UploadFileModal', () => ({
  default: () => null,
}))

const contacts = [
  createContact({ id: 1, first_name: 'Alice', last_name: 'Smith', phone: '0412111111' }),
  createContact({ id: 2, first_name: 'Bob', last_name: 'Jones', phone: '0412222222' }),
  createContact({ id: 3, first_name: 'Charlie', last_name: 'Brown', phone: '0412333333' }),
]

describe('ContactsWidget', () => {
  it('renders the Contacts heading', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)
    expect(screen.getByText('Contacts')).toBeInTheDocument()
  })

  it('renders contact names in the list', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument()
  })

  it('renders phone numbers formatted', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)

    expect(screen.getByText('0412 111 111')).toBeInTheDocument()
    expect(screen.getByText('0412 222 222')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
  })

  it('renders Add button', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('renders Add Contacts from file button', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)
    expect(screen.getByText('Add Contacts from file')).toBeInTheDocument()
  })

  it('shows search help message by default', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)
    expect(screen.getByText('Min. 2 letters to start search')).toBeInTheDocument()
  })

  it('allows typing in search input', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ContactsWidget contacts={contacts} />)

    const searchInput = screen.getByLabelText('Search')
    await user.type(searchInput, 'Ali')

    expect(searchInput).toHaveValue('Ali')
  })

  it('renders avatar initials for contacts', () => {
    renderWithProviders(<ContactsWidget contacts={contacts} />)

    // Check for avatar initials (first char of first name + first char of last name)
    expect(screen.getByText('AS')).toBeInTheDocument() // Alice Smith
    expect(screen.getByText('BJ')).toBeInTheDocument() // Bob Jones
    expect(screen.getByText('CB')).toBeInTheDocument() // Charlie Brown
  })
})
